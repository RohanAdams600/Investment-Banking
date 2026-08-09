-- Compliance: jurisdictions, versioned legal templates, and consent records.
--
-- Built now rather than later on purpose. Consent records are retained for
-- their legal life and cannot be reconstructed after the fact: if a row does
-- not say which jurisdiction's disclosure, at which version, a user accepted,
-- that information is gone. The columns are cheap today and impossible to
-- backfill.

create table public.jurisdictions (
  -- 'US-CA', 'US-NY'. ISO 3166-2 shaped so international expansion needs no
  -- new key format.
  code text primary key check (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  name text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),

  -- Whether the platform currently accepts users in this jurisdiction. The
  -- switch that makes a staged multi-state rollout a config change.
  is_active boolean not null default false,

  -- Jurisdiction-specific requirements, read by the disclosure layer. Held as
  -- jsonb because the shape genuinely varies by state and a rigid column set
  -- would be wrong within a quarter.
  requirements jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger jurisdictions_touch_updated_at
  before update on public.jurisdictions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------

create type app.legal_template_kind as enum (
  'nda',
  'broker_agreement',
  'terms_of_use',
  'privacy_policy',
  'broker_licensing_disclosure',
  'not_a_securities_offering'
);

-- Versioned, admin-editable legal templates. Never hard-coded strings in the
-- UI: the text a user agreed to has to be reproducible years later, and a
-- string in a React component that has since been edited cannot do that.
create table public.legal_templates (
  id uuid primary key default gen_random_uuid(),
  kind app.legal_template_kind not null,

  -- Null means the template applies platform-wide rather than to one state.
  jurisdiction_code text references public.jurisdictions (code) on delete restrict,

  version integer not null check (version > 0),
  title text not null,
  body text not null,

  -- A template becomes usable when published and stops being offered when
  -- superseded. Rows are never deleted or edited in place — a new version is
  -- inserted, because consent records point at a specific version.
  published_at timestamptz,
  superseded_at timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  unique (kind, jurisdiction_code, version),

  constraint legal_templates_superseded_after_published check (
    superseded_at is null or (published_at is not null and superseded_at >= published_at)
  )
);

create index legal_templates_lookup_idx
  on public.legal_templates (kind, jurisdiction_code, version desc);

-- ---------------------------------------------------------------------------

-- What each user consented to, when, and to exactly which text.
--
-- Append-only. There is no update or delete policy anywhere below, and that is
-- the point: a consent record that can be modified is not evidence of anything.
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  template_id uuid not null references public.legal_templates (id) on delete restrict,

  -- Denormalised from the template at the time of acceptance. Deliberate
  -- duplication: this row must remain readable and meaningful even if the
  -- template row is later reorganised, and it is what makes the record
  -- self-contained evidence.
  template_kind app.legal_template_kind not null,
  template_version integer not null,
  jurisdiction_code text references public.jurisdictions (code) on delete restrict,

  accepted_at timestamptz not null default now(),

  -- Captured for evidentiary weight. Both are personal data and are covered by
  -- the retention exception documented in docs/data-model.md — they survive
  -- account deletion because the consent record does.
  ip_address inet,
  user_agent text
);

create index consent_records_user_idx on public.consent_records (user_id, accepted_at desc);
create index consent_records_template_idx on public.consent_records (template_id);

-- ON DELETE RESTRICT on `user_id`, not CASCADE.
--
-- Deleting an account must not silently delete the evidence that the person
-- agreed to the terms. The account-deletion flow anonymises the profile and
-- leaves this row standing, and the user is told so at the time of the request.
