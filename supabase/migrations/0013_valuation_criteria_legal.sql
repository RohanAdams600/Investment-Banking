-- Valuation estimates, buyer acquisition criteria, and legal document drafts.

create type app.valuation_confidence as enum ('low', 'moderate', 'indicative');
create type app.deal_structure_preference as enum ('asset', 'stock', 'either');
create type app.involvement_preference as enum ('owner_operator', 'passive', 'either');
create type app.legal_document_kind as enum (
  'nda', 'loi', 'asset_purchase_agreement', 'stock_purchase_agreement', 'broker_agreement'
);

-- ---------------------------------------------------------------------------
-- Valuation estimates
-- ---------------------------------------------------------------------------
--
-- Stored as a range, never a point. The columns are `low` and `high` with no
-- midpoint, mirroring the model's output type: the moment a single figure
-- exists in the schema it ends up on a screen, in an export, and then in a
-- negotiation.
--
-- `inputs` and `factors` are captured alongside the numbers so an estimate
-- remains reproducible and explicable after the model changes. An old estimate
-- whose reasoning cannot be recovered is worse than no record — someone will
-- find it and treat it as current.
create table public.valuation_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  industry text not null,
  basis text not null check (basis in ('sde', 'ebitda')),
  earnings_cents bigint not null check (earnings_cents > 0),
  revenue_cents bigint not null check (revenue_cents >= 0),

  range_low_cents bigint not null check (range_low_cents >= 0),
  range_high_cents bigint not null check (range_high_cents >= 0),
  constraint valuation_range_ordered check (range_high_cents >= range_low_cents),

  effective_multiple_low numeric(6, 2) not null,
  effective_multiple_high numeric(6, 2) not null,

  confidence app.valuation_confidence not null,

  -- Exactly what was entered, and exactly what the model did with it.
  inputs jsonb not null default '{}'::jsonb,
  factors jsonb not null default '[]'::jsonb,

  -- Which version of the model produced this. Without it, a stored estimate
  -- cannot be distinguished from one today's model would produce.
  model_version text not null default 'v1',

  created_at timestamptz not null default now()
);

create index valuation_estimates_user_idx
  on public.valuation_estimates (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Buyer acquisition criteria
-- ---------------------------------------------------------------------------
--
-- One active set per user. Superseded versions are kept rather than updated in
-- place, because a change in what gets recommended should be traceable to a
-- change in what was asked for — otherwise the matching engine looks like it
-- drifted on its own.
create table public.acquisition_criteria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Empty array means no preference, which is not the same as every value.
  industries text[] not null default '{}',
  jurisdictions text[] not null default '{}',

  revenue_min_cents bigint check (revenue_min_cents >= 0),
  revenue_max_cents bigint check (revenue_max_cents >= 0),
  earnings_min_cents bigint check (earnings_min_cents >= 0),
  earnings_max_cents bigint check (earnings_max_cents >= 0),
  deal_size_max_cents bigint check (deal_size_max_cents >= 0),

  deal_structure app.deal_structure_preference not null default 'either',
  involvement app.involvement_preference not null default 'either',

  max_customer_concentration numeric(4, 3) check (max_customer_concentration between 0 and 1),
  min_recurring_revenue_share numeric(4, 3) check (min_recurring_revenue_share between 0 and 1),

  -- Free text thesis. Feeds the AI layer; never the deterministic scoring.
  thesis text check (thesis is null or char_length(thesis) <= 4000),

  version integer not null default 1 check (version > 0),
  superseded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint acquisition_criteria_ranges_ordered check (
    (revenue_min_cents is null or revenue_max_cents is null
      or revenue_max_cents >= revenue_min_cents)
    and (earnings_min_cents is null or earnings_max_cents is null
      or earnings_max_cents >= earnings_min_cents)
  )
);

-- One live set per buyer. Partial unique index rather than a column constraint,
-- so superseded rows accumulate freely.
create unique index acquisition_criteria_one_active_per_user
  on public.acquisition_criteria (user_id) where superseded_at is null;

create trigger acquisition_criteria_touch_updated_at
  before update on public.acquisition_criteria
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Legal document drafts
-- ---------------------------------------------------------------------------
--
-- A draft always points at the `legal_templates` version it was generated from.
-- That reference is what makes it possible to answer, years later, exactly what
-- wording a party was shown — which is the whole reason templates are versioned
-- and never edited in place.
create table public.legal_document_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete restrict,

  -- Optional: a draft can exist before it is attached to a deal.
  deal_id uuid references public.deals (id) on delete set null,

  kind app.legal_document_kind not null,
  template_id uuid references public.legal_templates (id) on delete restrict,
  template_version integer,

  title text not null check (length(trim(title)) > 0),
  body text not null,

  -- The values substituted in, kept so a draft can be regenerated when the
  -- template is superseded.
  variables jsonb not null default '{}'::jsonb,

  -- Output of the review checklist at the time of generation.
  review_findings jsonb not null default '[]'::jsonb,
  unresolved_placeholders text[] not null default '{}',

  -- There is deliberately no `approved` or `final` column, and no status enum
  -- containing one. The platform is not in a position to mark a legal document
  -- approved, and a column named that way would be read as though it were —
  -- by users, and eventually by code deciding what may be sent.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index legal_document_drafts_creator_idx
  on public.legal_document_drafts (created_by, created_at desc);
create index legal_document_drafts_deal_idx on public.legal_document_drafts (deal_id);

create trigger legal_document_drafts_touch_updated_at
  before update on public.legal_document_drafts
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.valuation_estimates enable row level security;
alter table public.acquisition_criteria enable row level security;
alter table public.legal_document_drafts enable row level security;

alter table public.valuation_estimates force row level security;
alter table public.acquisition_criteria force row level security;
alter table public.legal_document_drafts force row level security;

-- Valuations are private to the seller who ran them. Not visible to admins
-- either: what a seller privately thinks their business might be worth is not
-- platform operations data, and an internal operator having ambient access to
-- every seller's price expectations is a bargaining asymmetry, not a feature.
create policy valuation_estimates_own on public.valuation_estimates
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Criteria are private to the buyer. The matching engine reads them
-- server-side; sellers see match results, never the raw criteria — those are a
-- buyer's negotiating position.
create policy acquisition_criteria_own on public.acquisition_criteria
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A draft is visible to its author, and to anyone in a conversation on the deal
-- it is attached to — the counterparty needs to read the LOI being sent to them.
create policy legal_document_drafts_read on public.legal_document_drafts
  for select to authenticated
  using (
    created_by = auth.uid()
    or (deal_id is not null and app.can_access_deal(deal_id))
  );

create policy legal_document_drafts_insert on public.legal_document_drafts
  for insert to authenticated
  with check (created_by = auth.uid());

create policy legal_document_drafts_update_own on public.legal_document_drafts
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- No delete policy. A draft that was shared into a deal room is part of the
-- negotiating record.

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- 0008 revoked the Supabase default, so these are unreachable until granted.

grant select, insert, update, delete on public.valuation_estimates to authenticated;
grant select, insert, update on public.acquisition_criteria to authenticated;
grant select, insert, update on public.legal_document_drafts to authenticated;
