-- Nobody could create a listing.
--
-- ---------------------------------------------------------------------------
-- The bug
-- ---------------------------------------------------------------------------
--
-- `createListing` inserts and asks for the new id back:
--
--     .insert({ ... }).select('id').single()
--
-- PostgREST issues that as `INSERT ... RETURNING id`, and Postgres has a rule
-- that is easy to miss: **when an INSERT has a RETURNING clause, the SELECT
-- policy is applied to the new row as an additional WITH CHECK.** Returning a
-- row you would not be allowed to read would be a disclosure, so the row has to
-- satisfy the read policy too.
--
-- The read policy was:
--
--     app.controls_listing(id) or app.is_platform_admin()
--       or status in ('live','under_loi','under_contract')
--
-- A brand-new listing is a `draft`, so the third arm is false and the first has
-- to carry it. But `app.controls_listing()` is STABLE and answers by looking the
-- listing up **in `public.listings`** — and a STABLE function runs against the
-- snapshot taken when the statement began, which is before this row existed. It
-- returns false. The insert is then rejected with "new row violates row-level
-- security policy", which describes what happened and points at nothing.
--
-- Net effect: every attempt to list a business failed. The most important write
-- in the marketplace, refused by a policy meant to protect reads.
--
-- ---------------------------------------------------------------------------
-- Why it survived the test suite
-- ---------------------------------------------------------------------------
--
-- `supabase/tests/listings-rls.test.ts` inserts listings to set up its
-- fixtures, and it inserts them **without** RETURNING — it selects the id back
-- afterwards, in a second statement, where the row is committed and visible. So
-- the tests exercised the policy and never exercised the path the application
-- actually takes. A test that builds its fixtures differently from the product
-- is a test that can pass while the product is broken.
--
-- The end-to-end run added in this change does use RETURNING, because that is
-- what the server action does.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Decide ownership from the row's own columns instead of looking the row up.
-- `seller_id` and `firm_id` are right there in the tuple being checked; asking
-- the table who owns it is a round trip that answers a question the row already
-- answers, and it is the round trip that cannot see the new row.
--
-- Semantically identical for every existing row — `app.controls_listing()` is
-- exactly "seller matches, or a broker in the owning firm" — and additionally
-- correct for a row that has not been committed yet.
--
-- `app.controls_listing()` stays, and stays in use on `listing_details`,
-- `listing_ndas` and the rest. Those policies reference a *different* table
-- whose row already exists, so the snapshot problem does not arise there.

drop policy if exists listings_select_discoverable on public.listings;

create policy listings_select_discoverable
  on public.listings
  for select
  to authenticated
  using (
    /*
     * The owner, read straight off the row. This arm is what makes
     * INSERT ... RETURNING work: it needs no lookup, so there is no snapshot to
     * be behind.
     */
    seller_id = (select auth.uid())
    or (
      firm_id is not null
      and app.is_firm_member(firm_id)
      and app.has_platform_role('broker')
    )
    or app.is_platform_admin()
    -- Anybody may see a listing that is actually on the market.
    or status in ('live', 'under_loi', 'under_contract')
  );

comment on policy listings_select_discoverable on public.listings is
  'Who may read a listing row. Ownership is decided from the row own columns rather than by looking the listing up, so INSERT ... RETURNING works: Postgres applies this policy as a WITH CHECK on the new row, and a STABLE lookup cannot see a row the statement is still inserting.';
