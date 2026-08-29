-- Closing a real leak in the two views that are their own access check.
--
-- ---------------------------------------------------------------------------
-- What the linter found, and what it actually means here
-- ---------------------------------------------------------------------------
--
-- Supabase's `security_definer_view` lint flags `public.listing_status_timeline`
-- and `public.market_listings`: neither sets `security_invoker`, so both run
-- with their owner's rights and the caller's RLS on the underlying tables is
-- not applied.
--
-- That property is deliberate in both cases and must not be removed:
--
--   * `listing_status_timeline` exists precisely to show rows the caller's own
--     policy withholds. 0022 narrowed `listing_status_history` to the seller and
--     administrators so the reviewer's `reason` text could not leak, and this
--     view re-opens the *columns without a reason* to anyone who can discover
--     the listing. Setting `security_invoker = true` was measured: a buyer goes
--     from 2 rows to 0, and the public status timeline silently empties.
--
--   * `market_listings` is read by `anon`, who has no grant on `listings` at
--     all. As an invoker view it would return `permission denied` to every
--     unauthenticated visitor, which is the entire public market.
--
-- So the finding is a true positive about the property and wrong about the
-- remedy. The right response is not to make these invoker views; it is to make
-- them sound definer views, which they were not.
--
-- ---------------------------------------------------------------------------
-- The actual defect: no security_barrier
-- ---------------------------------------------------------------------------
--
-- When a view is the access check, its WHERE clause has to run *before*
-- anything the caller supplies. Without `security_barrier` the planner is free
-- to reorder, and it does — it costs `app.controls_listing()` and friends as
-- expensive plpgsql calls and pushes a cheap-looking user predicate underneath
-- them. The caller's function is then evaluated against rows the view is about
-- to discard.
--
-- Reproduced, not theorised. A stranger selecting from
-- `listing_status_timeline` gets zero rows, while a predicate of their own in
-- the same statement fires against the hidden row and reports its id. The rows
-- never appear in the result; they leak through the side effects of evaluating
-- the qual — an error message, a timing difference, anything the function can
-- observe.
--
-- `market_listings` did not reproduce under the same test, because its qual is
-- a plain `status = 'live'` comparison the planner runs first. That is a cost
-- estimate rather than a guarantee, and the view is readable by `anon`, so it
-- gets the same treatment. A barrier is free here; guessing which plan the
-- optimiser will pick next release is not.
--
-- ---------------------------------------------------------------------------
-- Why this is not just belt and braces
-- ---------------------------------------------------------------------------
--
-- On this project `anon` and `authenticated` cannot create functions — 0008
-- revoked CREATE on the public schema — so the cleanest exploit needs rights
-- nobody has. That is a good second line and a bad first one: built-in
-- non-leakproof functions and operators exist, which ones are leakproof varies
-- by server version and installed extensions, and role grants are one migration
-- away from changing. The barrier makes the ordering a property of the view
-- rather than a consequence of who currently holds what.
--
-- Cost: `security_barrier` blocks pushdown of non-leakproof quals into the
-- view, so a filter the planner used to apply early may now run late. Both
-- views are already narrow — one listing's history, or the live market capped
-- at a page — so there is nothing here for it to slow down.

alter view public.listing_status_timeline set (security_barrier = true);
alter view public.market_listings set (security_barrier = true);

comment on view public.listing_status_timeline is
  'Status history without the reviewer''s reason, for anyone who can discover the listing. A definer view on purpose — it shows rows the caller''s own policy withholds — so its where clause is the access check and security_barrier keeps it ahead of anything the caller supplies.';

comment on view public.market_listings is
  'The public market: live listings, teaser columns, no id and no seller_id. Read by anon, who has no grant on listings, so it is a definer view by necessity and a barrier view so its filter cannot be reordered behind a caller''s predicate.';

/*
 * `listing_review_queue` is deliberately untouched. It is already
 * `security_invoker = true`, so the caller's own RLS applies and Postgres
 * treats those policy quals as barriers automatically. Adding one would cost a
 * little planning freedom for nothing.
 */
