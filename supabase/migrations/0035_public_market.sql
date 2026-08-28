-- Letting the market be found.
--
-- ---------------------------------------------------------------------------
-- The problem
-- ---------------------------------------------------------------------------
--
-- Google can index exactly one page of this site. `/listings` is `noindex` and
-- redirects an unauthenticated caller to sign-in, and the sitemap advertises it
-- anyway — so the crawler is invited to a page that turns it away. Every listing,
-- which is the only content this business actually produces, is invisible.
--
-- For a marketplace that is not a missing feature, it is the absence of the only
-- free acquisition channel available. Owners search "sell my hvac business" and
-- buyers search "hvac company for sale"; both are answered by pages that exist
-- here and cannot be reached.
--
-- ---------------------------------------------------------------------------
-- Why a view and not a policy on `listings`
-- ---------------------------------------------------------------------------
--
-- The obvious move is a select policy admitting `anon` to live rows. It would
-- work and it would give away more than intended, because **RLS is row-level**:
-- admitting anon to the row admits them to every column on it, including
-- `seller_id`. A UUID is not a name, but PostgREST is a general query interface
-- and `?select=seller_id` would let anybody group the market by owner and learn
-- which listings belong to one person. That is a disclosure no seller made.
--
-- So the public surface is a view over the columns a public page needs, and
-- `anon` is granted the view and never the table. The view is SECURITY DEFINER —
-- the default for views — which means its own WHERE clause is the access check
-- rather than the caller's policies. That is the same pattern, and the same
-- reasoning, as `listing_status_timeline` in 0022.
--
-- ---------------------------------------------------------------------------
-- `live` only, and not the other two discoverable statuses
-- ---------------------------------------------------------------------------
--
-- A signed-in buyer sees `under_loi` and `under_contract` because knowing a
-- business is spoken for is useful once you are in the market. A search engine
-- should not: somebody clicking through from Google to a business already under
-- contract has been sent to a dead end by us, and Google will notice the bounce
-- before we do.

-- ===========================================================================
-- A stable, readable URL for each listing
-- ===========================================================================

alter table public.listings
  add column if not exists slug text;

/*
 * Derived from the headline once, then frozen.
 *
 * Frozen because a URL that changes when a seller edits their headline is a URL
 * that 404s everywhere it was ever shared — including in Google's index, which
 * is the entire point of this migration. The slug is assigned at insert and the
 * trigger below refuses to change it afterwards.
 */
create or replace function app.slugify(value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

revoke all on function app.slugify(text) from public, anon, authenticated;

create or replace function app.assign_listing_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  base text;
  candidate text;
  suffix integer := 0;
begin
  if tg_op = 'UPDATE' then
    -- Frozen. A seller may rewrite their headline; the address stays put.
    new.slug := old.slug;
    return new;
  end if;

  base := left(app.slugify(new.headline), 80);
  if base is null or base = '' then
    base := 'business-for-sale';
  end if;

  candidate := base;

  /*
   * Collisions are expected, not exceptional: "established hvac contractor" is
   * what several sellers will write. A numeric suffix keeps the URL readable
   * where a UUID would not, and the loop is bounded because an unbounded one
   * inside a trigger is a way to hang an insert.
   */
  while exists (select 1 from public.listings l where l.slug = candidate) and suffix < 50 loop
    suffix := suffix + 1;
    candidate := base || '-' || suffix;
  end loop;

  if suffix >= 50 then
    candidate := base || '-' || left(replace(new.id::text, '-', ''), 8);
  end if;

  new.slug := candidate;
  return new;
end;
$$;

create trigger listings_assign_slug
  before insert or update on public.listings
  for each row execute function app.assign_listing_slug();

-- Backfill anything that already exists. `where slug is null` so a re-run is a
-- no-op rather than a rewrite of live URLs.
update public.listings
   set slug = left(app.slugify(headline), 80) || '-' || left(replace(id::text, '-', ''), 8)
 where slug is null;

create unique index if not exists listings_slug_idx on public.listings (slug);

-- ===========================================================================
-- The public view
-- ===========================================================================

create or replace view public.market_listings as
  select
    l.slug,
    l.headline,
    l.summary,
    l.background,
    l.industry,
    l.jurisdiction_code,
    j.name as jurisdiction_name,
    l.revenue_band_low_cents,
    l.revenue_band_high_cents,
    l.earnings_band_low_cents,
    l.earnings_band_high_cents,
    l.asking_price_band_low_cents,
    l.asking_price_band_high_cents,
    l.deal_structure,
    l.employee_count,
    l.years_in_business,
    l.growth_trend,
    l.real_estate_included,
    l.owner_dependence,
    l.reason_for_sale,
    l.published_at
  from public.listings l
  left join public.jurisdictions j on j.code = l.jurisdiction_code
  where l.status = 'live';

comment on view public.market_listings is
  'The public, crawlable market. Live listings only, teaser columns only. Deliberately excludes id and seller_id: RLS is row-level, so a policy on the table would have exposed every column including who owns what.';

grant select on public.market_listings to anon, authenticated;

/*
 * Note what is absent: `id` and `seller_id`.
 *
 * The slug is the public identifier. Exposing the row id would let a caller
 * correlate the public view with every other table keyed on it, and exposing
 * seller_id would let anybody group the market by owner — which is a fact about
 * a person that no seller published.
 */
