-- The question every buyer asks first, and the schema had nowhere to put it.
--
-- ---------------------------------------------------------------------------
-- What was missing
-- ---------------------------------------------------------------------------
--
-- A listing could say what a business earns, what it does, and why the owner is
-- selling. It could not say how it got here. `summary` is a teaser blurb capped
-- at a paragraph and written to attract; `years_in_business` is an integer.
-- Neither answers "what am I actually buying" — which is a story about how the
-- revenue was built, what changed, and what the current owner did or did not do
-- to it.
--
-- That gap matters more here than on a general marketplace. A buyer looking at
-- two firms with identical EBITDA is choosing between them on history: one grew
-- organically over twenty years on referrals, the other tripled in eighteen
-- months on a single contract that renews next spring. The financials are the
-- same. The businesses are not.
--
-- ---------------------------------------------------------------------------
-- Why this is two columns and not one
-- ---------------------------------------------------------------------------
--
-- History is the easiest way in this entire schema to break the anonymity the
-- product is built on. "Founded in 1998 by the current owner's father, the first
-- HVAC contractor in the county to run a fleet" identifies a business as surely
-- as its name does, and a seller writing in good faith will produce exactly that
-- sentence without noticing.
--
-- So the split follows the split that already exists everywhere else:
--
--   listings.background            public, anonymised, on the teaser
--   listing_details.ownership_history   behind the NDA, names and dates
--
-- Putting the narrative only on the confidential side would have been safer and
-- wrong: it is precisely the thing that makes a buyer request access, and a
-- teaser that cannot say anything about how the business was built is a teaser
-- nobody acts on. The form warns; RLS is what enforces.

alter table public.listings
  add column if not exists background text
    check (background is null or char_length(background) <= 2000);

comment on column public.listings.background is
  'How the business got here, written so it does not identify which business it is. Public — appears on the teaser alongside summary.';

alter table public.listing_details
  add column if not exists ownership_history text
    check (ownership_history is null or char_length(ownership_history) <= 4000);

comment on column public.listing_details.ownership_history is
  'Founders, ownership changes, prior sale processes. Behind the NDA gate with the rest of listing_details.';

alter table public.listing_details
  add column if not exists prior_transactions text
    check (prior_transactions is null or char_length(prior_transactions) <= 2000);

comment on column public.listing_details.prior_transactions is
  'Previous sale attempts, LOIs that did not close, and why. The question a buyer asks in week six and a seller volunteers in week none.';
