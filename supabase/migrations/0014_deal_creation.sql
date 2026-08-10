-- Opening a deal.
--
-- Closes the bootstrap gap left by 0012. Every messaging policy computes
-- authorisation from conversation membership, and membership can only be
-- granted by an existing administrator of that conversation — so a deal with no
-- conversations, or a conversation with no members, is invisible and unusable
-- to everybody including the person who created it. Until this migration there
-- was no route into the deal room at all.
--
-- The same reasoning as `create_firm`, for the same reason: two statements leave
-- a window in which the thing exists unclaimed, and any policy permissive
-- enough to let the creator claim it is permissive enough to let somebody else
-- claim it first. One function, one transaction, no window.

-- ---------------------------------------------------------------------------
-- Who may open a deal
-- ---------------------------------------------------------------------------
--
-- Sell-side only. A buyer is invited into a deal; they do not start one.
--
-- This duplicates `deal:create` in packages/core/src/access/capabilities.ts.
-- The duplication is unavoidable — the database cannot import TypeScript, and
-- the permission model must not require a database connection — so a test
-- asserts the two agree rather than trusting them to.
create or replace function app.can_create_deal()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.has_platform_role('seller')
      or app.has_platform_role('broker')
      or app.has_platform_role('admin');
$$;

-- ---------------------------------------------------------------------------
-- create_deal
-- ---------------------------------------------------------------------------
--
-- Creates the deal, its first conversation, and the caller's membership as
-- banker, atomically.
--
-- SECURITY DEFINER because the caller has no INSERT rights on `deals` or
-- `deal_conversations` — deliberately, since those tables are server-side only.
-- That makes the authorisation check below load-bearing rather than decorative:
-- a definer function without it would let any authenticated user open a deal.
create or replace function public.create_deal(
  deal_name text,
  first_conversation_name text default 'General',
  conversation_kind app.conversation_type default 'buyer_seller',
  owning_firm_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  new_deal_id uuid;
  new_conversation_id uuid;
begin
  if caller is null then
    raise exception 'create_deal requires an authenticated user'
      using errcode = '42501';
  end if;

  if not app.can_create_deal() then
    raise exception 'Only a seller, broker or admin can open a deal'
      using errcode = '42501';
  end if;

  -- A firm may only be attached by someone who belongs to it. Without this the
  -- caller-supplied id would let anyone attribute their deal to any firm on the
  -- platform, which matters because firm membership drives who can see what.
  if owning_firm_id is not null and not app.is_firm_member(owning_firm_id) then
    raise exception 'You are not a member of that firm'
      using errcode = '42501';
  end if;

  insert into public.deals (name, firm_id, created_by)
  values (deal_name, owning_firm_id, caller)
  returning id into new_deal_id;

  insert into public.deal_conversations (deal_id, name, type, created_by)
  values (new_deal_id, first_conversation_name, conversation_kind, caller)
  returning id into new_conversation_id;

  -- Banker, not seller. The creator needs to be able to bring the other side
  -- into the room, and `can_administer_conversation` is banker-or-admin. A
  -- creator seated as `seller` could not invite the buyer to their own deal.
  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (new_conversation_id, caller, 'banker', caller);

  return new_deal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Adding further conversations to an existing deal
-- ---------------------------------------------------------------------------
--
-- Same shape, and the same bootstrap problem in miniature: a new conversation
-- with no members would be invisible to its creator. Authorisation comes from
-- already administering some conversation on the deal, which is what the API
-- route checked in application code — repeated here so the rule holds even if a
-- future caller skips that route.
create or replace function public.create_deal_conversation(
  target_deal_id uuid,
  conversation_name text,
  conversation_kind app.conversation_type default 'buyer_seller'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  new_conversation_id uuid;
begin
  if caller is null then
    raise exception 'create_deal_conversation requires an authenticated user'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.deal_conversations dc
      join public.conversation_members cm on cm.conversation_id = dc.id
     where dc.deal_id = target_deal_id
       and cm.user_id = caller
       and cm.removed_at is null
       and cm.role in ('banker', 'admin')
  ) then
    -- Deliberately the same message whether the deal does not exist or the
    -- caller merely lacks standing in it. Distinguishing the two would confirm
    -- that a deal with a given id exists to someone who cannot see it.
    raise exception 'Deal not found'
      using errcode = '42501';
  end if;

  insert into public.deal_conversations (deal_id, name, type, created_by)
  values (target_deal_id, conversation_name, conversation_kind, caller)
  returning id into new_conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (new_conversation_id, caller, 'banker', caller);

  return new_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- 0009 revoked the default EXECUTE grant on public functions, so these are
-- unreachable until named here. `anon` is excluded: the guards inside would
-- reject it anyway, and this is the outer gate.

revoke all on function public.create_deal(text, text, app.conversation_type, uuid)
  from public, anon;
revoke all on function public.create_deal_conversation(uuid, text, app.conversation_type)
  from public, anon;

grant execute on function public.create_deal(text, text, app.conversation_type, uuid)
  to authenticated;
grant execute on function public.create_deal_conversation(uuid, text, app.conversation_type)
  to authenticated;

grant execute on function app.can_create_deal() to authenticated;
