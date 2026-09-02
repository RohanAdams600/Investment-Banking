-- Saved searches, and the alert that makes them worth saving.
--
-- ---------------------------------------------------------------------------
-- The problem
-- ---------------------------------------------------------------------------
--
-- A buyer looking for a business is not shopping; they are waiting. The thing
-- they want to buy is not listed today and may not be listed for eight months,
-- and the cost of checking a marketplace every week until it is exceeds the
-- value of checking it at all. So they check twice, find nothing that fits, and
-- never come back — which looks like a demand problem and is actually a
-- notification problem.
--
-- Every marketplace that works in this shape solves it the same way: the buyer
-- describes what they want once, and the market tells them when it arrives.
--
-- ---------------------------------------------------------------------------
-- Why this is not the matching engine
-- ---------------------------------------------------------------------------
--
-- `match_scores` already exists and does something more sophisticated: it scores
-- every live listing against a buyer's full acquisition criteria using the
-- seller's exact figures, inside the database, and returns a ranking with the
-- figures stripped out.
--
-- That is a better answer to "which of these should I look at" and a worse
-- answer to "tell me when a machine shop in Ohio comes up". A criteria profile
-- is a long questionnaire a buyer fills in once and rarely revises; a saved
-- search is cheap, disposable, and there are several per person — the same
-- buyer holds "any HVAC business under $2m" and "anything at all in Montana"
-- without either being a statement about their strategy.
--
-- They also fail differently, which is the real argument for both. Criteria are
-- scored and ranked, so a listing that misses on one axis still surfaces with a
-- lower score. A saved search is a filter: it matches or it does not. A buyer
-- who has said "not above $2m" wants silence about a $3m listing, not a
-- courteous mention of it, and the two mechanisms cannot both be tuned to do
-- that at once.
--
-- ---------------------------------------------------------------------------
-- What a search may see
-- ---------------------------------------------------------------------------
--
-- Only what the teaser already shows: industry, jurisdiction, and the size
-- bands. There is deliberately no filter on anything that lives in
-- `listing_details` — a saved search that could filter on the confidential
-- record would leak it one bit at a time, by letting a buyer bisect a hidden
-- figure with a series of alerts. Everything filterable here is public on the
-- listing card.
--
-- ---------------------------------------------------------------------------
-- Frequency, and why "instant" is not an option
-- ---------------------------------------------------------------------------
--
-- Daily or weekly. Not instant, and not because it is hard: a seller taking a
-- listing live and a stranger's phone buzzing in the same second tells every
-- buyer with a broad search the exact minute a business came to market, which
-- is a timing signal the seller did not agree to publish. A day's batching
-- costs a buyer nothing and removes it.

begin;

-- ===========================================================================
-- Types
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'saved_search_frequency') then
    create type app.saved_search_frequency as enum ('daily', 'weekly', 'off');
  end if;
end
$$;

comment on type app.saved_search_frequency is
  'How often a saved search may send. No instant tier: see the note at the top of 0042.';

-- ===========================================================================
-- The table
-- ===========================================================================

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users (id) on delete cascade,

  /*
   * The buyer's own name for it. Not derived from the filters: "Ohio machine
   * shops" and "the Cleveland idea" are the same filter set and mean different
   * things to the person who saved them, and a generated name makes a list of
   * six saved searches unreadable.
   */
  label text not null check (char_length(trim(label)) between 1 and 80),

  /*
   * The filters, each nullable and each meaning "no constraint on this axis".
   *
   * Stored as columns rather than as a jsonb blob. A blob would be less code
   * here and would move every one of these constraints into application
   * code — where `max_asking_cents` could go negative, `industry` could hold a
   * string no listing will ever carry, and a typo in a key silently widens the
   * search to everything.
   */
  q text check (q is null or char_length(q) between 1 and 100),
  industry text check (industry is null or char_length(industry) <= 64),
  jurisdiction_code text references public.jurisdictions (code) on delete set null,
  min_earnings_cents bigint check (min_earnings_cents is null or min_earnings_cents >= 0),
  max_asking_cents bigint check (max_asking_cents is null or max_asking_cents >= 0),

  /*
   * A search with no filters at all matches the entire market. That is a
   * legitimate thing to want on a marketplace this small — "tell me about
   * anything" is how an early buyer behaves — so it is allowed rather than
   * rejected, and the interface says plainly that it is what will happen.
   */

  frequency app.saved_search_frequency not null default 'daily',

  /*
   * The high-water mark. Alerts send listings that became discoverable after
   * this, and it advances only when a send succeeds — so a failed run repeats
   * rather than skipping a day of the market, which is the failure mode that
   * loses a buyer their one chance at a listing.
   */
  last_notified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * One label per person. Saving the same search twice is always a mistake — a
   * buyer who does it gets two identical emails and blames the platform.
   */
  unique (user_id, label)
);

comment on table public.saved_searches is
  'A buyer''s standing description of what they are waiting for. Filters only over teaser-public columns.';

create index if not exists saved_searches_user_idx
  on public.saved_searches (user_id, created_at desc);

/*
 * The index the alert run actually uses: everything sendable, oldest attention
 * first. Partial on frequency so a buyer who switches a search off stops
 * costing anything to scan.
 */
create index if not exists saved_searches_due_idx
  on public.saved_searches (frequency, last_notified_at nulls first)
  where frequency <> 'off';

-- Keeps `updated_at` honest. 0002 defines the shared trigger function.
drop trigger if exists saved_searches_touch on public.saved_searches;
create trigger saved_searches_touch
  before update on public.saved_searches
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.saved_searches enable row level security;

/*
 * FORCE, not just ENABLE.
 *
 * Without it the table's owner bypasses every policy below. That is normally a
 * theoretical concern and is not one here: this is the table whose whole
 * premise is that nobody — including whoever holds the owning role — reads what
 * somebody else intends to buy. A schema-wide test asserts this on every table
 * in `public`, and it caught this line missing.
 */
alter table public.saved_searches force row level security;

/*
 * Own rows, and nothing else — not even for an admin.
 *
 * A saved search is a statement about what somebody intends to buy, which is
 * commercially sensitive in a way the rest of a buyer profile is not: a list of
 * them across the user base is a map of where demand is, and an operator who
 * can read that can trade on it. There is no support case that needs it, so
 * there is no policy that grants it.
 */
create policy saved_searches_own on public.saved_searches
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.saved_searches to authenticated;

-- ===========================================================================
-- Matching
-- ===========================================================================

/*
 * The listings one saved search would alert on.
 *
 * Reads `public.market_listings` — the teaser-only view — rather than
 * `public.listings`. That is the structural half of the promise at the top of
 * this file: the function cannot filter on a confidential column because it
 * cannot see one, so no future edit can widen it into a leak by adding a
 * predicate.
 *
 * `since` is passed rather than read from the row so the caller can preview
 * ("what would this have sent me last week?") without touching the high-water
 * mark. Definer, because the alert run executes as a service role that has no
 * business holding a blanket read over every buyer's searches.
 */
create or replace function public.saved_search_matches(
  p_search_id uuid,
  p_since timestamptz default null,
  p_limit integer default 25
)
returns table (
  slug text,
  headline text,
  industry text,
  jurisdiction_name text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with search as (
    select *
      from public.saved_searches s
     where s.id = p_search_id
       and (
         s.user_id = (select auth.uid())
         or (select auth.uid()) is null  -- the alert run, executing without a JWT
       )
  )
  select m.slug,
         m.headline,
         m.industry,
         m.jurisdiction_name,
         m.published_at
    from public.market_listings m
   cross join search s
   where (p_since is null or m.published_at > p_since)
     /*
      * Text search over the teaser, built here rather than read from
      * `listings.search_document`.
      *
      * The generated column would be faster and is the wrong thing to reach
      * for: it is computed from the whole row, and a function that touched the
      * table instead of the view could be widened to filter on a confidential
      * column by a later edit that looked harmless. The view has three text
      * columns and they are the three a buyer means by "machine shop", so this
      * costs a scan over live listings and buys the guarantee that nothing else
      * is reachable from here.
      */
     and (
       s.q is null
       or to_tsvector(
            'english',
            coalesce(m.headline, '') || ' ' || coalesce(m.summary, '') || ' ' || coalesce(m.background, '')
          ) @@ websearch_to_tsquery('english', s.q)
     )
     and (s.industry is null or m.industry = s.industry)
     and (s.jurisdiction_code is null or m.jurisdiction_code = s.jurisdiction_code)
     /*
      * Band comparisons, not point comparisons.
      *
      * A teaser carries ranges, so "earning at least $500k" has to mean "the
      * top of the band reaches $500k" rather than "the bottom does". The
      * permissive direction is the right one: a buyer would rather see a
      * listing whose band straddles their floor and decide for themselves than
      * never learn it existed. A listing that published no band at all is
      * included for the same reason — absence is not a disqualification.
      */
     and (
       s.min_earnings_cents is null
       or m.earnings_band_high_cents is null
       or m.earnings_band_high_cents >= s.min_earnings_cents
     )
     and (
       s.max_asking_cents is null
       or m.asking_price_band_low_cents is null
       or m.asking_price_band_low_cents <= s.max_asking_cents
     )
   order by m.published_at desc nulls last
   limit least(greatest(p_limit, 1), 100);
$$;

comment on function public.saved_search_matches(uuid, timestamptz, integer) is
  'Teaser-visible listings matching one saved search. Reads market_listings, so it structurally cannot filter on a confidential column.';

revoke execute on function public.saved_search_matches(uuid, timestamptz, integer) from public;
grant execute on function public.saved_search_matches(uuid, timestamptz, integer) to authenticated;
grant execute on function public.saved_search_matches(uuid, timestamptz, integer) to service_role;

commit;
