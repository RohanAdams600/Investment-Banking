-- Who is on the other side of the deal, and AI matching on the buyer's thesis.
--
-- ---------------------------------------------------------------------------
-- The correction this migration makes
-- ---------------------------------------------------------------------------
--
-- 0015 and 0016 anonymised too much. They treated the *people* as confidential
-- along with the business, and that is not how brokerage works and not what the
-- confidentiality is for.
--
--   - **The business is confidential.** Its name, address and financials stay
--     hidden until the seller issues an NDA. That is unchanged and remains the
--     most important boundary in the product.
--
--   - **The people are not.** A listing names the broker or seller representing
--     it — buyers need somebody to call, and an anonymous counterparty is not
--     credible. A seller deciding whether to release their financials needs to
--     know who is asking; "identity withheld" makes that decision unmakeable,
--     and a seller who cannot tell a strategic competitor from a search fund
--     will either approve everyone or no one.
--
-- So identity is disclosed and the business is not. Getting those two the same
-- way round was the mistake.
--
-- Buyer identity is disclosed on the buyer's own terms: `is_discoverable` on
-- their criteria is a consent flag, and a buyer who turns it off stops appearing
-- to sellers at all. The default is on, because a marketplace where buyers
-- cannot be found does not work, and the setting says plainly what it does.

-- ===========================================================================
-- Buyer profiles
-- ===========================================================================
--
-- What a seller needs to decide whether to engage: who you are, what you buy
-- with, and whether you have done this before. Deliberately not financial
-- statements — proof of funds belongs in the deal room after both sides have
-- agreed to talk, not on a profile card.
create table public.buyer_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- The acquiring entity, if there is one. A search fund's name matters to a
  -- seller in a way an individual's does not.
  entity_name text check (entity_name is null or char_length(entity_name) <= 300),
  firm_id uuid references public.firms (id) on delete set null,

  headline text check (headline is null or char_length(headline) <= 200),
  bio text check (bio is null or char_length(bio) <= 4000),

  -- Banded rather than exact, and by the buyer's own choice. A buyer who
  -- publishes an exact war chest has priced themselves before negotiating.
  capital_available_low_cents bigint check (capital_available_low_cents >= 0),
  capital_available_high_cents bigint check (capital_available_high_cents >= 0),

  -- How the purchase is funded. Sellers weight an all-cash buyer differently
  -- from one who needs SBA approval, and it is the first question they ask.
  funding_source text check (funding_source is null or char_length(funding_source) <= 200),

  prior_acquisitions integer check (prior_acquisitions >= 0),
  linkedin_url text check (linkedin_url is null or char_length(linkedin_url) <= 500),
  website text check (website is null or char_length(website) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint buyer_profiles_capital_ordered check (
    capital_available_low_cents is null
    or capital_available_high_cents is null
    or capital_available_high_cents >= capital_available_low_cents
  )
);

create trigger buyer_profiles_touch_updated_at
  before update on public.buyer_profiles
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Buyer consent to be found
-- ===========================================================================
--
-- Saving criteria is what makes a buyer matchable. This flag is what makes them
-- *visible* to the sellers they match. Separating the two means a buyer can use
-- the matching feed privately without appearing in anybody's outreach queue.
alter table public.acquisition_criteria
  add column is_discoverable boolean not null default true;

comment on column public.acquisition_criteria.is_discoverable is
  'Buyer consent to be shown to sellers they match. Off means they still get '
  'their own match feed but no seller can see them or contact them.';

-- ===========================================================================
-- AI thesis matching
-- ===========================================================================
--
-- The deterministic score handles what can be counted: industry, size,
-- geography, structure, quality. It cannot read the sentence "I want a business
-- with route density in the Northeast that I can bolt onto an existing
-- operation", which is the part of the buyer's criteria that actually describes
-- what they want.
--
-- That is what the model is for, and it is kept in **separate columns** rather
-- than blended into `score`. Two reasons:
--
--   1. A blended number cannot be explained. "84%" made of arithmetic plus a
--      model's opinion is not auditable, and the specification requires every
--      recommendation to show its reasoning.
--   2. The arithmetic is reproducible and the model is not. Mixing them makes
--      the reproducible half untestable.
--
-- The model is told the **teaser only** — never the confidential profile. The
-- deterministic scorer reads the seller's real figures because it runs inside
-- our own database; sending those to a third-party API is a disclosure to a
-- subprocessor the seller never agreed to. See docs/agents.md.
alter table public.match_scores
  add column ai_score smallint check (ai_score between 0 and 100),
  add column ai_rationale text check (ai_rationale is null or char_length(ai_rationale) <= 2000),
  -- Which model produced it. A score whose author is unknown cannot be
  -- reviewed after the fact, and models change under the same name.
  add column ai_model text check (ai_model is null or char_length(ai_model) <= 100),
  add column ai_computed_at timestamptz;

comment on column public.match_scores.ai_score is
  'Semantic fit of the buyer thesis against the listing teaser. Kept separate '
  'from `score` so the deterministic half stays reproducible and explainable.';

-- ===========================================================================
-- RLS
-- ===========================================================================

/*
 * Whether the caller controls a listing this buyer is engaged with.
 *
 * `SECURITY DEFINER` for a reason worth stating, because it has bitten this
 * codebase twice already: **a policy's subqueries are themselves subject to
 * RLS.** Written inline, the `match_scores` lookup below runs under
 * `match_scores_select_own`, which admits only rows where `buyer_id =
 * auth.uid()` — so a seller reads no match rows at all, the subquery finds
 * nothing, and the policy denies everything while looking correct.
 *
 * The definer bypasses RLS for this one lookup, which is safe because the
 * function takes only a buyer id and answers about `auth.uid()`'s own listings.
 * It cannot be pointed at somebody else's relationships.
 *
 * Two grounds, both bounded:
 *   - the buyer asked for access to a listing the caller controls; or
 *   - the buyer matched one, and consented to being discoverable.
 */
create or replace function app.is_my_counterparty(target_buyer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.listing_ndas n
     where n.buyer_id = target_buyer_id
       and n.revoked_at is null
       and app.controls_listing(n.listing_id)
  ) or exists (
    select 1
      from public.match_scores m
      join public.acquisition_criteria c
        on c.id = m.criteria_id and c.is_discoverable
     where m.buyer_id = target_buyer_id
       and not m.excluded
       and app.controls_listing(m.listing_id)
  );
$$;

revoke all on function app.is_my_counterparty(uuid) from public, anon;
grant execute on function app.is_my_counterparty(uuid) to authenticated;

alter table public.buyer_profiles enable row level security;
alter table public.buyer_profiles force row level security;

-- A buyer always sees and edits their own.
create policy buyer_profiles_own on public.buyer_profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/*
 * A seller sees the buyers they are dealing with.
 *
 * Three grounds, narrowest first:
 *
 *   - the buyer asked for access to a listing the caller controls;
 *   - the buyer matched a listing the caller controls, and consented to being
 *     discoverable;
 *   - the caller is a platform admin, who verifies buyers.
 *
 * The match branch is the one that makes outreach possible. It is bounded by
 * the buyer's own `is_discoverable` flag, so it is disclosure the buyer opted
 * into rather than a side effect of using the product.
 */
create policy buyer_profiles_select_counterparty on public.buyer_profiles
  for select to authenticated
  using (
    app.is_platform_admin()
    or app.is_my_counterparty(public.buyer_profiles.user_id)
  );

/*
 * The same reach, for the `profiles` row that carries the buyer's name.
 *
 * 0016 added `profiles_select_nda_counterparty` for the NDA case. This extends
 * it to matched buyers, so a seller's outreach queue shows a person rather than
 * "identity withheld" — which was the defect this migration exists to fix.
 */
create policy profiles_select_matched_buyer on public.profiles
  for select to authenticated
  using (app.is_my_counterparty(public.profiles.id));

/*
 * The other direction: buyers see who is representing a listing.
 *
 * This is the half that was simply missing. Every listing on a real brokerage
 * names its broker — the buyer has to have somebody to call, and a deal offered
 * by nobody in particular does not get taken seriously.
 *
 * It discloses the representative's profile, not the business. A buyer learning
 * that Sam Reyes is selling *a* home-services company in New York still does not
 * know which one.
 */
create policy profiles_select_listing_representative on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.seller_id = public.profiles.id
         and l.status in ('live', 'under_loi', 'under_contract')
    )
  );

-- Firms behind live listings are visible for the same reason: "listed by Ridge
-- Brokerage" is the credential a buyer actually weighs.
create policy firms_select_listing_representative on public.firms
  for select to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.firm_id = public.firms.id
         and l.status in ('live', 'under_loi', 'under_contract')
    )
  );

-- ===========================================================================
-- Matched buyers, for the seller
-- ===========================================================================
--
-- Replaces the counts-only view with named buyers, which is what makes outreach
-- possible at all. Still `security definer` and still checks control of the
-- listing inside the function, so it cannot be pointed at somebody else's.
--
-- Buyers who set `is_discoverable = false` never appear here.
create or replace function public.matched_buyers(target_listing_id uuid)
returns table (
  buyer_id uuid,
  full_name text,
  entity_name text,
  headline text,
  funding_source text,
  prior_acquisitions integer,
  capital_low_cents bigint,
  capital_high_cents bigint,
  score smallint,
  ai_score smallint,
  ai_rationale text,
  verification_status app.verification_status,
  has_nda boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    m.buyer_id,
    p.full_name,
    b.entity_name,
    b.headline,
    b.funding_source,
    b.prior_acquisitions,
    b.capital_available_low_cents,
    b.capital_available_high_cents,
    m.score,
    m.ai_score,
    m.ai_rationale,
    p.verification_status,
    exists (
      select 1 from public.listing_ndas n
       where n.listing_id = target_listing_id
         and n.buyer_id = m.buyer_id
         and n.revoked_at is null
    ) as has_nda
  from public.match_scores m
  join public.acquisition_criteria c
    on c.id = m.criteria_id and c.is_discoverable
  left join public.profiles p on p.id = m.buyer_id
  left join public.buyer_profiles b on b.user_id = m.buyer_id
  where m.listing_id = target_listing_id
    and not m.excluded
    and app.controls_listing(target_listing_id)
  order by m.score desc
  limit 100;
$$;

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select, insert, update on public.buyer_profiles to authenticated;

revoke all on function public.matched_buyers(uuid) from public, anon;
grant execute on function public.matched_buyers(uuid) to authenticated;
