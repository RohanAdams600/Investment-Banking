-- Tenancy: firms and firm membership.
--
-- Firms are the primary data boundary. A PE fund, a family office, and a
-- brokerage are all firms; they differ in `kind` and in the criteria they
-- attach, not in how they are isolated.

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind app.firm_kind not null default 'other',

  -- Verification is an admin workflow, not a self-service field. The check
  -- constraint pairs the reviewer and timestamp with the outcome so a verified
  -- firm always has a record of who verified it.
  verification_status app.verification_status not null default 'unverified',
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,

  -- Family offices default to higher discretion; see the spec's portal notes.
  -- Held as a firm-level default that individual listings can tighten further.
  discretion_level smallint not null default 1 check (discretion_level between 1 and 3),

  -- Who created the firm. Retained for audit even after they leave it, which is
  -- why this is SET NULL rather than part of the membership table.
  created_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint firms_verification_consistent check (
    (verification_status = 'verified' and verified_at is not null)
    or (verification_status <> 'verified')
  )
);

create index firms_kind_idx on public.firms (kind);
create index firms_verification_status_idx on public.firms (verification_status);

create trigger firms_touch_updated_at
  before update on public.firms
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------

create table public.firm_members (
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app.firm_role not null default 'member',
  created_at timestamptz not null default now(),

  -- One role per user per firm. A user may belong to several firms with a
  -- different role in each, which the composite key allows and a unique
  -- constraint on user_id alone would have wrongly prevented.
  primary key (firm_id, user_id)
);

create index firm_members_user_id_idx on public.firm_members (user_id);
