-- Business listings.
--
-- The central shape decision here is the split between `listings` and
-- `listing_details`, and it follows from a property of Postgres rather than a
-- preference:
--
--   **Row Level Security is row-level, not column-level.**
--
-- A single table cannot show a browsing buyer the industry and revenue band
-- while hiding the company name and address. Column privileges exist but are
-- static per role, not per row, so they cannot express "this buyer, on this
-- listing, has signed". The only way to make the confidential half genuinely
-- unreachable is to put it in its own row, in its own table, behind its own
-- policy.
--
-- Everything a browsing buyer may see lives in `listings`. Everything that
-- identifies the business lives in `listing_details`, and that table is gated on
-- an executed NDA in 0016.
--
-- This is the most consequential boundary in the product. A seller's business
-- being identifiable before they chose to disclose it can cost them staff,
-- customers, and the sale itself.

create type app.listing_status as enum (
  'draft',
  'pending_review',
  'live',
  'under_loi',
  'under_contract',
  'closed',
  'withdrawn'
);

create type app.deal_structure as enum ('asset', 'stock');

create type app.growth_trend as enum ('declining', 'flat', 'growing', 'rapid');

create type app.owner_dependence as enum ('absentee', 'moderate', 'critical');

create type app.nda_status as enum ('none', 'requested', 'sent', 'signed', 'revoked', 'expired');

-- ---------------------------------------------------------------------------
-- Teaser — anonymised, and publicly readable once live
-- ---------------------------------------------------------------------------
--
-- Every column here is safe for an unidentified buyer to see. Nothing in this
-- table names the business, locates it more precisely than a state, or gives an
-- exact financial figure — bands only.
--
-- If a column is added here, the question to ask is: could a competitor read
-- this row and work out which company it is? Industry plus state plus an exact
-- revenue figure often identifies a business on its own, which is why the
-- financials here are bands.
create table public.listings (
  id uuid primary key default gen_random_uuid(),

  seller_id uuid not null references auth.users (id) on delete restrict,
  -- The brokerage managing it, if any. Drives `listing:manage_for_client`.
  firm_id uuid references public.firms (id) on delete set null,

  status app.listing_status not null default 'draft',

  -- Anonymised headline. "Established HVAC contractor in the Southeast", not
  -- the company name.
  headline text not null check (length(trim(headline)) between 10 and 200),
  summary text check (summary is null or char_length(summary) <= 4000),

  industry text not null,
  -- State only. A city plus an industry identifies most lower-middle-market
  -- businesses, so the teaser stops at the state line.
  jurisdiction_code text not null references public.jurisdictions (code) on delete restrict,

  -- Bands, not exact figures.
  revenue_band_low_cents bigint check (revenue_band_low_cents >= 0),
  revenue_band_high_cents bigint check (revenue_band_high_cents >= 0),
  earnings_band_low_cents bigint check (earnings_band_low_cents >= 0),
  earnings_band_high_cents bigint check (earnings_band_high_cents >= 0),
  asking_price_band_low_cents bigint check (asking_price_band_low_cents >= 0),
  asking_price_band_high_cents bigint check (asking_price_band_high_cents >= 0),

  deal_structure app.deal_structure not null default 'asset',
  employee_count integer check (employee_count >= 0),
  years_in_business integer check (years_in_business >= 0),
  growth_trend app.growth_trend,
  real_estate_included boolean not null default false,
  owner_dependence app.owner_dependence,

  -- Broad enough not to identify the seller. "Retirement", not "owner's health".
  reason_for_sale text check (reason_for_sale is null or char_length(reason_for_sale) <= 500),

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint listings_bands_ordered check (
    (revenue_band_low_cents is null or revenue_band_high_cents is null
      or revenue_band_high_cents >= revenue_band_low_cents)
    and (earnings_band_low_cents is null or earnings_band_high_cents is null
      or earnings_band_high_cents >= earnings_band_low_cents)
    and (asking_price_band_low_cents is null or asking_price_band_high_cents is null
      or asking_price_band_high_cents >= asking_price_band_low_cents)
  )
);

create index listings_status_idx on public.listings (status) where status = 'live';
create index listings_seller_idx on public.listings (seller_id);
create index listings_firm_idx on public.listings (firm_id);
create index listings_browse_idx
  on public.listings (industry, jurisdiction_code, earnings_band_low_cents)
  where status in ('live', 'under_loi', 'under_contract');

create trigger listings_touch_updated_at
  before update on public.listings
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Full profile — behind the NDA
-- ---------------------------------------------------------------------------
--
-- One row per listing, holding everything that identifies the business. Kept
-- separate purely so RLS can hide it; conceptually it is the same record.
create table public.listing_details (
  listing_id uuid primary key references public.listings (id) on delete cascade,

  legal_name text not null,
  trading_name text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,

  website text,

  -- Exact figures, unlike the bands on the teaser.
  revenue_cents bigint check (revenue_cents >= 0),
  earnings_cents bigint,
  asking_price_cents bigint check (asking_price_cents >= 0),

  -- The number buyers care about most and sellers disclose last.
  customer_concentration numeric(4, 3) check (customer_concentration between 0 and 1),
  recurring_revenue_share numeric(4, 3) check (recurring_revenue_share between 0 and 1),

  key_customers text,
  competitive_position text,
  growth_opportunities text,
  known_risks text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger listing_details_touch_updated_at
  before update on public.listing_details
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Financials by year
-- ---------------------------------------------------------------------------
--
-- Also behind the NDA — a three-year revenue series identifies a business as
-- readily as its name in a small sector.
create table public.listing_financials (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,

  fiscal_year integer not null check (fiscal_year between 1900 and 2200),
  revenue_cents bigint not null check (revenue_cents >= 0),
  -- May be negative: a loss-making year is a fact, not an input error.
  ebitda_cents bigint,
  sde_cents bigint,
  addbacks_cents bigint check (addbacks_cents >= 0),

  created_at timestamptz not null default now(),

  unique (listing_id, fiscal_year)
);

create index listing_financials_listing_idx
  on public.listing_financials (listing_id, fiscal_year desc);

-- ---------------------------------------------------------------------------
-- NDAs
-- ---------------------------------------------------------------------------
--
-- One per buyer per listing. This row is the gate on `listing_details`.
--
-- `template_id` and `template_version` are captured at signature, for the same
-- reason `consent_records` captures them: the wording someone agreed to has to
-- be reproducible years later, and a template edited since then cannot do that.
create table public.listing_ndas (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete restrict,

  status app.nda_status not null default 'requested',

  template_id uuid references public.legal_templates (id) on delete restrict,
  template_version integer,

  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  signed_at timestamptz,
  -- Null means no expiry. Checked rather than assumed everywhere it matters.
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,

  -- Captured at signature for evidentiary weight, as with consent records.
  signer_ip inet,
  signer_user_agent text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (listing_id, buyer_id),

  -- A signed NDA must record when. Without this, `status = 'signed'` with a null
  -- timestamp would pass the gate while being unprovable afterwards.
  constraint listing_ndas_signed_has_timestamp check (
    status <> 'signed' or signed_at is not null
  )
);

create index listing_ndas_buyer_idx on public.listing_ndas (buyer_id, status);
create index listing_ndas_listing_idx on public.listing_ndas (listing_id, status);

create trigger listing_ndas_touch_updated_at
  before update on public.listing_ndas
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Status history
-- ---------------------------------------------------------------------------
--
-- Append-only. The specification requires every transition logged, and this is
-- the record that answers "when did this go under LOI" during a commission
-- dispute.
create table public.listing_status_history (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,

  -- Null on the first row: nothing preceded 'draft'.
  from_status app.listing_status,
  to_status app.listing_status not null,

  actor_id uuid references auth.users (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 1000),
  changed_at timestamptz not null default now()
);

create index listing_status_history_listing_idx
  on public.listing_status_history (listing_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Watchlist
-- ---------------------------------------------------------------------------

create table public.listing_saves (
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),

  primary key (listing_id, user_id)
);

create index listing_saves_user_idx on public.listing_saves (user_id, created_at desc);
