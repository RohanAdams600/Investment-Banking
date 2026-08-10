-- Deal room messaging: deals, conversations, membership, messages, audit.
--
-- Roles here are a third axis, distinct from the two already in the schema:
--
--   platform_role      what a person does on the platform      (many per user)
--   firm_role          their standing inside one firm          (one per firm)
--   conversation_role  the seat they occupy in one conversation (one per conversation)
--
-- They are separate because they answer different questions. The same person can
-- hold `broker` platform-wide, `owner` at their brokerage, and sit as `banker`
-- in one deal's conversation and `buyer` in another's. Collapsing any two of
-- these would force a choice that is wrong somewhere.
--
-- `banker` exists only on this axis — it is a seat at a table, not a platform
-- identity, which is why it is absent from `app.platform_role`.

create type app.conversation_role as enum ('buyer', 'seller', 'banker', 'admin');

create type app.conversation_type as enum ('buyer_seller', 'internal', 'diligence');

-- ---------------------------------------------------------------------------

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),

  -- Nullable: a deal can exist before a firm is attached to it, and a deal run
  -- by an unaffiliated seller has no firm at all.
  firm_id uuid references public.firms (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deals_firm_idx on public.deals (firm_id);

create trigger deals_touch_updated_at
  before update on public.deals
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------

-- A conversation belongs to exactly one deal. Enforced by the NOT NULL foreign
-- key, and relied on by every policy below: authorisation is computed from
-- conversation membership, and a conversation that spanned two deals would make
-- "can this person see this deal" unanswerable.
create table public.deal_conversations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  type app.conversation_type not null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index deal_conversations_deal_idx on public.deal_conversations (deal_id);

-- ---------------------------------------------------------------------------

create table public.conversation_members (
  conversation_id uuid not null references public.deal_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app.conversation_role not null,

  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,

  -- Soft removal. A removed member keeps their row so the record of who could
  -- see what, and when, survives — which is the question that actually gets
  -- asked when a confidentiality dispute arises. Access is gated on
  -- `removed_at is null` everywhere.
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,

  -- One row per person per conversation. Re-adding somebody clears `removed_at`
  -- rather than inserting a second row; the alternative is a membership history
  -- table, which is worth building when someone needs the full timeline.
  primary key (conversation_id, user_id)
);

create index conversation_members_user_idx
  on public.conversation_members (user_id) where removed_at is null;

-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.deal_conversations (id) on delete cascade,

  -- No ON DELETE action, so a user who has sent messages cannot be hard-deleted.
  -- Consistent with the rest of the schema: account deletion anonymises the
  -- profile and leaves the record standing.
  sender_id uuid not null references auth.users (id),

  -- Stored and rendered as plain text. Nothing in this system interprets it as
  -- markup — see the client, which sets textContent rather than innerHTML.
  body text not null check (char_length(body) between 1 and 10000),

  created_at timestamptz not null default now(),
  edited_at timestamptz,

  -- Soft delete. The row survives so the audit trail refers to something.
  deleted_at timestamptz
);

create index messages_conversation_idx
  on public.messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------

-- Append-only record of what happened to each message.
--
-- Written by triggers rather than by the application. An audit log the
-- application is responsible for calling is an audit log with a hole in it
-- wherever somebody forgot, or wherever a future code path writes to the table
-- directly. `exported` is the exception — no database event corresponds to
-- someone downloading a transcript, so that one is written by the route that
-- serves it.
create table public.message_audit_log (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages (id),
  conversation_id uuid not null references public.deal_conversations (id),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('created', 'edited', 'deleted', 'exported')),
  event_at timestamptz not null default now(),

  -- Never contains message bodies. This table is read by firm administrators
  -- and exported; it records that an event happened, not its content.
  metadata jsonb not null default '{}'::jsonb
);

create index message_audit_log_message_idx on public.message_audit_log (message_id, event_at desc);
create index message_audit_log_conversation_idx
  on public.message_audit_log (conversation_id, event_at desc);
