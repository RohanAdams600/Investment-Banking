-- ===========================================================================
-- URGENT: listing creation is refused until this runs.
--
-- Paste the whole file into the Supabase SQL Editor and run it once. It ends
-- with a verification SELECT that prints PASS or FAIL, so a paste that does not
-- take cannot look like one that did — which has already happened once on this
-- project.
--
-- Safe to run more than once.
-- ===========================================================================

begin;

drop policy if exists listings_select_discoverable on public.listings;

create policy listings_select_discoverable
  on public.listings
  for select
  to authenticated
  using (
    -- The owner, read straight off the row rather than looked up. This is what
    -- makes INSERT ... RETURNING work: Postgres applies this policy as a WITH
    -- CHECK on the new row, and a STABLE lookup cannot see a row the statement
    -- is still inserting.
    seller_id = (select auth.uid())
    or (
      firm_id is not null
      and app.is_firm_member(firm_id)
      and app.has_platform_role('broker')
    )
    or app.is_platform_admin()
    or status in ('live', 'under_loi', 'under_contract')
  );

comment on policy listings_select_discoverable on public.listings is
  'Who may read a listing row. Ownership is decided from the row own columns rather than by looking the listing up, so INSERT ... RETURNING works.';

commit;

-- ---------------------------------------------------------------------------
-- Did it take? Both rows must read PASS.
-- ---------------------------------------------------------------------------
select
  case when exists (
    select 1 from pg_policies
     where tablename='listings' and policyname='listings_select_discoverable'
       and qual like '%seller_id%'
  ) then 'PASS' else '*** FAIL ***' end as result,
  'ownership is decided from the row' as check_name
union all
select
  case when not exists (
    select 1 from pg_policies
     where tablename='listings' and policyname='listings_select_discoverable'
       and qual like '%controls_listing%'
  ) then 'PASS' else '*** FAIL ***' end,
  'no self-lookup remains in the read policy';
