-- Messaging: membership helpers, triggers, policies, grants, realtime, storage.

-- ===========================================================================
-- Membership helpers
-- ===========================================================================
--
-- These have to be SECURITY DEFINER, and the reason is easy to get wrong.
--
-- A policy on `messages` that reads `conversation_members` in a subquery does
-- not read that table freely — the subquery is itself subject to
-- `conversation_members`' own RLS. With RLS enabled there and no policy granting
-- the read, the subquery returns no rows, the messages policy evaluates false
-- for everyone, and the chat is silently empty for every user including its
-- own participants.
--
-- Running the lookup as the definer is what makes the subquery see the table.
-- `search_path` is pinned, as on every definer function in this schema.

create or replace function app.is_active_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = auth.uid()
      and cm.removed_at is null
  );
$$;

create or replace function app.conversation_role(target_conversation_id uuid)
returns app.conversation_role
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select cm.role from public.conversation_members cm
   where cm.conversation_id = target_conversation_id
     and cm.user_id = auth.uid()
     and cm.removed_at is null;
$$;

-- Admins and bankers administer a conversation's membership. A buyer or seller
-- must not be able to add people to a room they happen to be sitting in.
create or replace function app.can_administer_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.conversation_role(target_conversation_id) in ('banker', 'admin');
$$;

-- A user can see a deal when they actively sit in at least one of its
-- conversations. Deals carry no separate membership table: participation in the
-- deal *is* participation in one of its rooms.
create or replace function app.can_access_deal(target_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.conversation_members cm
      join public.deal_conversations dc on dc.id = cm.conversation_id
     where dc.deal_id = target_deal_id
       and cm.user_id = auth.uid()
       and cm.removed_at is null
  );
$$;

-- ===========================================================================
-- Immutability triggers
-- ===========================================================================

-- A policy's WITH CHECK sees only the new row, so it cannot say "this column
-- did not change". Editing a message must not be able to move it to another
-- conversation or reattribute it, and that comparison needs OLD.
create or replace function app.freeze_message_immutables()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.conversation_id <> old.conversation_id then
    raise exception 'A message cannot be moved between conversations'
      using errcode = '42501';
  end if;

  if new.sender_id <> old.sender_id then
    raise exception 'A message cannot be reattributed to another sender'
      using errcode = '42501';
  end if;

  if new.created_at <> old.created_at then
    raise exception 'A message send time cannot be rewritten'
      using errcode = '42501';
  end if;

  -- A deleted message is finished. Without this, an edit could resurrect one by
  -- clearing `deleted_at`, and the audit trail would say it was deleted.
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'A deleted message cannot be restored'
      using errcode = '42501';
  end if;

  -- Stamp the edit rather than trusting the client to. An edited message whose
  -- `edited_at` is null reads as original text.
  if new.body <> old.body then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

create trigger messages_freeze_immutables
  before update on public.messages
  for each row execute function app.freeze_message_immutables();

-- ===========================================================================
-- Audit triggers
-- ===========================================================================
--
-- The log is written by the database, so it cannot be skipped by a code path
-- that forgets to call it. `actor_id` comes from `auth.uid()` rather than a
-- parameter, so an action cannot be attributed to somebody else.

create or replace function app.log_message_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  event text;
begin
  if tg_op = 'INSERT' then
    event := 'created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    event := 'deleted';
  elsif new.body <> old.body then
    event := 'edited';
  else
    -- Some other column moved; nothing worth a log entry.
    return null;
  end if;

  insert into public.message_audit_log (message_id, conversation_id, actor_id, action, metadata)
  values (
    new.id,
    new.conversation_id,
    auth.uid(),
    event,
    -- Body length, never the body. This table is read by firm administrators
    -- and exported.
    jsonb_build_object('body_length', char_length(new.body))
  );

  return null;
end;
$$;

create trigger messages_audit_insert
  after insert on public.messages
  for each row execute function app.log_message_event();

create trigger messages_audit_update
  after update on public.messages
  for each row execute function app.log_message_event();

-- ===========================================================================
-- Realtime broadcast
-- ===========================================================================
--
-- Broadcast from the database rather than Postgres Changes. Postgres Changes
-- re-evaluates RLS per subscriber per row and does not scale past a modest
-- number of concurrent listeners; broadcast publishes once to a private topic
-- whose authorization is checked at subscribe time.
--
-- The payload deliberately carries no message body. A client receives a signal
-- that something arrived and refetches through PostgREST, where RLS applies
-- again. Putting the body in the broadcast would make the realtime layer a
-- second, weaker path to message content.

create or replace function app.broadcast_message_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  payload jsonb;
begin
  payload := jsonb_build_object(
    'message_id', new.id,
    'conversation_id', new.conversation_id,
    'sender_id', new.sender_id,
    'event', case
      when tg_op = 'INSERT' then 'created'
      when new.deleted_at is not null then 'deleted'
      else 'updated'
    end
  );

  perform realtime.send(
    payload,
    'message',
    'conversation:' || new.conversation_id::text,
    true -- private channel; subscribers are authorized against realtime.messages
  );

  return null;
end;
$$;

create trigger messages_broadcast
  after insert or update on public.messages
  for each row execute function app.broadcast_message_event();

-- Topic format is `conversation:<uuid>`. Anything else is not ours and is
-- refused rather than parsed loosely.
create or replace function app.topic_conversation_id(topic text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if topic is null or topic !~ '^conversation:[0-9a-fA-F-]{36}$' then
    return null;
  end if;
  return substring(topic from 14)::uuid;
exception when others then
  return null;
end;
$$;

-- ===========================================================================
-- Enable and force RLS
-- ===========================================================================

alter table public.deals enable row level security;
alter table public.deal_conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_audit_log enable row level security;

alter table public.deals force row level security;
alter table public.deal_conversations force row level security;
alter table public.conversation_members force row level security;
alter table public.messages force row level security;
alter table public.message_audit_log force row level security;

-- ===========================================================================
-- Policies
-- ===========================================================================

-- Deals -------------------------------------------------------------------

create policy deals_select_participants on public.deals
  for select to authenticated
  using (app.can_access_deal(id) or app.is_platform_admin());

-- No insert, update, or delete policy. Deals are created and amended through
-- server-side routes using the service role, which is where the business rules
-- about who may open a deal will live.

-- Conversations -----------------------------------------------------------

create policy deal_conversations_select_members on public.deal_conversations
  for select to authenticated
  using (app.is_active_conversation_member(id) or app.is_platform_admin());

-- Membership --------------------------------------------------------------

-- A member sees who else is in the room. This is deliberate: knowing who can
-- read what you write is part of using a deal room safely.
create policy conversation_members_select_members on public.conversation_members
  for select to authenticated
  using (
    app.is_active_conversation_member(conversation_id)
    or user_id = auth.uid()
    or app.is_platform_admin()
  );

create policy conversation_members_insert_administrators on public.conversation_members
  for insert to authenticated
  with check (app.can_administer_conversation(conversation_id));

-- Used for removal (setting `removed_at`) and role changes.
create policy conversation_members_update_administrators on public.conversation_members
  for update to authenticated
  using (app.can_administer_conversation(conversation_id))
  with check (app.can_administer_conversation(conversation_id));

-- No delete policy: removal is `removed_at`, so the record of who had access
-- survives.

-- Messages ----------------------------------------------------------------

-- Deleted messages are filtered out here rather than blanked in the client.
-- The body of a deleted message never leaves the database, over any path —
-- REST, realtime refetch, or a future export. The audit log records that the
-- deletion happened, so nothing is lost for compliance.
create policy messages_select_members on public.messages
  for select to authenticated
  using (deleted_at is null and app.is_active_conversation_member(conversation_id));

-- Two conditions, and both are load-bearing. Membership stops a stranger
-- writing into the room; `sender_id = auth.uid()` stops a member writing as
-- somebody else, which on a deal room is the more damaging of the two.
create policy messages_insert_members on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and app.is_active_conversation_member(conversation_id)
  );

-- Editing. Only the sender, only while still a member, only on a message that
-- has not been withdrawn, and the trigger above pins everything that must not
-- move.
--
-- `deleted_at is null` appears in WITH CHECK, which means a client cannot
-- withdraw a message through an ordinary UPDATE. That is deliberate, and it
-- follows from a behaviour of Postgres worth stating plainly:
--
--   When a table has SELECT policies, an UPDATE also checks the *new* row
--   against them. Since the SELECT policy above requires `deleted_at is null`,
--   any UPDATE setting `deleted_at` produces a row the author could no longer
--   see, and Postgres rejects it.
--
-- So the strict SELECT policy and client-side soft-delete cannot both exist.
-- Keeping the strict policy is the better trade: it is what makes "the body of
-- a withdrawn message never leaves the database" true over every path rather
-- than only the ones the application remembers to filter. Deletion gets an
-- explicit function instead.
create policy messages_update_own on public.messages
  for update to authenticated
  using (
    sender_id = auth.uid()
    and deleted_at is null
    and app.is_active_conversation_member(conversation_id)
  )
  with check (
    sender_id = auth.uid()
    and deleted_at is null
    and app.is_active_conversation_member(conversation_id)
  );

-- No delete policy and no delete grant. A hard delete would leave the audit log
-- pointing at a row that no longer exists.

-- Message audit log -------------------------------------------------------

create policy message_audit_log_select_members on public.message_audit_log
  for select to authenticated
  using (app.is_active_conversation_member(conversation_id) or app.is_platform_admin());

-- No insert policy for clients: entries come from the triggers above, which run
-- as definer, and from the export route using the service role.
-- No update or delete policy for anyone.

-- Realtime authorization --------------------------------------------------
--
-- Supabase authorizes private channels through RLS on `realtime.messages`.
-- Without these, a subscribe to `conversation:<id>` is refused — which is the
-- correct default, and the reason the topic must be checked rather than trusted.

create policy realtime_conversation_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and app.is_active_conversation_member(app.topic_conversation_id(realtime.topic()))
  );

-- Clients do not publish on these topics; the database does. This policy exists
-- so presence and acknowledgement traffic works, and it is scoped to the same
-- membership check rather than left open.
create policy realtime_conversation_write on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and app.is_active_conversation_member(app.topic_conversation_id(realtime.topic()))
  );

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- 0008 revoked the Supabase default that grants everything on new tables, so
-- nothing below is reachable until granted here. What is absent is deliberate:
-- no INSERT on deals or conversations (server-side only), no DELETE on
-- messages (soft delete), nothing at all on the audit log beyond SELECT.

grant select on public.deals to authenticated;
grant select on public.deal_conversations to authenticated;
grant select, insert, update on public.conversation_members to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select on public.message_audit_log to authenticated;

-- Withdrawing a message.
--
-- SECURITY DEFINER because the SELECT policy makes a client-side soft delete
-- impossible (see the note on `messages_update_own`). The function re-checks
-- both conditions the policy would have — sender identity and live membership —
-- so routing around the policy does not mean routing around the rule.
--
-- The audit trigger still fires, and `auth.uid()` inside it is the caller's,
-- not the definer's, so the entry is attributed correctly.
create or replace function public.withdraw_message(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  affected int;
begin
  if caller is null then
    raise exception 'withdraw_message requires an authenticated user'
      using errcode = '42501';
  end if;

  update public.messages m
     set deleted_at = now()
   where m.id = target_message_id
     and m.sender_id = caller
     and m.deleted_at is null
     and app.is_active_conversation_member(m.conversation_id);

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.withdraw_message(uuid) from public, anon;
grant execute on function public.withdraw_message(uuid) to authenticated;

grant execute on function app.is_active_conversation_member(uuid) to authenticated;
grant execute on function app.conversation_role(uuid) to authenticated;
grant execute on function app.can_administer_conversation(uuid) to authenticated;
grant execute on function app.can_access_deal(uuid) to authenticated;
grant execute on function app.topic_conversation_id(text) to authenticated;

-- ===========================================================================
-- Attachments: private bucket
-- ===========================================================================
--
-- `public = false`, so there is no permanent URL for an object in it. Reads go
-- through short-lived signed URLs minted server-side after the membership check
-- — see apps/web/src/features/messaging/attachments.ts.
--
-- Object paths are `<conversation_id>/<message_id>/<filename>`. The policies
-- below read the conversation id from the first path segment, which is what
-- ties an object to the same membership rule as the messages it belongs to.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-attachments',
  'deal-attachments',
  false,
  52428800, -- 50 MB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy deal_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-attachments'
    and app.is_active_conversation_member(app.topic_conversation_id('conversation:' || split_part(name, '/', 1)))
  );

create policy deal_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'deal-attachments'
    and owner_id = auth.uid()::text
    and app.is_active_conversation_member(app.topic_conversation_id('conversation:' || split_part(name, '/', 1)))
  );

-- No update or delete policy. An attachment in a deal room is a record; if it
-- needs withdrawing, that is a soft delete on the owning message plus a
-- retention decision, not an object disappearing from under an audit entry.
