-- Telling people things happened.
--
-- ---------------------------------------------------------------------------
-- The gap this closes
-- ---------------------------------------------------------------------------
--
-- Until now nothing in the platform tells anybody anything. A buyer requests
-- access to a listing and the seller finds out by logging in and looking. A
-- reviewer sends a listing back with a reason and the seller finds out the same
-- way. A marketplace where you have to remember to check is not a marketplace;
-- it is a filing cabinet.
--
-- ---------------------------------------------------------------------------
-- In-app first, email second, and that ordering is deliberate
-- ---------------------------------------------------------------------------
--
-- The obvious build is "send an email". That makes delivery depend on a
-- provider key nobody has set yet, and it makes the record of what somebody was
-- told live in a third party's sent folder.
--
-- So a notification is a row. It exists whether or not email is configured, it
-- shows in the app immediately, and emailing it later is a delivery channel over
-- a record that already exists — the same shape as `outreach_drafts`, where the
-- draft is the artifact and sending is a separate act.
--
-- ---------------------------------------------------------------------------
-- What a notification may say
-- ---------------------------------------------------------------------------
--
-- **Nothing confidential.** This is the rule that shapes every column below.
--
-- A notification is a candidate for an email, and email is not a confidential
-- channel: it sits unencrypted on a mail server, gets forwarded, and is read on
-- a phone on a train. So the body says *that* something happened and never
-- *what* — "somebody requested access to your listing" rather than the buyer's
-- name, "your listing was returned" rather than the reviewer's reason.
--
-- The link goes to the page where the gated version lives, behind the session
-- and the policies that already exist. A notification is a doorbell, not a
-- window.

create type app.notification_kind as enum (
  -- Sell side
  'nda_requested',
  'nda_signed',
  'listing_approved',
  'listing_returned',
  'new_match',
  'document_opened',
  -- Buy side
  'nda_issued',
  'nda_revoked',
  'document_released',
  -- Both
  'message_received',
  'task_due'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  recipient_id uuid not null references auth.users (id) on delete cascade,

  kind app.notification_kind not null,

  /*
   * What it says. Written by the application from a fixed vocabulary — see
   * `packages/core/src/notifications` — rather than assembled from row data at
   * the call site, because a template that interpolates a listing's legal name
   * is one careless `${}` away from putting it in an email.
   */
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text check (body is null or char_length(body) <= 500),

  /*
   * Where to go. A path, not a URL: the domain belongs to the deployment, and a
   * stored absolute URL is how a notification written on staging ends up
   * linking a customer to staging.
   *
   * `like '/%'` alone is not enough, and the gap is the interesting part.
   * `//evil.example/phish` starts with a slash and is a *protocol-relative
   * URL* — a browser reads it as "the other host, over whatever scheme this
   * page used" and navigates off-platform. `/\evil.example` is the same trick
   * in browsers that normalise a backslash to a slash. Both are excluded, so
   * the only thing this column can hold is a path on this site.
   *
   * The exclusions use `left()` rather than `not like`, because backslash is
   * LIKE's own escape character: `not like '/\%'` reads as "not a slash
   * followed by a literal percent sign" and lets `/\evil.example` straight
   * through. That is not a hypothetical — it was written that way first, and
   * the test caught it.
   *
   * Nothing in the application builds an href from user input today. The
   * constraint is here for the day something does.
   */
  href text check (
    href is null
    or (
      char_length(href) <= 300
      and left(href, 1) = '/'
      and left(href, 2) <> '//'
      and left(href, 2) <> '/\'
    )
  ),

  -- What it concerns, for de-duplication and for cleanup when the thing goes
  -- away. Deliberately not a foreign key: a notification outlives the row it
  -- points at, and "your listing was withdrawn" must survive the withdrawal.
  entity_type text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id uuid,

  read_at timestamptz,
  created_at timestamptz not null default now(),

  -- Set once an email actually goes out, so a provider added later can pick up
  -- the backlog without re-sending what was already delivered.
  emailed_at timestamptz
);

create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The unread count, which is on every page. Partial so it stays small as the
-- table grows — an index over every notification ever sent is one nobody wants
-- in the header query.
create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

-- Waiting to be emailed. Also partial: the queue is short and the archive is
-- long, and scanning the archive to find the queue is the thing that gets slow
-- first.
create index notifications_pending_email_idx
  on public.notifications (created_at)
  where emailed_at is null;

-- ---------------------------------------------------------------------------
-- What people want to be told about
-- ---------------------------------------------------------------------------
--
-- One row per person, defaults on. A marketplace where notifications are opt-in
-- is one where the first NDA request is missed, and the first one is the one
-- that matters.
--
-- Columns rather than a jsonb blob or a row per category. There are few enough
-- categories to name them, and a named column is a thing a query can filter on
-- and a migration has to think about — a blob is where "we forgot to check the
-- preference" lives.

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- In-app is not configurable, deliberately: it costs the recipient nothing,
  -- and a platform that can be configured into telling somebody nothing at all
  -- has a support burden rather than a feature.
  email_deal_activity boolean not null default true,
  email_new_matches boolean not null default true,
  email_listing_status boolean not null default true,
  email_messages boolean not null default true,

  /*
   * A digest instead of one email per event.
   *
   * Off by default. Somebody whose listing has just gone live wants to know
   * about the first access request within the hour, not tomorrow morning — and
   * a seller who finds the volume tiring will turn this on themselves, which is
   * the right way round.
   */
  email_digest boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Reading is the only thing a recipient may change
-- ===========================================================================
--
-- Marking something read is the one legitimate edit. Everything else — the
-- text, who it is for, when it arrived — is a record of what the platform told
-- somebody, and a recipient who could rewrite it could dispute having been
-- told.

create or replace function app.enforce_notification_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  probe public.notifications;
begin
  probe := new;
  probe.read_at := old.read_at;

  if probe is distinct from old then
    raise exception 'A notification can only be marked read or unread'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger notifications_enforce_update
  before update on public.notifications
  for each row execute function app.enforce_notification_update();

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

alter table public.notifications force row level security;
alter table public.notification_preferences force row level security;

-- Yours and nobody else's, including an administrator's. What a person has been
-- told is between them and the platform, and there is no support case that
-- needs reading somebody's inbox rather than asking them.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- No insert policy. Notifications are written with the service role, because
-- the event that produces one is usually visible to somebody who cannot see the
-- recipient — a buyer requesting an NDA notifies a seller they have never met.
-- A client that could write here could also fabricate "your listing was
-- approved".

create policy notification_preferences_own on public.notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- The bell
-- ===========================================================================
--
-- A count, on every page. Cheap enough to be worth a function rather than a
-- select with a policy evaluation per row.

create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::integer
    from public.notifications
   where recipient_id = auth.uid()
     and read_at is null;
$$;

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

/*
 * Mark everything read.
 *
 * A function rather than an update from the client, for one small reason: the
 * obvious client version is `update notifications set read_at = now() where
 * read_at is null`, and without a recipient predicate that statement is a
 * request to mark *everybody's* notifications read. RLS would refuse the rows,
 * so it would be harmless — but it would also be a statement whose safety
 * depends entirely on a policy, and this one does not need to be.
 */
create or replace function public.mark_notifications_read(before timestamptz default now())
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  marked integer;
begin
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and created_at <= before;

  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke all on function public.mark_notifications_read(timestamptz) from public, anon;
grant execute on function public.mark_notifications_read(timestamptz) to authenticated;

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select, update on public.notifications to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
