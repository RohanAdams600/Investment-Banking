-- Listings: helpers, status lifecycle, policies, grants.

-- ===========================================================================
-- Helpers
-- ===========================================================================

-- Who may bring a business to market. The SQL half of `listing:create`; a test
-- asserts the two agree for every platform role.
create or replace function app.can_create_listing()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.has_platform_role('seller') or app.has_platform_role('broker');
$$;

-- Who may sign an NDA and therefore reach a full profile. The SQL half of
-- `nda:sign`, which every buy-side role carries — not just `buyer`. Writing this
-- as `has_platform_role('buyer')` would have locked family offices and search
-- funds out of the market, which is the kind of divergence the parity test on
-- this function exists to catch.
create or replace function app.is_buy_side()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = auth.uid()
       and role in ('buyer', 'investor', 'search_fund', 'private_equity', 'family_office')
  );
$$;

-- Whether the caller owns the listing outright, or manages it through the firm
-- it is attached to. Mirrors `controlsListing` in packages/core.
create or replace function app.controls_listing(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.listings l
     where l.id = target_listing_id
       and (
         l.seller_id = auth.uid()
         or (
           l.firm_id is not null
           and app.is_firm_member(l.firm_id)
           and app.has_platform_role('broker')
         )
       )
  );
$$;

/*
 * The NDA gate.
 *
 * This is the single most consequential predicate in the schema, and it is the
 * database's independent statement of the rule that `canViewFullListing`
 * enforces in application code. Neither is sufficient alone — a route that
 * forgets the application check still meets this one.
 *
 * Four conditions, all load-bearing:
 *
 *   - the NDA belongs to this listing and this caller
 *   - it is signed, not merely requested or sent
 *   - it has not been revoked
 *   - it has not expired
 *
 * The expiry comparison is `> now()` rather than `>= now()`, matching the
 * application's exclusive boundary. An NDA expiring exactly now is closed in
 * both places; agreeing on the edge case matters less than agreeing.
 */
create or replace function app.has_executed_nda(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.listing_ndas n
     where n.listing_id = target_listing_id
       and n.buyer_id = auth.uid()
       and n.status = 'signed'
       and n.revoked_at is null
       and (n.expires_at is null or n.expires_at > now())
  );
$$;

-- Statuses at which the anonymised teaser is discoverable. Drafts and
-- withdrawn listings are not, and closed ones drop out of the market.
create or replace function app.listing_is_discoverable(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.listings l
     where l.id = target_listing_id
       and l.status in ('live', 'under_loi', 'under_contract')
  );
$$;

-- ===========================================================================
-- Status lifecycle
-- ===========================================================================
--
-- Draft → Pending Review → Live → Under LOI → Under Contract → Closed
-- with Withdrawn reachable from anything not yet closed.
--
-- Enforced in a trigger rather than a check constraint because the rule is
-- about the *transition*, which needs OLD as well as NEW.
create or replace function app.enforce_listing_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  allowed boolean;
  probe public.listings;
begin
  -- Ownership is not editable. The UPDATE policy's WITH CHECK calls
  -- `controls_listing`, which reads the *committed* row — so it evaluates the
  -- old owner and would happily let a seller hand their listing to somebody
  -- else. This is the check that actually stops that.
  if new.seller_id <> old.seller_id then
    raise exception 'A listing cannot be transferred to another seller'
      using errcode = '42501';
  end if;

  -- Attaching a listing to a firm grants every broker at that firm control of
  -- it. A caller-supplied id has to be proven, exactly as in `create_deal`.
  if new.firm_id is distinct from old.firm_id
     and new.firm_id is not null
     and not app.is_firm_member(new.firm_id) then
    raise exception 'Not a member of that firm'
      using errcode = '42501';
  end if;

  -- Stamped below, never accepted from the caller: "when did this go live" has
  -- to mean when it actually did.
  new.published_at := old.published_at;

  -- A platform administrator reaches this table through `listings_update_admin`,
  -- for taking a listing down. That is moderation, and moderation is a status
  -- change; rewriting a seller's copy is not. Rather than trusting the route to
  -- send a narrow update, the narrowness is enforced here: every column except
  -- the status must be untouched.
  if not app.controls_listing(old.id) then
    probe := new;
    probe.status := old.status;
    probe.updated_at := old.updated_at;

    if probe is distinct from old then
      raise exception 'A listing may only be moderated by changing its status'
        using errcode = '42501';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'draft'          then new.status in ('pending_review', 'withdrawn')
    when 'pending_review' then new.status in ('live', 'draft', 'withdrawn')
    when 'live'           then new.status in ('under_loi', 'withdrawn')
    when 'under_loi'      then new.status in ('under_contract', 'live', 'withdrawn')
    when 'under_contract' then new.status in ('closed', 'under_loi', 'withdrawn')
    -- Terminal. A closed or withdrawn listing is history: commission records
    -- and the audit trail point at it, and reopening one would rewrite what the
    -- parties actually did. Relisting is a new listing.
    when 'closed'         then false
    when 'withdrawn'      then false
  end;

  if not allowed then
    raise exception 'Cannot move a listing from % to %', old.status, new.status
      using errcode = '42501';
  end if;

  -- Stamped here rather than trusted to the caller, so "when did this go live"
  -- is answerable even if the route that changed it forgot.
  if new.status = 'live' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

create trigger listings_enforce_status_transition
  before update on public.listings
  for each row execute function app.enforce_listing_status_transition();

-- Written by the database so no code path can skip it.
create or replace function app.log_listing_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.listing_status_history (listing_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, auth.uid());
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.listing_status_history (listing_id, from_status, to_status, actor_id)
    values (new.id, old.status, new.status, auth.uid());
  end if;

  return null;
end;
$$;

create trigger listings_log_status_insert
  after insert on public.listings
  for each row execute function app.log_listing_status_change();

create trigger listings_log_status_update
  after update on public.listings
  for each row execute function app.log_listing_status_change();

-- ===========================================================================
-- Enable and force RLS
-- ===========================================================================

alter table public.listings enable row level security;
alter table public.listing_details enable row level security;
alter table public.listing_financials enable row level security;
alter table public.listing_ndas enable row level security;
alter table public.listing_status_history enable row level security;
alter table public.listing_saves enable row level security;

alter table public.listings force row level security;
alter table public.listing_details force row level security;
alter table public.listing_financials force row level security;
alter table public.listing_ndas force row level security;
alter table public.listing_status_history force row level security;
alter table public.listing_saves force row level security;

-- ===========================================================================
-- Teaser
-- ===========================================================================

-- Anyone signed in with the teaser capability sees discoverable listings; the
-- seller and their broker see their own at any status.
--
-- Note `anon` is absent. Browsing the market requires an account, which is a
-- product decision as much as a security one: sellers are more willing to list
-- when the audience is identifiable.
create policy listings_select_discoverable on public.listings
  for select to authenticated
  using (
    app.controls_listing(id)
    or app.is_platform_admin()
    or status in ('live', 'under_loi', 'under_contract')
  );

create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (
    seller_id = auth.uid()
    and app.can_create_listing()
    -- A new listing starts as a draft. Inserting one straight to 'live' would
    -- bypass the review step and skip the status history's first entry.
    and status = 'draft'
    -- Same rule as the transition trigger applies to the firm on creation: a
    -- listing cannot be attributed to a firm the creator does not belong to.
    and (firm_id is null or app.is_firm_member(firm_id))
  );

create policy listings_update_controller on public.listings
  for update to authenticated
  using (app.controls_listing(id))
  with check (app.controls_listing(id));

-- Moderation. An administrator can take a listing down; the transition trigger
-- restricts them to the status column and to legal transitions, so this policy
-- is not the broad grant it looks like.
create policy listings_update_admin on public.listings
  for update to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- No delete policy. A listing that reached the market is referenced by NDAs,
-- status history and eventually commission records.

-- ===========================================================================
-- Full profile — the gate
-- ===========================================================================
--
-- The seller and their broker always see their own. Everyone else needs an
-- executed NDA *and* the listing to be discoverable — a signed NDA on a listing
-- since withdrawn does not reopen it.
--
-- Platform admins are deliberately excluded. Reviewing a listing for the
-- approval queue is done on the teaser; an internal operator does not need the
-- seller's customer concentration to decide whether the headline is acceptable,
-- and giving them ambient access to every seller's confidential financials is a
-- standing risk with no matching benefit.
create policy listing_details_select_nda on public.listing_details
  for select to authenticated
  using (
    app.controls_listing(listing_id)
    or (app.listing_is_discoverable(listing_id) and app.has_executed_nda(listing_id))
  );

create policy listing_details_write_controller on public.listing_details
  for all to authenticated
  using (app.controls_listing(listing_id))
  with check (app.controls_listing(listing_id));

-- Financials sit behind the same gate. A three-year revenue series identifies a
-- business as readily as its name in a small sector.
create policy listing_financials_select_nda on public.listing_financials
  for select to authenticated
  using (
    app.controls_listing(listing_id)
    or (app.listing_is_discoverable(listing_id) and app.has_executed_nda(listing_id))
  );

create policy listing_financials_write_controller on public.listing_financials
  for all to authenticated
  using (app.controls_listing(listing_id))
  with check (app.controls_listing(listing_id));

-- ===========================================================================
-- NDAs
-- ===========================================================================

-- A buyer sees their own; the seller sees every NDA on their listing, which is
-- how the buyer-activity view is built.
create policy listing_ndas_select_party on public.listing_ndas
  for select to authenticated
  using (buyer_id = auth.uid() or app.controls_listing(listing_id));

-- A buyer requests access to a discoverable listing. They can only create their
-- own request, and only in `requested` — a client inserting `signed` directly
-- would be signing their own NDA.
create policy listing_ndas_insert_buyer on public.listing_ndas
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and status = 'requested'
    and app.listing_is_discoverable(listing_id)
    and app.is_buy_side()
  );

-- Both sides can move it forward: the seller sends it, the buyer signs it. Which
-- transitions each may make is enforced by the trigger below, not here — a
-- policy cannot compare OLD to NEW.
create policy listing_ndas_update_party on public.listing_ndas
  for update to authenticated
  using (buyer_id = auth.uid() or app.controls_listing(listing_id))
  with check (buyer_id = auth.uid() or app.controls_listing(listing_id));

-- ===========================================================================
-- NDA transitions
-- ===========================================================================
--
-- The gate is only as good as the rules about who may move an NDA into
-- `signed`. A policy sees only the new row, so this needs a trigger.
create or replace function app.enforce_nda_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  is_buyer boolean := (old.buyer_id = caller);
  is_seller boolean := app.controls_listing(old.listing_id);
begin
  -- An NDA is evidence. Which listing it covers and who signed it are fixed at
  -- creation; if they were editable, a buyer could sign a cheap NDA and then
  -- point the row at the listing they actually wanted.
  if new.listing_id <> old.listing_id or new.buyer_id <> old.buyer_id then
    raise exception 'An NDA cannot be moved to another listing or buyer'
      using errcode = '42501';
  end if;

  -- The timestamps are this trigger's to write. A client setting them directly
  -- would be editing the record the gate reads and the record that proves what
  -- was agreed. `signer_ip` and `signer_user_agent` are the exception: they are
  -- captured by the application at the moment of signature, so they are
  -- writable on that transition and frozen everywhere else.
  new.requested_at := old.requested_at;
  new.sent_at := old.sent_at;
  new.signed_at := old.signed_at;
  new.revoked_at := old.revoked_at;
  new.revoked_by := old.revoked_by;

  if not (new.status = 'signed' and old.status <> 'signed') then
    new.signer_ip := old.signer_ip;
    new.signer_user_agent := old.signer_user_agent;
  end if;

  -- The terms belong to the seller. Without this, a buyer could push their own
  -- `expires_at` out indefinitely and hold access to a full profile for as long
  -- as they liked — the gate checks expiry, so the expiry has to be the
  -- seller's number.
  if not is_seller then
    if new.expires_at is distinct from old.expires_at
       or new.template_id is distinct from old.template_id
       or new.template_version is distinct from old.template_version then
      raise exception 'Only the seller sets the terms of an NDA'
        using errcode = '42501';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  -- Only the buyer signs, and only their own. This is the line that stops a
  -- seller marking an NDA signed on the buyer's behalf to unlock their own
  -- listing's audit trail, and stops a buyer skipping straight past `sent`.
  if new.status = 'signed' then
    if not is_buyer then
      raise exception 'Only the buyer named on an NDA can sign it'
        using errcode = '42501';
    end if;
    if old.status <> 'sent' then
      raise exception 'An NDA must be sent before it can be signed'
        using errcode = '42501';
    end if;
    new.signed_at := now();
  end if;

  -- Only the seller side issues the NDA.
  if new.status = 'sent' then
    if not is_seller then
      raise exception 'Only the seller can send an NDA'
        using errcode = '42501';
    end if;
    new.sent_at := now();
  end if;

  -- Either side can revoke; the effect is immediate because the gate checks
  -- `revoked_at is null` on every read.
  if new.status = 'revoked' then
    if not (is_buyer or is_seller) then
      raise exception 'Only a party to the NDA can revoke it'
        using errcode = '42501';
    end if;
    new.revoked_at := now();
    new.revoked_by := caller;
  end if;

  -- A signed NDA cannot be walked back to an earlier state. Access is withdrawn
  -- by revoking or expiring it, both of which leave the signature on record.
  if old.status = 'signed' and new.status in ('none', 'requested', 'sent') then
    raise exception 'A signed NDA cannot be returned to an earlier state'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger listing_ndas_enforce_transition
  before update on public.listing_ndas
  for each row execute function app.enforce_nda_transition();

-- ===========================================================================
-- Identifying the counterparty
-- ===========================================================================
--
-- A seller deciding whether to release their confidential profile has to know
-- who is asking. `profiles_select_self_or_colleagues` in 0006 does not admit
-- that — a buyer and a seller share no firm — so without this the seller's NDA
-- queue shows an anonymous request and the decision is unmakeable. A seller who
-- cannot tell a search fund from a competitor will either approve everything or
-- nothing, and both defeat the gate.
--
-- Narrow on purpose, and one-directional. It reveals the *buyer* to the party
-- who controls the listing they asked about, while a live request exists. It
-- does not reveal the seller to the buyer: the listing is anonymous until the
-- seller chooses otherwise, and that asymmetry is the product.
create policy profiles_select_nda_counterparty on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.listing_ndas n
       where n.buyer_id = public.profiles.id
         and n.revoked_at is null
         and app.controls_listing(n.listing_id)
    )
  );

-- ===========================================================================
-- Status history and watchlist
-- ===========================================================================

-- Visible to whoever can see the listing. A buyer watching a deal go under LOI
-- is legitimate market information; the reason text is seller-side only, so it
-- is not exposed through this policy's table at all — see the note in 0015.
create policy listing_status_history_select on public.listing_status_history
  for select to authenticated
  using (
    app.controls_listing(listing_id)
    or app.listing_is_discoverable(listing_id)
    or app.is_platform_admin()
  );

-- No insert policy: entries come from the trigger, which runs as definer.
-- No update or delete policy for anyone.

create policy listing_saves_own on public.listing_saves
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and app.listing_is_discoverable(listing_id));

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- 0008 revoked the Supabase default, so nothing is reachable until granted.
-- What is absent is deliberate: no DELETE on listings, details, financials,
-- NDAs or status history — the record of a business that came to market and the
-- confidentiality agreements around it is not disposable.

grant select, insert, update on public.listings to authenticated;
grant select, insert, update on public.listing_details to authenticated;
grant select, insert, update, delete on public.listing_financials to authenticated;
grant select, insert, update on public.listing_ndas to authenticated;
grant select on public.listing_status_history to authenticated;
grant select, insert, update, delete on public.listing_saves to authenticated;

-- Postgres grants EXECUTE to PUBLIC on every function at creation, and 0006's
-- blanket grant to `anon` is still in force for the `app` schema. That grant is
-- load-bearing for exactly two things — the jurisdiction and legal-template
-- policies, which run before there is a session and call
-- `app.is_platform_admin()`. Nothing anonymous calls a listings helper, so the
-- default is taken away again here rather than inherited.
revoke all on function app.can_create_listing() from public, anon;
revoke all on function app.is_buy_side() from public, anon;
revoke all on function app.controls_listing(uuid) from public, anon;
revoke all on function app.has_executed_nda(uuid) from public, anon;
revoke all on function app.listing_is_discoverable(uuid) from public, anon;

grant execute on function app.can_create_listing() to authenticated;
grant execute on function app.is_buy_side() to authenticated;
grant execute on function app.controls_listing(uuid) to authenticated;
grant execute on function app.has_executed_nda(uuid) to authenticated;
grant execute on function app.listing_is_discoverable(uuid) to authenticated;
