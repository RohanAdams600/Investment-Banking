-- The onboarding questionnaire, and what sellers want from a buyer.
--
-- ---------------------------------------------------------------------------
-- Two tables, two different jobs
-- ---------------------------------------------------------------------------
--
-- `questionnaire_responses` is scratch. It holds a half-finished questionnaire
-- so somebody can close the tab on question nine and come back to it on their
-- phone. Answers here are not authoritative: when the questionnaire completes,
-- they are mapped into the real tables — `acquisition_criteria`,
-- `buyer_profiles`, `seller_preferences` — and those are what the product
-- reads. Keeping the two separate means a change to the question wording never
-- silently changes what matching runs on.
--
-- `seller_preferences` is the new idea. Every marketplace models what a buyer
-- wants; almost none model what a *seller* wants beyond price. Owners who spent
-- decades building something care whether the staff keep their jobs, whether
-- the name survives, and whether the buyer is a competitor who will strip it —
-- often more than they care about the last five percent of the price.
--
-- Capturing that makes matching two-sided. It also surfaces a conflict on day
-- one instead of week ten: a seller who wants the business kept intact and a
-- buyer who intends to merge it are both better off knowing early.

create type app.buyer_kind as enum (
  'individual',
  'search_fund',
  'strategic',
  'private_equity',
  'family_office',
  'employees'
);

create type app.transition_length as enum ('none', 'weeks', 'months', 'year', 'ongoing');

create type app.seller_financing_openness as enum ('no', 'small', 'significant', 'open');

create type app.sale_timeline as enum ('asap', 'six_months', 'year', 'no_rush', 'exploring');

-- ---------------------------------------------------------------------------
-- Saved questionnaire progress
-- ---------------------------------------------------------------------------

create table public.questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- 'buyer' or 'seller'. Text rather than an enum because the set of
  -- questionnaires will grow and each addition should not need a migration.
  questionnaire_id text not null check (char_length(questionnaire_id) between 1 and 50),

  /*
   * The answers so far, keyed by question id.
   *
   * jsonb because the shape genuinely varies by question type and a column per
   * question would need a migration every time the wording team adds one. This
   * is scratch data — the authoritative columns are elsewhere — so the
   * looseness costs nothing that matters.
   */
  answers jsonb not null default '{}'::jsonb,

  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One in-progress response per questionnaire per person. Starting again
  -- overwrites rather than accumulating drafts nobody will finish.
  unique (user_id, questionnaire_id)
);

create trigger questionnaire_responses_touch_updated_at
  before update on public.questionnaire_responses
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- What the seller wants from a buyer
-- ---------------------------------------------------------------------------

create table public.seller_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Empty means no preference, which is not the same as every kind. Same
  -- convention as `acquisition_criteria.industries`.
  acceptable_buyer_types app.buyer_kind[] not null default '{}',

  -- 1–5, self-reported. Used as weights, so a seller who says a thing does not
  -- matter does not get buyers marked down for it.
  employee_priority smallint not null default 3 check (employee_priority between 1 and 5),
  legacy_priority smallint not null default 3 check (legacy_priority between 1 and 5),
  confidentiality_concern smallint not null default 3
    check (confidentiality_concern between 1 and 5),

  transition app.transition_length not null default 'months',
  seller_financing app.seller_financing_openness not null default 'open',
  timeline app.sale_timeline not null default 'six_months',

  -- Why they are selling. The public listing carries only a broad version.
  sale_reason text check (sale_reason is null or char_length(sale_reason) <= 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger seller_preferences_touch_updated_at
  before update on public.seller_preferences
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The seller's read of a buyer
-- ---------------------------------------------------------------------------
--
-- The mirror of `match_scores.score`. That one answers "does this business fit
-- what the buyer asked for"; this answers "does this buyer fit what the seller
-- asked for". They are different questions and frequently give different
-- answers — the highest bidder is often the worst fit for an owner who cares
-- what happens to their staff.
--
-- Stored on the same row so both numbers move together and neither can be
-- shown without the other being available.
alter table public.match_scores
  add column seller_fit_score smallint check (seller_fit_score between 0 and 100),
  add column seller_fit_reasons jsonb not null default '[]'::jsonb,
  -- Things worth raising before week ten. Shown to the seller, not the buyer.
  add column seller_frictions jsonb not null default '[]'::jsonb;

comment on column public.match_scores.seller_fit_score is
  'How well this buyer matches what the seller said they wanted. The mirror of '
  '`score`, which measures the opposite direction.';

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.questionnaire_responses enable row level security;
alter table public.seller_preferences enable row level security;

alter table public.questionnaire_responses force row level security;
alter table public.seller_preferences force row level security;

-- Answers in progress are nobody else's business, including an admin's. They
-- are working notes, and the authoritative records they produce are separately
-- readable where they need to be.
create policy questionnaire_responses_own on public.questionnaire_responses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A seller's preferences are their own to write.
create policy seller_preferences_own on public.seller_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/*
 * A buyer sees the seller's priorities once they are in a deal together.
 *
 * Gated on an executed NDA rather than on a match. Before that point these are
 * negotiating positions — a buyer who knows on day one that the seller is
 * desperate to retire and does not care about price has an advantage the seller
 * never meant to give. After an NDA both sides are talking properly, and the
 * buyer knowing that staff continuity matters makes for a better offer, not a
 * cheaper one.
 */
create policy seller_preferences_select_counterparty on public.seller_preferences
  for select to authenticated
  using (
    exists (
      select 1
        from public.listings l
        join public.listing_ndas n on n.listing_id = l.id
       where l.seller_id = public.seller_preferences.user_id
         and n.buyer_id = auth.uid()
         and n.status = 'signed'
         and n.revoked_at is null
         and (n.expires_at is null or n.expires_at > now())
    )
  );

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select, insert, update, delete on public.questionnaire_responses to authenticated;
grant select, insert, update on public.seller_preferences to authenticated;
