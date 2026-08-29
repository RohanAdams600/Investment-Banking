-- Buyer verification, and the trust asymmetry it exists to fix.
--
-- ---------------------------------------------------------------------------
-- The problem
-- ---------------------------------------------------------------------------
--
-- A seller is asked to hand the name of their company, their address and their
-- exact earnings to a stranger who typed an email address into a form. The
-- confidentiality machinery makes that disclosure revocable and auditable; it
-- does nothing about whether the stranger can actually buy anything.
--
-- So sellers do the rational thing and refuse, or stall, and NDA conversion —
-- the one number this marketplace lives on — collapses. Every functioning
-- version of this market solves it the same way: the buyer evidences capacity
-- once, an operator reviews it, and the seller sees the outcome rather than the
-- evidence.
--
-- ---------------------------------------------------------------------------
-- What a seller may see, and what they may not
-- ---------------------------------------------------------------------------
--
-- A seller sees a status and a broad capacity band. They never see the bank
-- letter, the lender's name, the fund, the note the buyer wrote, or an exact
-- figure.
--
-- The exact figure is the important omission. "This buyer has $4.2m" handed to
-- a seller before a price is agreed is negotiating leverage transferred from
-- one side to the other by the platform, which is not a service either party
-- asked for. Bands are wide on purpose.
--
-- This is enforced structurally rather than by an interface. Sellers have no
-- policy on `buyer_verifications` at all — not a narrowed one, none. Row Level
-- Security is row-level, so a policy that let a seller read the row would let
-- them read the evidence in it. The badge therefore comes through a function
-- that selects columns, and the table stays closed.
--
-- ---------------------------------------------------------------------------
-- What this is not
-- ---------------------------------------------------------------------------
--
-- It is not a credit check, a source-of-funds investigation, an accredited
-- investor determination, or a KYC/AML programme, and nothing here makes the
-- operator compliant with any of those regimes. It records that a human looked
-- at evidence a buyer offered and formed a view. Whether that is sufficient for
-- a given jurisdiction, transaction size, or regulator is a question for the
-- operator's own counsel.
--
-- Reviews are performed by people. There is no automatic path to 'verified' in
-- this file — no trigger, no default, no function grants it — because a status
-- a machine can award is a status a buyer can engineer.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'funding_verification_status') then
    /*
     * Deliberately not `app.verification_status`, which already exists and
     * belongs to identity: whether a person or firm is who they say they are.
     * This is whether a buyer can pay, which is a different question with a
     * different reviewer, a different expiry and a different consequence when
     * it is wrong. Sharing one enum between them would eventually mean sharing
     * one status column, and an identity check would start reading as a
     * financial one.
     *
     * No 'expired' value. Expiry is a date passing, not a transition somebody
     * performs, and a status that has to be swept by a job is a status that is
     * wrong between sweeps. `buyer_verification_badge` derives currency from
     * `expires_at` at read time instead.
     */
    create type app.funding_verification_status as enum (
      'pending', 'verified', 'rejected', 'withdrawn'
    );
  end if;

  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'funding_evidence_kind') then
    -- Named for evidence rather than `funding_source`, which is already a
    -- free-text column on the buyer profile. Two things called the same name
    -- with different types is how somebody eventually joins one to the other.
    create type app.funding_evidence_kind as enum (
      'cash',                    -- personal or corporate liquidity
      'sba_preapproval',         -- lender pre-approval, the common US path
      'lender_commitment',       -- a commitment letter from a bank
      'committed_fund',          -- a fund with capital already committed
      'search_fund',             -- searcher with investor backing
      'seller_financing_sought', -- honest, and worth being able to say
      'other'
    );
  end if;

  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'capacity_band') then
    /*
     * Bands, never an amount. See the header — an exact figure shown to a
     * seller before price is agreed is leverage this platform has no business
     * transferring. The column type makes that a schema property rather than a
     * rendering decision somebody can revisit.
     */
    create type app.capacity_band as enum (
      'under_250k',
      'from_250k_to_1m',
      'from_1m_to_5m',
      'from_5m_to_25m',
      'over_25m'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The record
-- ---------------------------------------------------------------------------

create table if not exists public.buyer_verifications (
  id uuid primary key default gen_random_uuid(),

  -- One per buyer. A second submission edits the first; a history of rejected
  -- attempts is a record of somebody's finances that nobody needs to keep.
  buyer_id uuid not null unique references auth.users (id) on delete cascade,

  status app.funding_verification_status not null default 'pending',

  evidence_kind app.funding_evidence_kind not null,
  capacity_band app.capacity_band not null,

  /*
   * What the buyer says they can produce, in their own words. Deliberately a
   * note rather than an upload: the document vault is per-deal and scoped to a
   * deal's participants, and a bank letter sitting in a platform-wide table is
   * a larger liability than the feature is worth. An operator asks for the
   * document out of band, reads it, and records the outcome here.
   */
  evidence_note text check (evidence_note is null or char_length(evidence_note) <= 2000),

  submitted_at timestamptz not null default now(),

  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  -- The operator's reasoning, shown to the buyer. A rejection a buyer cannot
  -- understand is a support ticket and, eventually, a complaint.
  review_note text check (review_note is null or char_length(review_note) <= 2000),

  /*
   * Verification goes stale. Proof of funds from eighteen months ago tells a
   * seller nothing, and presenting it as current would be the platform
   * vouching for something it has not checked.
   */
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decision must record who made it and when. Without this, 'verified' with
  -- nulls in both columns passes every gate and is unprovable afterwards.
  constraint buyer_verifications_decided_is_attributable check (
    status in ('pending', 'withdrawn')
    or (reviewed_at is not null and reviewed_by is not null)
  ),

  -- A verification that is current must say until when.
  constraint buyer_verifications_verified_expires check (
    status <> 'verified' or expires_at is not null
  )
);

comment on table public.buyer_verifications is
  'Evidence of a buyer''s capacity to transact, reviewed by a person. Sellers never read this table — they read buyer_verification_badge(), which returns a status and a band and no evidence.';

create index if not exists buyer_verifications_status_idx
  on public.buyer_verifications (status, submitted_at desc);

drop trigger if exists buyer_verifications_touch_updated_at on public.buyer_verifications;
create trigger buyer_verifications_touch_updated_at
  before update on public.buyer_verifications
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.buyer_verifications enable row level security;
alter table public.buyer_verifications force row level security;

drop policy if exists buyer_verifications_select_own on public.buyer_verifications;
create policy buyer_verifications_select_own
  on public.buyer_verifications
  for select
  to authenticated
  using (buyer_id = (select auth.uid()) or app.is_platform_admin());

drop policy if exists buyer_verifications_insert_own on public.buyer_verifications;
create policy buyer_verifications_insert_own
  on public.buyer_verifications
  for insert
  to authenticated
  with check (
    buyer_id = (select auth.uid())
    -- A buyer submits; a buyer does not decide. The trigger below says the
    -- same thing for updates, and both are needed: this stops the first row
    -- arriving pre-approved.
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and review_note is null
    and expires_at is null
  );

drop policy if exists buyer_verifications_update on public.buyer_verifications;
create policy buyer_verifications_update
  on public.buyer_verifications
  for update
  to authenticated
  using (buyer_id = (select auth.uid()) or app.is_platform_admin())
  with check (buyer_id = (select auth.uid()) or app.is_platform_admin());

/*
 * Who may change what.
 *
 * The policy above lets two very different people write to this row, and a
 * policy cannot express "this column, not that one". The split lives here.
 *
 * Note the ordering: `probe` starts as the new row and has the *permitted*
 * columns reset to their old values. Whatever still differs is a column the
 * caller was not entitled to touch.
 */
create or replace function app.enforce_buyer_verification_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  probe public.buyer_verifications;
begin
  probe := new;
  probe.updated_at := old.updated_at;

  if app.is_platform_admin() then
    -- The reviewer decides the outcome and nothing else. An operator quietly
    -- editing the buyer's stated funding source would make the record a
    -- description of the operator's opinion rather than the buyer's claim.
    probe.status := old.status;
    probe.reviewed_at := old.reviewed_at;
    probe.reviewed_by := old.reviewed_by;
    probe.review_note := old.review_note;
    probe.expires_at := old.expires_at;

    if probe is distinct from old then
      raise exception 'A reviewer may only record a decision, not rewrite the submission'
        using errcode = '42501';
    end if;

    -- Attribution is not the reviewer's to assign. Taken from the session so a
    -- decision cannot be recorded against somebody else.
    if new.status is distinct from old.status then
      new.reviewed_at := now();
      new.reviewed_by := (select auth.uid());
    end if;

    return new;
  end if;

  /*
   * The buyer. May correct their own submission, and only while it is still
   * pending — editing the claim after it was approved would leave a 'verified'
   * badge attached to a statement nobody reviewed.
   */
  if old.status <> 'pending' and new.status <> 'withdrawn' then
    raise exception 'A submission may only be changed while it is pending'
      using errcode = '42501';
  end if;

  probe.evidence_kind := old.evidence_kind;
  probe.capacity_band := old.capacity_band;
  probe.evidence_note := old.evidence_note;
  probe.submitted_at := old.submitted_at;
  -- Withdrawal is the one status change a buyer may make about themselves.
  if new.status = 'withdrawn' then
    probe.status := old.status;
  end if;

  if probe is distinct from old then
    raise exception 'A buyer may only edit their own submission, or withdraw it'
      using errcode = '42501';
  end if;

  if new.status = 'withdrawn' and old.status = 'withdrawn' then
    return new;
  end if;

  new.submitted_at := now();
  return new;
end;
$$;

drop trigger if exists buyer_verifications_enforce_update on public.buyer_verifications;
create trigger buyer_verifications_enforce_update
  before update on public.buyer_verifications
  for each row execute function app.enforce_buyer_verification_update();

/*
 * No delete policy, so nobody can delete. A buyer withdraws instead, which
 * leaves the operator's decision history intact — the alternative is a buyer
 * who was rejected deleting the row and resubmitting until somebody says yes.
 */
grant select, insert, update on public.buyer_verifications to authenticated;

-- ---------------------------------------------------------------------------
-- What the seller sees
-- ---------------------------------------------------------------------------
--
-- Definer rather than invoker, because the whole point is to return something
-- from a table the caller cannot read. That makes the guard inside the
-- function the only thing standing between a seller and somebody's finances,
-- so it is written first and returns nothing by default.

create or replace function public.buyer_verification_badge(target_buyer uuid)
returns table (
  status app.funding_verification_status,
  capacity_band app.capacity_band,
  verified_at timestamptz,
  expires_at timestamptz,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := (select auth.uid());
  permitted boolean := false;
begin
  if caller is null then
    return;
  end if;

  if caller = target_buyer or app.is_platform_admin() then
    permitted := true;
  else
    /*
     * A seller may see the badge of a buyer who has approached one of their
     * listings — at any NDA status, including 'requested'.
     *
     * The 'requested' case is the one that matters. That is the exact moment
     * the seller is deciding whether to disclose, and a badge they can only
     * see after disclosing would be answering the question too late to be of
     * any use.
     */
    select exists (
      select 1
        from public.listing_ndas n
       where n.buyer_id = target_buyer
         and app.controls_listing(n.listing_id)
    ) into permitted;
  end if;

  if not permitted then
    return;
  end if;

  return query
    select v.status,
           v.capacity_band,
           v.reviewed_at,
           v.expires_at,
           -- Currency derived here rather than stored. See the enum comment:
           -- a swept status is wrong between sweeps.
           (v.status = 'verified' and v.expires_at > now())
      from public.buyer_verifications v
     where v.buyer_id = target_buyer;
end;
$$;

comment on function public.buyer_verification_badge(uuid) is
  'A status and a capacity band, for a buyer who has approached one of the caller''s listings. Never returns evidence, a reviewer note, or an exact figure.';

-- Postgres grants EXECUTE to PUBLIC on creation, which for a definer function
-- reading somebody's finances is not a default to leave in place.
revoke all on function public.buyer_verification_badge(uuid) from public, anon;
grant execute on function public.buyer_verification_badge(uuid) to authenticated;
