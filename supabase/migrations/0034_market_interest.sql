-- Opening a marketplace that has nothing in it yet.
--
-- ---------------------------------------------------------------------------
-- The cold start
-- ---------------------------------------------------------------------------
--
-- Every part of this product works and there are no listings, which is the
-- hardest problem in this business and not a technical one. The failure mode is
-- specific and unrecoverable: a seller arrives, sees a board with nothing on it,
-- concludes there are no buyers here, and never comes back. You get one visit
-- from each of the first hundred people and an empty grid spends it.
--
-- So before there is inventory, the market does not show an empty board. It says
-- what it is doing and takes a name — a buyer records what they are looking for,
-- a seller records what they have, and both are told when the other side shows
-- up. The matcher, the criteria model and the notification system already exist;
-- what was missing was somewhere to put a person who arrived too early.
--
-- ---------------------------------------------------------------------------
-- Why anonymous inserts, and what stops that being a spam funnel
-- ---------------------------------------------------------------------------
--
-- Requiring an account first defeats the purpose: the whole point is to capture
-- somebody at the moment they are curious, which is before they will make a
-- password. So `anon` may insert here — the only table in this schema where that
-- is true — and the constraints do the work instead:
--
--   * One row per email per side, so a repeated submit is a no-op rather than a
--     hundred rows.
--   * No SELECT for anon or authenticated at all. A caller cannot read back what
--     they wrote, so this cannot be used to test whether an address is already
--     registered.
--   * Every free-text field is capped, and there are no columns an attacker
--     would want to fill.
--
-- The residual risk is somebody submitting junk addresses, which costs a row.
-- That is the correct trade against losing real people at the door.

create type app.interest_side as enum ('selling', 'buying', 'advising');

comment on type app.interest_side is
  'Which side of the market somebody arrived from. Mirrors the three sections of the marketing page.';

create table if not exists public.market_interest (
  id uuid primary key default gen_random_uuid(),

  /*
   * Usually null. Most of these arrive before there is an account, which is the
   * entire reason the table exists. `on delete set null` rather than cascade: if
   * somebody later signs up and then deletes their account, the fact that
   * interest existed is still true and still useful for knowing which channel
   * worked.
   */
  user_id uuid references auth.users (id) on delete set null,

  /*
   * `extensions.citext`, qualified.
   *
   * 0009 moved citext out of `public` so its functions would stop appearing in
   * the schema PostgREST exposes. Every earlier use of the type predates that
   * move and reads as a bare `citext`; this is the first since, and an
   * unqualified reference does not resolve. Case-insensitivity matters here more
   * than most places — Owner@ and owner@ as two rows means emailing the same
   * person twice from a list they joined once.
   */
  email extensions.citext not null
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  side app.interest_side not null,

  /* What they are interested in. Both optional — a name and a side is enough. */
  industry text check (industry is null or char_length(industry) <= 64),
  jurisdiction_code text references public.jurisdictions (code) on delete set null,

  /* In their own words, capped. The most useful column here and the least structured. */
  note text check (note is null or char_length(note) <= 2000),

  /*
   * Which channel produced this.
   *
   * Recorded because the whole point of the first three months is finding out
   * which of search, ads, outreach and content actually works, and that question
   * is unanswerable afterwards if nobody wrote it down at the time.
   */
  source text check (source is null or char_length(source) <= 100),

  contacted_at timestamptz,
  created_at timestamptz not null default now(),

  /* A repeated submit is the same person, not a new lead. */
  unique (email, side)
);

comment on table public.market_interest is
  'People who arrived before there was inventory. Anonymous insert is deliberate; nobody may read it back.';

create index if not exists market_interest_uncontacted_idx
  on public.market_interest (created_at desc)
  where contacted_at is null;

create index if not exists market_interest_user_idx on public.market_interest (user_id);
create index if not exists market_interest_jurisdiction_idx
  on public.market_interest (jurisdiction_code);

alter table public.market_interest enable row level security;
alter table public.market_interest force row level security;

/*
 * Anybody may add themselves. Nobody may read the list.
 *
 * The asymmetry is the security design: a write-only table cannot be harvested,
 * cannot confirm whether an address is present, and has nothing worth stealing
 * even with the insert grant in hand.
 */
create policy market_interest_insert_anyone
  on public.market_interest
  for insert
  to anon, authenticated
  with check (
    -- A signed-in person may attach their own id and nobody else's; an
    -- anonymous one attaches none.
    user_id is null or user_id = (select auth.uid())
  );

create policy market_interest_select_admin
  on public.market_interest
  for select
  to authenticated
  using (app.is_platform_admin());

create policy market_interest_update_admin
  on public.market_interest
  for update
  to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

grant insert on public.market_interest to anon, authenticated;
grant select, update on public.market_interest to authenticated;

-- ---------------------------------------------------------------------------
-- Is the market open yet?
-- ---------------------------------------------------------------------------
--
-- Derived from what is actually on the board rather than from a flag somebody
-- has to remember to flip. A flag would be wrong on the day the first listing
-- goes live and wrong again the day the last one is withdrawn; this cannot be.

create or replace function public.market_is_open()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.listings
     where status in ('live', 'under_loi', 'under_contract')
  );
$$;

/*
 * Readable by everyone including visitors, and that is safe: it answers exactly
 * one boolean that the browse page reveals anyway by having rows on it or not.
 * It deliberately does not expose a count — "we have three listings" is a fact
 * about the operator's business, not the visitor's.
 */
revoke all on function public.market_is_open() from public;
grant execute on function public.market_is_open() to anon, authenticated;

comment on function public.market_is_open() is
  'True once at least one listing is on the market. Derived, never a flag. Deliberately a boolean rather than a count.';

/*
 * How many people are waiting, by side.
 *
 * The number the operator needs to decide when to open, and the one a seller
 * would find persuasive — but it is shown to nobody automatically. Publishing
 * "eleven buyers are waiting" is a marketing claim, and this platform does not
 * make marketing claims it cannot substantiate. It is here so an operator can
 * answer the question, not so a page can print it.
 */
create or replace function public.interest_counts()
returns table (side app.interest_side, total bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select mi.side, count(*)
    from public.market_interest mi
   group by mi.side
   order by mi.side;
$$;

revoke all on function public.interest_counts() from public, anon, authenticated;

comment on function public.interest_counts() is
  'Operator-only. Reached through the admin panel with the service role; never rendered to a visitor as a claim.';
