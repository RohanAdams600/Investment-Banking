-- The broker directory, and why it is the growth engine rather than a feature.
--
-- ---------------------------------------------------------------------------
-- The problem this solves
-- ---------------------------------------------------------------------------
--
-- A marketplace with no listings cannot attract buyers, and a marketplace with
-- no buyers cannot attract sellers. Every new marketplace dies in that loop,
-- and the way out is never to court sellers one at a time: it is to court the
-- people who already represent twenty of them.
--
-- A broker arrives with a book. Give them a reason to create an account before
-- they have a listing to post, and the listings follow. A public profile is
-- that reason — it is a page that ranks for their name and their county, which
-- is worth something to them on the day they sign up rather than on the day the
-- market is liquid.
--
-- ---------------------------------------------------------------------------
-- Opt-in, and the reason it is not a default
-- ---------------------------------------------------------------------------
--
-- `is_published` starts false and nothing flips it but a deliberate act by a
-- firm administrator. This is somebody's professional name; publishing it
-- because they created an account for another purpose would be the platform
-- making a marketing decision on their behalf with their reputation.
--
-- The consequence is worth stating: the directory will be empty at launch, and
-- that is correct. A directory populated with people who did not ask to be in
-- it is worse than an empty one.
--
-- ---------------------------------------------------------------------------
-- What is in a profile, and what is deliberately not
-- ---------------------------------------------------------------------------
--
-- Everything here is what a broker would put on their own website. There is no
-- deal history, no closed-transaction count, no success rate — the platform
-- cannot verify any of it, and an unverifiable number on a page we publish is a
-- claim we are making, not one they are. `verification_status` on `firms` says
-- only that an operator looked at who they say they are.

begin;

-- ===========================================================================
-- The profile
-- ===========================================================================

create table if not exists public.firm_profiles (
  firm_id uuid primary key references public.firms (id) on delete cascade,

  /*
   * The public identifier, and stable once set.
   *
   * A slug that changes when a firm renames breaks every link anybody has
   * shared and every result a crawler has indexed. The trigger below assigns it
   * once and freezes it, the same way listing slugs work in 0036.
   */
  slug text unique,

  /*
   * Opt-in. Nothing but a firm administrator's deliberate action sets this, and
   * `false` is the only default that respects whose name is on the page.
   */
  is_published boolean not null default false,

  headline text check (headline is null or char_length(trim(headline)) between 1 and 120),
  about text check (about is null or char_length(about) <= 2000),

  /*
   * Where they work and what they sell. Arrays rather than a join table: these
   * are a handful of tags on a profile, they are always read whole, and a join
   * table would buy referential integrity over a vocabulary that already lives
   * in the application.
   *
   * Bounded, because an unbounded array is how a profile becomes a keyword
   * dump — which is bad for the reader and is the shape Google demotes.
   */
  industries text[] not null default '{}'
    check (array_length(industries, 1) is null or array_length(industries, 1) <= 8),
  jurisdictions text[] not null default '{}'
    check (array_length(jurisdictions, 1) is null or array_length(jurisdictions, 1) <= 12),

  /*
   * Their own site and how to reach them.
   *
   * `website` is constrained to https rather than merely "looks like a URL". A
   * directory that will happily render `javascript:` or a bare `data:` for a
   * third party is a directory that publishes an attack, and the check is
   * cheaper here than remembering to sanitise at every render.
   */
  website text check (website is null or website ~ '^https://[^[:space:]<>"]{3,200}$'),
  contact_email extensions.citext
    check (contact_email is null
           or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  /*
   * Recorded as a year rather than a duration, so a profile nobody edits does
   * not silently become wrong. "Since 2009" stays true; "17 years' experience"
   * does not.
   */
  established_year smallint
    check (established_year is null
           or established_year between 1900 and extract(year from now())::smallint),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.firm_profiles is
  'A firm''s opt-in public directory entry. Everything here is self-reported and none of it is a claim the platform makes.';

create index if not exists firm_profiles_published_idx
  on public.firm_profiles (is_published) where is_published;

create index if not exists firm_profiles_industries_idx
  on public.firm_profiles using gin (industries) where is_published;
create index if not exists firm_profiles_jurisdictions_idx
  on public.firm_profiles using gin (jurisdictions) where is_published;

drop trigger if exists firm_profiles_touch on public.firm_profiles;
create trigger firm_profiles_touch
  before update on public.firm_profiles
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Slugs, assigned once and then frozen
-- ===========================================================================

create or replace function app.assign_firm_profile_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  if tg_op = 'UPDATE' then
    -- Frozen. Every shared link and indexed result depends on it.
    new.slug := old.slug;
    return new;
  end if;

  select app.slugify(f.name) into base from public.firms f where f.id = new.firm_id;
  base := coalesce(nullif(base, ''), 'firm');
  candidate := base;

  /*
   * Two brokerages genuinely can share a name across states, so a collision is
   * an ordinary event rather than an error. Bounded: after a hundred tries the
   * slug takes the firm id, which is ugly and always works.
   */
  while exists (select 1 from public.firm_profiles p where p.slug = candidate) loop
    suffix := suffix + 1;
    if suffix > 100 then
      candidate := base || '-' || replace(new.firm_id::text, '-', '');
      exit;
    end if;
    candidate := base || '-' || suffix::text;
  end loop;

  new.slug := candidate;
  return new;
end;
$fn$;

drop trigger if exists firm_profiles_slug on public.firm_profiles;
create trigger firm_profiles_slug
  before insert or update on public.firm_profiles
  for each row execute function app.assign_firm_profile_slug();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.firm_profiles enable row level security;
alter table public.firm_profiles force row level security;

/*
 * A firm's own administrators manage it, and nobody else touches it.
 *
 * Note what is absent: no policy grants `anon` or a signed-in stranger a read
 * of this table. The public directory is served by the view below instead, so
 * an unpublished draft is unreachable even by somebody who knows the firm id —
 * which is the whole point of the opt-in.
 */
create policy firm_profiles_manage on public.firm_profiles
  for all to authenticated
  using (app.is_firm_administrator(firm_id) or app.is_platform_admin())
  with check (app.is_firm_administrator(firm_id) or app.is_platform_admin());

grant select, insert, update, delete on public.firm_profiles to authenticated;

-- ===========================================================================
-- The public directory
-- ===========================================================================

/*
 * Published profiles only, and only the columns a firm chose to publish.
 *
 * A view rather than a policy, for the same reason `market_listings` is one:
 * RLS is row-level, so a policy letting anonymous visitors read this table
 * would expose every column on it. The view is the column filter.
 *
 * `security_barrier` so the planner cannot push a caller's predicate beneath
 * the `is_published` qual and evaluate it against rows the view is about to
 * discard. 0038 exists because that was not merely theoretical here.
 */
create or replace view public.broker_directory
with (security_barrier = true) as
  select p.slug,
         f.name,
         f.kind,
         f.verification_status,
         p.headline,
         p.about,
         p.industries,
         p.jurisdictions,
         p.website,
         p.established_year,
         p.created_at
    from public.firm_profiles p
    join public.firms f on f.id = p.firm_id
   where p.is_published;

comment on view public.broker_directory is
  'The public broker directory. Published profiles only, and deliberately without firm_id or contact_email: the id would correlate this with every other table keyed on it, and the address belongs behind a contact action rather than in a page a scraper can read.';

grant select on public.broker_directory to anon, authenticated;

commit;
