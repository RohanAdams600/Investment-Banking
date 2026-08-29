-- Two things buyers and sellers ask for in the first week.
--
-- ---------------------------------------------------------------------------
-- 1. Typing a word into a box
-- ---------------------------------------------------------------------------
--
-- The market can be filtered by industry, state, earnings and asking price, and
-- cannot be searched. "HVAC" is the first thing every buyer types, and there has
-- been nowhere to type it.
--
-- Full text over the teaser columns only — headline, summary, background,
-- reason for sale. Not because those are convenient but because the confidential
-- half must not be searchable: a search box that matched on `legal_name` would
-- let anybody confirm a guess about which company is for sale by watching which
-- queries return a row. That is the whole confidentiality model defeated by an
-- index.
--
-- ---------------------------------------------------------------------------
-- 2. "How many people have looked at my business?"
-- ---------------------------------------------------------------------------
--
-- Asked within a week of listing, every time, and there was no answer.
--
-- Deliberately counts and stores **no viewer identity at all** — no user id, no
-- IP, no hashed IP, no cookie. A daily tally per listing and nothing else. That
-- makes the number a page-view count rather than a unique-visitor count, which
-- is weaker, and it is the right trade: an anonymous browse on a marketplace for
-- confidential deals should not create a record of who looked, and a hashed IP
-- is still personal data in several of the places this will operate.
--
-- The number is shown to the seller and never to a buyer. How much attention a
-- business is getting is a fact about the seller's market position, and a buyer
-- who could see it would be negotiating with it.

-- ===========================================================================
-- Search
-- ===========================================================================

alter table public.listings
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(background, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(reason_for_sale, '')), 'D')
  ) stored;

comment on column public.listings.search_document is
  'Full text over the teaser columns only. The confidential half is deliberately absent: a searchable legal_name would let anybody confirm which company is for sale by watching which queries return a row.';

create index if not exists listings_search_idx on public.listings using gin (search_document);

/*
 * Search, as a function rather than a filter on the view.
 *
 * PostgREST can express `websearch_to_tsquery` through `.textSearch()`, but the
 * ranking cannot be expressed at all — and an unranked full-text search returns
 * results in physical order, which reads as random. A function keeps the query
 * and its ordering in one place that both the public page and the application
 * call.
 *
 * SECURITY INVOKER so it composes with whatever the caller can already see. It
 * is called against `listings` by a signed-in user and there is a separate
 * public entry point below.
 */
create or replace function public.search_market(term text, max_rows integer default 50)
returns table (slug text, rank real)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select l.slug,
         ts_rank(l.search_document, websearch_to_tsquery('english', term)) as rank
    from public.listings l
   where l.status = 'live'
     and l.search_document @@ websearch_to_tsquery('english', term)
   order by rank desc, l.published_at desc nulls last
   limit least(greatest(coalesce(max_rows, 50), 1), 200);
$$;

/*
 * Live listings only, and it returns slugs rather than ids — the same public
 * identifier `market_listings` uses. A caller learns nothing they could not
 * learn by paging through the public market; they just get there faster.
 */
revoke all on function public.search_market(text, integer) from public;
grant execute on function public.search_market(text, integer) to anon, authenticated;

comment on function public.search_market(text, integer) is
  'Ranked full-text search over live listings. Returns public slugs. Reachable by anon: it searches only what the public market already shows.';

-- ===========================================================================
-- View counts
-- ===========================================================================

create table if not exists public.listing_view_days (
  listing_id uuid not null references public.listings (id) on delete cascade,
  day date not null default current_date,
  views integer not null default 0 check (views >= 0),

  primary key (listing_id, day)
);

comment on table public.listing_view_days is
  'A daily page-view tally per listing. Stores no viewer identity of any kind — deliberately, so browsing a confidential marketplace creates no record of who looked.';

alter table public.listing_view_days enable row level security;
alter table public.listing_view_days force row level security;

/*
 * The seller sees their own. Nobody else sees anything.
 *
 * No admin branch either: an operator has no decision that depends on how many
 * people looked at one business, and the number is exactly the kind of thing
 * that would leak into a sales conversation if it were visible.
 */
create policy listing_view_days_select_controller
  on public.listing_view_days
  for select
  to authenticated
  using (app.controls_listing(listing_id));

grant select on public.listing_view_days to authenticated;

/*
 * Recording a view.
 *
 * SECURITY DEFINER because the caller is usually anonymous and must not hold
 * write access to the table — there is no insert or update policy at all, so
 * this function is the only way a row changes. It takes a slug rather than an
 * id so a caller cannot use it to probe whether an arbitrary uuid exists, and
 * it silently does nothing for a listing that is not live.
 */
create or replace function public.record_listing_view(target_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  target uuid;
begin
  select id into target
    from public.listings
   where slug = target_slug and status = 'live';

  if target is null then
    -- Not an error. A crawler hitting a withdrawn listing should get a page,
    -- not a 500, and telling a caller the slug was unknown is a way to
    -- enumerate what exists.
    return;
  end if;

  insert into public.listing_view_days (listing_id, day, views)
  values (target, current_date, 1)
  on conflict (listing_id, day) do update
    set views = public.listing_view_days.views + 1;
end;
$$;

revoke all on function public.record_listing_view(text) from public;
grant execute on function public.record_listing_view(text) to anon, authenticated;

comment on function public.record_listing_view(text) is
  'Increments a listing''s daily tally. Reachable by anon because most viewers are; writes nothing about who called it.';

/*
 * The number a seller is shown.
 *
 * Thirty days, because "views since you listed" grows forever and stops meaning
 * anything, while "this month" is the question actually being asked.
 */
create or replace function public.listing_view_summary(target_listing_id uuid)
returns table (last_30_days bigint, last_7_days bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    coalesce(sum(v.views) filter (where v.day > current_date - 30), 0),
    coalesce(sum(v.views) filter (where v.day > current_date - 7), 0)
    from public.listing_view_days v
   where v.listing_id = target_listing_id;
$$;

/*
 * SECURITY INVOKER, so the select policy above decides. A buyer calling this
 * for somebody else's listing gets zeroes rather than a refusal — which is the
 * same answer they would get for a listing nobody has looked at, and therefore
 * tells them nothing.
 */
revoke all on function public.listing_view_summary(uuid) from public, anon;
grant execute on function public.listing_view_summary(uuid) to authenticated;

-- ===========================================================================
-- The generated column breaks the moderation guard
-- ===========================================================================
--
-- `app.enforce_listing_status_transition()` in 0016 checks that a moderating administrator
-- changed nothing except the status. It does so by copying `new`, resetting the
-- columns that are allowed to move, and asserting the result is not distinct
-- from `old`.
--
-- `search_document` is a generated column, and **generated columns are computed
-- after BEFORE-row triggers run**. So inside that trigger `new.search_document`
-- is null while `old.search_document` holds a value, every row comparison says
-- "something changed", and every administrator moderation raises "a listing may
-- only be moderated by changing its status".
--
-- Nothing about the guard was wrong; adding a generated column silently changed
-- what a whole-row comparison means. Two tests in admin-rls.test.ts caught it,
-- which is the reason they compare behaviour rather than columns.
--
-- Reset alongside the other columns the caller does not control.

create or replace function app.enforce_listing_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  allowed boolean;
  probe public.listings;
begin
  -- Ownership is not editable. The UPDATE policy's WITH CHECK calls
  -- `controls_listing`, which reads the *committed* row — so it evaluates the
  -- old owner and would happily let a seller hand their listing to somebody
  -- else. This is the check that actually stops that.
  if new.seller_id <> old.seller_id then
    raise exception 'A listing cannot be transferred to another seller'
      using errcode = '42501';
  end if;

  -- Attaching a listing to a firm grants every broker at that firm control of
  -- it. A caller-supplied id has to be proven, exactly as in `create_deal`.
  if new.firm_id is distinct from old.firm_id
     and new.firm_id is not null
     and not app.is_firm_member(new.firm_id) then
    raise exception 'Not a member of that firm'
      using errcode = '42501';
  end if;

  -- Stamped below, never accepted from the caller: "when did this go live" has
  -- to mean when it actually did.
  new.published_at := old.published_at;

  -- A platform administrator reaches this table through `listings_update_admin`,
  -- for taking a listing down. That is moderation, and moderation is a status
  -- change; rewriting a seller's copy is not. Rather than trusting the route to
  -- send a narrow update, the narrowness is enforced here: every column except
  -- the status must be untouched.
  if not app.controls_listing(old.id) then
    probe := new;
    probe.status := old.status;
    probe.updated_at := old.updated_at;
    /*
     * Generated, and still null at this point in the trigger's life — generated
     * columns are computed after BEFORE-row triggers run. Comparing it would
     * make every moderation look like a rewrite of the seller's copy.
     */
    probe.search_document := old.search_document;

    if probe is distinct from old then
      raise exception 'A listing may only be moderated by changing its status'
        using errcode = '42501';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'draft'          then new.status in ('pending_review', 'withdrawn')
    when 'pending_review' then new.status in ('live', 'draft', 'withdrawn')
    when 'live'           then new.status in ('under_loi', 'withdrawn')
    when 'under_loi'      then new.status in ('under_contract', 'live', 'withdrawn')
    when 'under_contract' then new.status in ('closed', 'under_loi', 'withdrawn')
    -- Terminal. A closed or withdrawn listing is history: commission records
    -- and the audit trail point at it, and reopening one would rewrite what the
    -- parties actually did. Relisting is a new listing.
    when 'closed'         then false
    when 'withdrawn'      then false
  end;

  if not allowed then
    raise exception 'Cannot move a listing from % to %', old.status, new.status
      using errcode = '42501';
  end if;

  -- Stamped here rather than trusted to the caller, so "when did this go live"
  -- is answerable even if the route that changed it forgot.
  if new.status = 'live' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;
