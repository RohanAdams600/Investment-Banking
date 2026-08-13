-- Fee agreements and commission records.
--
-- ---------------------------------------------------------------------------
-- Record-keeping only
-- ---------------------------------------------------------------------------
--
-- The specification puts payments and escrow out of scope for v1, and this
-- migration holds that line. Nothing here moves money. It records what was
-- agreed, what a closing produced, and what is owed to whom — which is what a
-- broker needs at the end of a quarter and what an accountant needs at the end
-- of a year.
--
-- The seam for a processor is deliberate and narrow. `commission_records` has a
-- status and the amounts a payout would need; wiring Stripe Connect later means
-- adding a transfer id and a webhook, not changing how a fee is calculated. The
-- calculation stays in `packages/core`, reproducible on paper, because a fee
-- somebody cannot check is a fee they will dispute.
--
-- ---------------------------------------------------------------------------
-- Why the schedule is stored as jsonb and the fee as integers
-- ---------------------------------------------------------------------------
--
-- The *schedule* varies in shape — Lehman has five bands, a custom engagement
-- might have two — so it is jsonb, and it is captured at signature the way
-- `consent_records` captures a template version. Renegotiating produces a new
-- agreement rather than an edit, because a fee computed under last year's terms
-- has to stay explicable.
--
-- The *amounts* are integer cents in real columns, because they are summed,
-- compared and exported, and because a number that appears on an invoice should
-- not be reconstructed from a document each time it is read.

create type app.fee_structure as enum ('lehman', 'double_lehman', 'flat', 'tiered');

create type app.commission_status as enum (
  -- The deal has not closed. Nothing is owed yet.
  'projected',
  -- Closed. The fee is owed and this is the record of it.
  'earned',
  -- Marked settled by the firm. v1 has no payment rail, so this is an
  -- assertion by a person, not a confirmation from a processor — the column
  -- comment says so, and the UI says so too.
  'settled',
  -- Written off, with a reason.
  'waived'
);

-- ---------------------------------------------------------------------------
-- Fee agreements
-- ---------------------------------------------------------------------------

create table public.fee_agreements (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete restrict,
  -- The listing this engagement covers. Null for a firm-wide default.
  listing_id uuid references public.listings (id) on delete cascade,

  structure app.fee_structure not null,

  -- For `flat`. Stored as a fraction: 0.100 is 10%.
  flat_rate numeric(5, 4) check (flat_rate is null or flat_rate between 0 and 1),

  /*
   * For `tiered`. The shape genuinely varies, and a column per band would cap
   * the number of bands in the schema. Validated by `calculateCommission`,
   * which throws on an out-of-order schedule rather than quietly computing
   * something plausible.
   */
  tiers jsonb,

  -- The floor under any success fee, and the most commercially important
  -- number here. A $300K business at 10% is $30K, which does not cover the
  -- time to run the deal properly.
  minimum_fee_cents bigint check (minimum_fee_cents is null or minimum_fee_cents >= 0),

  -- Share going to a co-broker on the other side. 0.5000 is an even split.
  co_broker_share numeric(5, 4) check (co_broker_share is null or co_broker_share between 0 and 1),

  -- Monthly retainer, if the engagement has one. Recorded here because it is
  -- part of the same agreement; it is not netted off the success fee unless
  -- the parties said so, and this schema does not assume they did.
  retainer_cents bigint check (retainer_cents is null or retainer_cents >= 0),

  -- Superseded rather than edited, so a fee computed last quarter stays
  -- explicable under the terms that produced it.
  effective_from timestamptz not null default now(),
  superseded_at timestamptz,

  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A flat structure needs a rate; a tiered one needs tiers. Caught here so a
  -- malformed agreement cannot be stored at all.
  constraint fee_agreements_flat_has_rate check (structure <> 'flat' or flat_rate is not null),
  constraint fee_agreements_tiered_has_tiers check (structure <> 'tiered' or tiers is not null)
);

create index fee_agreements_firm_idx on public.fee_agreements (firm_id) where superseded_at is null;
create index fee_agreements_listing_idx on public.fee_agreements (listing_id);

create trigger fee_agreements_touch_updated_at
  before update on public.fee_agreements
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Commission records
-- ---------------------------------------------------------------------------

create table public.commission_records (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete restrict,
  listing_id uuid references public.listings (id) on delete set null,
  agreement_id uuid references public.fee_agreements (id) on delete restrict,

  status app.commission_status not null default 'projected',

  sale_price_cents bigint not null check (sale_price_cents >= 0),

  -- What the schedule produced, and what is actually owed. Both stored: when
  -- the minimum raises a fee, a statement that shows only the final number
  -- invites the question this pair answers.
  calculated_fee_cents bigint not null check (calculated_fee_cents >= 0),
  total_fee_cents bigint not null check (total_fee_cents >= 0),
  co_broker_fee_cents bigint not null default 0 check (co_broker_fee_cents >= 0),
  net_fee_cents bigint not null check (net_fee_cents >= 0),

  -- The band-by-band working, as `calculateCommission` produced it. Kept so a
  -- statement can show how the number was reached years later, under whatever
  -- the schedule was at the time.
  bands jsonb not null default '[]'::jsonb,

  closed_at timestamptz,
  settled_at timestamptz,
  -- Required when waiving. A write-off with no stated reason is the kind of
  -- entry that cannot be explained in an audit.
  waived_reason text check (waived_reason is null or char_length(waived_reason) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_records_parts_sum check (
    co_broker_fee_cents + net_fee_cents = total_fee_cents
  ),
  constraint commission_records_earned_has_close check (
    status not in ('earned', 'settled') or closed_at is not null
  ),
  constraint commission_records_waived_has_reason check (
    status <> 'waived' or waived_reason is not null
  )
);

create index commission_records_firm_idx on public.commission_records (firm_id, status);
create index commission_records_listing_idx on public.commission_records (listing_id);

create trigger commission_records_touch_updated_at
  before update on public.commission_records
  for each row execute function app.touch_updated_at();

comment on column public.commission_records.settled_at is
  'Marked by a person at the firm. v1 has no payment rail, so this asserts that '
  'the firm considers the fee paid — it is not confirmation from a processor.';

-- ===========================================================================
-- Status transitions
-- ===========================================================================

create or replace function app.enforce_commission_transition()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- The money is not editable once the fee is earned. A commission record whose
  -- amounts can move after closing is not a record of anything.
  if old.status in ('earned', 'settled', 'waived') then
    if new.sale_price_cents <> old.sale_price_cents
       or new.total_fee_cents <> old.total_fee_cents
       or new.net_fee_cents <> old.net_fee_cents
       or new.co_broker_fee_cents <> old.co_broker_fee_cents then
      raise exception 'The amounts on a closed commission record cannot be changed'
        using errcode = '42501';
    end if;
  end if;

  -- Which firm earned it and which listing it came from are fixed.
  if new.firm_id <> old.firm_id or new.listing_id is distinct from old.listing_id then
    raise exception 'A commission record cannot be reassigned'
      using errcode = '42501';
  end if;

  -- Timestamps are the trigger's to write.
  if new.status = 'earned' and old.status <> 'earned' and new.closed_at is null then
    new.closed_at := now();
  end if;

  if new.status = 'settled' and old.status <> 'settled' then
    if old.status <> 'earned' then
      raise exception 'A fee must be earned before it can be settled'
        using errcode = '42501';
    end if;
    new.settled_at := now();
  end if;

  -- Settled is terminal. Unsettling would rewrite the record an accountant
  -- has already relied on.
  if old.status = 'settled' and new.status <> 'settled' then
    raise exception 'A settled commission cannot be reopened'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger commission_records_enforce_transition
  before update on public.commission_records
  for each row execute function app.enforce_commission_transition();

-- ===========================================================================
-- RLS
-- ===========================================================================

/*
 * Firm administrators.
 *
 * Mirrors `canAdministerFirm` in packages/core: owner or admin, never a plain
 * member. Fee schedules decide what everyone at the firm gets paid, so writing
 * one is not something every member should be able to do.
 *
 * `SECURITY DEFINER` for the usual reason — a policy's subqueries run under the
 * target table's RLS, and `firm_members` restricts a caller to their own firms.
 * That is fine for the row being checked and breaks down the moment the lookup
 * needs a row the caller cannot see. The definer avoids the whole question.
 */
create or replace function app.can_administer_firm(target_firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.firm_members
     where user_id = auth.uid()
       and firm_id = target_firm_id
       and role in ('owner', 'admin')
  );
$$;

revoke all on function app.can_administer_firm(uuid) from public, anon;
grant execute on function app.can_administer_firm(uuid) to authenticated;

alter table public.fee_agreements enable row level security;
alter table public.commission_records enable row level security;

alter table public.fee_agreements force row level security;
alter table public.commission_records force row level security;

/*
 * Fee agreements are firm business.
 *
 * `commission:view_own` and `commission:configure` in the capability catalog
 * split reading from writing; here, membership gates reading and the firm's
 * own admins gate writing. A broker at the firm can see the terms of an
 * engagement their colleague signed, which is how a firm works.
 *
 * Notably absent: the seller. A seller sees their fee in the engagement letter
 * they signed, not by querying the brokerage's schedule table — and a listing's
 * fee agreement often covers other listings too.
 */
create policy fee_agreements_select_firm on public.fee_agreements
  for select to authenticated
  using (app.is_firm_member(firm_id) or app.is_platform_admin());

create policy fee_agreements_write_admin on public.fee_agreements
  for insert to authenticated
  with check (app.can_administer_firm(firm_id) and created_by = auth.uid());

create policy fee_agreements_update_admin on public.fee_agreements
  for update to authenticated
  using (app.can_administer_firm(firm_id))
  with check (app.can_administer_firm(firm_id));

create policy commission_records_select_firm on public.commission_records
  for select to authenticated
  using (app.is_firm_member(firm_id) or app.is_platform_admin());

create policy commission_records_write_admin on public.commission_records
  for insert to authenticated
  with check (app.can_administer_firm(firm_id));

create policy commission_records_update_admin on public.commission_records
  for update to authenticated
  using (app.can_administer_firm(firm_id))
  with check (app.can_administer_firm(firm_id));

-- No delete policy on either. A fee that was agreed and a fee that was earned
-- are both records of something that happened; a mistaken one is waived with a
-- reason, which leaves a trail, rather than removed, which does not.

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select, insert, update on public.fee_agreements to authenticated;
grant select, insert, update on public.commission_records to authenticated;
