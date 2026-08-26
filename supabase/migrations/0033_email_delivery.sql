-- Actually sending the notification.
--
-- ---------------------------------------------------------------------------
-- What was missing
-- ---------------------------------------------------------------------------
--
-- 0026 built notifications properly — kinds, copy, per-category preferences,
-- collapsing, an unread count — and then wrote rows to a table. `wantsEmail()`
-- has been sitting there since, answering a question nothing asked.
--
-- The consequence is not cosmetic. A buyer requests access to a listing, a row
-- appears, and the seller finds out the next time they happen to sign in. For a
-- marketplace where one side is a business owner who logs in twice a month, that
-- is the deal dying quietly. Every flow in this product assumes somebody learns
-- that something happened.
--
-- ---------------------------------------------------------------------------
-- Unsubscribing without signing in
-- ---------------------------------------------------------------------------
--
-- CAN-SPAM requires a working opt-out in every commercial message, and one that
-- demands a password first is not working — the person who most wants out is the
-- one who no longer remembers having an account.
--
-- So each user gets an opaque token. The link carries it, the route resolves it
-- to a preference row, and nothing about it identifies the person to anyone who
-- intercepts the URL. It can be rotated, which makes it revocable if a mailbox
-- is compromised.
--
-- A random token rather than a signed one deliberately: signing needs a secret,
-- a secret needs rotation, and rotating it invalidates every unsubscribe link in
-- every inbox at once. A column is duller and does not have that failure.

alter table public.notification_preferences
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists notification_preferences_unsubscribe_token_idx
  on public.notification_preferences (unsubscribe_token);

comment on column public.notification_preferences.unsubscribe_token is
  'Opaque, per-user. Carried in the unsubscribe link so opting out needs no sign-in, as CAN-SPAM requires.';

/*
 * The token for a user, creating their preference row if they have none.
 *
 * Most users never open the preferences page, so most have no row — `wantsEmail`
 * treats absence as "yes, send". But an email cannot go out without an opt-out
 * link, so the row has to exist by the time one is sent. This is the only place
 * that materialises it, and it does so as a side effect of needing the token,
 * which means the row is created exactly when it starts to matter.
 */
create or replace function public.unsubscribe_token_for(target_user uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  token uuid;
begin
  insert into public.notification_preferences (user_id)
  values (target_user)
  on conflict (user_id) do nothing;

  select unsubscribe_token into token
    from public.notification_preferences
   where user_id = target_user;

  return token;
end;
$$;

/*
 * `public` rather than `app` because the sender reaches it through PostgREST,
 * which publishes only the exposed schemas. Revoked from every client role, so
 * being in `public` grants nobody anything.
 */
revoke all on function public.unsubscribe_token_for(uuid) from public, anon, authenticated;

comment on function public.unsubscribe_token_for(uuid) is
  'Service-role only. Returns the user unsubscribe token, creating their preference row if absent.';

/*
 * Turning off one category from a link in an inbox.
 *
 * Scoped to a single category rather than everything, because "stop emailing me
 * about new matches" and "stop emailing me about my own deal" are different
 * requests and a product that treats them as one will be told to stop entirely.
 *
 * Returns true when it changed something and false for an unknown token. The
 * route shows the same page either way — telling a caller their token was wrong
 * turns this into an oracle for guessing tokens.
 */
create or replace function public.unsubscribe_by_token(token uuid, category text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  affected integer;
begin
  if category not in ('deal_activity', 'new_matches', 'listing_status', 'messages') then
    return false;
  end if;

  update public.notification_preferences
     set email_deal_activity  = case when category = 'deal_activity'  then false else email_deal_activity end,
         email_new_matches    = case when category = 'new_matches'    then false else email_new_matches end,
         email_listing_status = case when category = 'listing_status' then false else email_listing_status end,
         email_messages       = case when category = 'messages'       then false else email_messages end
   where unsubscribe_token = token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

/*
 * Callable without a session — that is the entire point. It reveals nothing: an
 * unknown token and a successful opt-out are indistinguishable to the caller,
 * and no other row is reachable through it.
 */
revoke all on function public.unsubscribe_by_token(uuid, text) from public;
grant execute on function public.unsubscribe_by_token(uuid, text) to anon, authenticated;

comment on function public.unsubscribe_by_token(uuid, text) is
  'Opt out of one email category from a link, with no sign-in. Reachable by anon on purpose; returns the same answer for a bad token as for a good one.';

-- ---------------------------------------------------------------------------
-- What was actually sent
-- ---------------------------------------------------------------------------
--
-- A log, because "did the seller get the email" is the first question support
-- gets asked and the provider's dashboard is not somewhere an operator should be
-- sent to answer it. Deliberately holds no body: the copy is derived from `kind`
-- and lives in the code, so storing it again would be a second copy of the same
-- string that can drift.

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),

  recipient_id uuid not null references auth.users (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete set null,

  kind text not null check (char_length(kind) between 1 and 64),

  -- 'sent' when the provider accepted it, 'failed' otherwise, 'skipped' when the
  -- recipient had opted out or the platform was not configured to send at all.
  outcome text not null check (outcome in ('sent', 'failed', 'skipped')),
  detail text check (detail is null or char_length(detail) <= 500),

  /* The provider's id, for tracing one message through their dashboard. */
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),

  created_at timestamptz not null default now()
);

create index if not exists email_deliveries_recipient_idx
  on public.email_deliveries (recipient_id, created_at desc);

create index if not exists email_deliveries_notification_idx
  on public.email_deliveries (notification_id);

alter table public.email_deliveries enable row level security;
alter table public.email_deliveries force row level security;

/*
 * A person may see what was sent to them. Nobody may see anything else, and
 * there is no insert policy at all — deliveries are written with the service
 * role by the sender, exactly as notifications are.
 */
create policy email_deliveries_select_own
  on public.email_deliveries
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

grant select on public.email_deliveries to authenticated;
