-- Paid placement at the top of the market.
--
-- ---------------------------------------------------------------------------
-- The one thing that is not optional
-- ---------------------------------------------------------------------------
--
-- A marketplace that ranks by payment and does not say so is running deceptive
-- advertising, and that is a statement about US consumer-protection law rather
-- than about taste. The FTC's position on search advertising is that paid
-- placement must be distinguishable from unpaid results by a clear and
-- conspicuous disclosure — the obligation sits on whoever runs the ranking,
-- which is us.
--
-- So the disclosure is not a UI decision that a later redesign can quietly drop.
-- `browseListings` returns the flag on the row, the card renders it, and a test
-- asserts a promoted listing cannot reach a buyer without it. If somebody wants
-- to remove the label they have to delete a test that says why it is there.
--
-- Nothing here guarantees compliance with anything. It is the mechanism that
-- makes disclosure possible and hard to lose; whether the wording and placement
-- satisfy a regulator in a given state is a question for the operator's counsel.
--
-- ---------------------------------------------------------------------------
-- No money moves
-- ---------------------------------------------------------------------------
--
-- Payments remain out of scope, exactly as with commission. This records that a
-- promotion was sold, for how much, and over what window. Taking the money is an
-- invoice somewhere else until there is a payment rail, and `amount_cents` is
-- the seam a Stripe subscription would later fill in.

create table if not exists public.listing_promotions (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null references public.listings (id) on delete cascade,

  -- Who sold it. An operator action, never a self-service upgrade a seller can
  -- grant themselves — see the policies below.
  granted_by uuid not null references auth.users (id) on delete restrict,

  /*
   * The window. Half-open: starts_at inclusive, ends_at exclusive, so two
   * consecutive months do not both claim the boundary instant.
   */
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,

  /*
   * Ranking weight among promoted listings. Higher sorts first. Deliberately a
   * small integer rather than a bid: an auction is a different product with
   * different disclosure obligations, and this is a placement somebody bought
   * for a month.
   */
  rank integer not null default 0 check (rank between 0 and 1000),

  -- Record-keeping only. Nothing in this platform charges a card.
  amount_cents bigint check (amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  note text check (note is null or char_length(note) <= 1000),

  cancelled_at timestamptz,

  created_at timestamptz not null default now(),

  constraint listing_promotions_window check (ends_at > starts_at)
);

comment on table public.listing_promotions is
  'Paid placement at the top of browse. Record-keeping only — no money moves through this platform. Every promoted listing is labelled as such to buyers.';

-- The lookup browse does on every page load: which promotions are live now.
create index if not exists listing_promotions_active_idx
  on public.listing_promotions (listing_id, starts_at, ends_at)
  where cancelled_at is null;

-- `on delete restrict` on granted_by makes deleting an operator scan this table.
create index if not exists listing_promotions_granted_by_idx
  on public.listing_promotions (granted_by);

alter table public.listing_promotions enable row level security;
alter table public.listing_promotions force row level security;

-- ---------------------------------------------------------------------------
-- Who may see and sell a promotion
-- ---------------------------------------------------------------------------

/*
 * Anybody who can see the listing may see that it is promoted.
 *
 * This is the policy that makes the disclosure structural rather than cosmetic.
 * If the row were hidden from buyers, the label would depend on the application
 * remembering to fetch it through a privileged path — and a label that can be
 * lost by forgetting a join is not a disclosure.
 */
create policy listing_promotions_select_visible
  on public.listing_promotions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.id = listing_promotions.listing_id
         and l.status in ('live', 'under_loi', 'under_contract')
    )
    or app.controls_listing(listing_promotions.listing_id)
    or app.is_platform_admin()
  );

/*
 * Only an operator sells one.
 *
 * A seller who could insert here would put themselves at the top of the market
 * for free, which is the whole failure mode. Selling placement is an act by
 * whoever runs the platform, and it is recorded against them.
 */
create policy listing_promotions_insert_admin
  on public.listing_promotions
  for insert
  to authenticated
  with check (app.is_platform_admin() and granted_by = (select auth.uid()));

/*
 * Cancellation only.
 *
 * A promotion is a record of something sold; rewriting its window or its price
 * after the fact turns the ledger into a draft. An operator may cancel, which
 * ends the placement and leaves the row saying what it always said.
 */
create policy listing_promotions_update_admin
  on public.listing_promotions
  for update
  to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

create or replace function app.enforce_promotion_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  probe public.listing_promotions;
begin
  probe := new;
  probe.cancelled_at := old.cancelled_at;

  if probe is distinct from old then
    raise exception 'A promotion may only be cancelled, not rewritten'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger listing_promotions_enforce_update
  before update on public.listing_promotions
  for each row execute function app.enforce_promotion_update();

grant select, insert, update on public.listing_promotions to authenticated;

-- ---------------------------------------------------------------------------
-- Is this listing promoted right now?
-- ---------------------------------------------------------------------------
--
-- One place that answers it, so browse, the listing page and any later surface
-- cannot drift apart on what "promoted" means.

create or replace function public.active_promotion_rank(target_listing_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select max(p.rank)
    from public.listing_promotions p
   where p.listing_id = target_listing_id
     and p.cancelled_at is null
     and p.starts_at <= now()
     and p.ends_at > now();
$$;

/*
 * Postgres grants EXECUTE to PUBLIC on every function at creation, and 0006's
 * blanket grant to `anon` on the `app` schema is still in force. Both mean a new
 * helper is reachable by an unauthenticated caller unless it is revoked back —
 * which a schema test asserts, and which is how this line came to exist.
 *
 * A visitor cannot browse the market at all, so there is nothing here for them.
 */
revoke all on function public.active_promotion_rank(uuid) from public, anon;
grant execute on function public.active_promotion_rank(uuid) to authenticated;

comment on function public.active_promotion_rank(uuid) is
  'Ranking weight if this listing is promoted right now, else null. SECURITY INVOKER: a caller who cannot see the promotion row cannot see the rank.';
