-- Verification, and the narrow powers a platform administrator actually needs.
--
-- ---------------------------------------------------------------------------
-- Admin is not a superuser, and this migration is where that gets tested
-- ---------------------------------------------------------------------------
--
-- The capability catalog has said so since step 2: `admin` carries platform
-- operations — verification, listing review, templates, jurisdictions, audit —
-- and deliberately not `deal_room:access`, `document:download` or
-- `listing:view_full`. An internal operator moderating a listing should not
-- thereby be able to read the confidential financials of a business they are
-- not party to.
--
-- Building the admin panel is where that principle stops being a comment and
-- starts being inconvenient, because the obvious way to build each screen is to
-- give admins broad read access and filter in the UI. So each power here is
-- granted as narrowly as it can be:
--
--   - verification changes `verification_status` and nothing else, enforced by
--     a trigger that compares the whole row rather than by trusting the route;
--   - listing review was already narrow (0016 restricts a non-controller to the
--     status column);
--   - the confidential half of a listing stays unreachable, and a test asserts
--     an admin reading `listing_details` gets nothing.

-- ===========================================================================
-- Verification
-- ===========================================================================

/*
 * An administrator may set anybody's verification status.
 *
 * Separate from `profiles_update_self`, which is unconditional for the owner.
 * Policies are OR'd, so this adds a second route in rather than widening the
 * first — and the trigger below is what keeps that route narrow.
 */
create policy profiles_update_verification_admin on public.profiles
  for update to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

/*
 * Verification changes one column.
 *
 * The temptation is to trust the route handler to send a narrow update. That
 * works until somebody writes a second route, so the narrowness lives here: for
 * a caller who is not the profile's owner, every column except the verification
 * pair must be untouched.
 *
 * Same technique as `enforce_listing_status_transition` — copy the new row,
 * normalise the fields that are allowed to move, and compare against the old.
 * A whole-row comparison catches a column added next year that nobody thought
 * to protect, which an explicit column list would not.
 */
create or replace function app.enforce_profile_verification()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  probe public.profiles;
begin
  if new.id = auth.uid() then
    -- Editing your own profile. Verification is not yours to grant, though.
    if new.verification_status is distinct from old.verification_status then
      raise exception 'Verification status is set by the platform, not by the account holder'
        using errcode = '42501';
    end if;
    return new;
  end if;

  probe := new;
  probe.verification_status := old.verification_status;
  probe.verified_at := old.verified_at;
  probe.updated_at := old.updated_at;

  if probe is distinct from old then
    raise exception 'An administrator may only change a verification status'
      using errcode = '42501';
  end if;

  -- Stamped here rather than accepted, so "verified on" means when it happened.
  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    new.verified_at := now();
  end if;

  if new.verification_status <> 'verified' then
    new.verified_at := null;
  end if;

  return new;
end;
$$;

create trigger profiles_enforce_verification
  before update on public.profiles
  for each row execute function app.enforce_profile_verification();

-- The same for firms, which carry their own verification status and are what a
-- buyer actually weighs when a listing says "represented by".
create policy firms_update_verification_admin on public.firms
  for update to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- ===========================================================================
-- The review queue
-- ===========================================================================
--
-- A view rather than a function: it reads only the teaser, so RLS on `listings`
-- is sufficient and there is nothing here that needs definer rights.
--
-- `security_invoker` is the important word. Without it a view runs with the
-- rights of its owner, which would hand every caller the whole table — the
-- exact "admin as superuser" failure this migration exists to avoid. With it,
-- the view is a convenience over what the caller could already read.
--
-- ---------------------------------------------------------------------------
-- Completeness without contents
-- ---------------------------------------------------------------------------
--
-- The first draft of the view asked `exists (select 1 from listing_details …)`
-- inline, and it was always false for the one person meant to read it. Under
-- `security_invoker` that subquery runs with the caller's rights, and the whole
-- point of this migration is that an admin cannot read `listing_details`. The
-- view and the "admin is not a superuser" principle collided head on.
--
-- Which is the correct collision to have — the fix is not to open the table but
-- to answer a narrower question. These two helpers return a boolean and a count
-- and never a value from inside the row, so a reviewer learns the listing is
-- complete without learning anything it says. Same shape as the seller-side
-- demand summary in 0018.
--
-- Both are guarded inside the body. Definer rights ignore RLS, so a helper that
-- answered for any uuid handed to it would be a probe anybody could point at any
-- listing — "has this business uploaded its numbers yet" is small, but it is not
-- nothing, and it is not a question a stranger gets to ask.
create or replace function app.listing_has_profile(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (select 1 from public.listing_details d where d.listing_id = target_listing_id)
   where app.is_platform_admin() or app.controls_listing(target_listing_id);
$$;

create or replace function app.listing_financial_years(target_listing_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::integer from public.listing_financials f
   where f.listing_id = target_listing_id
     and (app.is_platform_admin() or app.controls_listing(target_listing_id));
$$;

revoke all on function app.listing_has_profile(uuid) from public, anon;
revoke all on function app.listing_financial_years(uuid) from public, anon;
grant execute on function app.listing_has_profile(uuid) to authenticated;
grant execute on function app.listing_financial_years(uuid) to authenticated;

create or replace view public.listing_review_queue
with (security_invoker = true) as
  select
    l.id,
    l.headline,
    l.industry,
    l.jurisdiction_code,
    l.status,
    l.created_at,
    l.updated_at,
    -- Whether the seller has filled in the confidential half at all. A boolean,
    -- not the contents: a reviewer needs to know the listing is complete, not
    -- what it says.
    app.listing_has_profile(l.id) as has_profile,
    app.listing_financial_years(l.id) as financial_years
  from public.listings l
  where l.status = 'pending_review';

grant select on public.listing_review_queue to authenticated;

-- ---------------------------------------------------------------------------
-- Saying why
-- ---------------------------------------------------------------------------
--
-- `listing_status_history.reason` has existed since 0015 and nothing has ever
-- written to it, because the history row is inserted by a trigger and a trigger
-- has no way of knowing why a human made a decision. That was tolerable while
-- every status change was the seller's own. It stops being tolerable here: a
-- reviewer sending a listing back to draft with no explanation gives the seller
-- a rejection and no way to act on it, which is the worst version of this
-- screen.
--
-- The reason travels on a transaction-local setting rather than a column,
-- because the alternative — a second statement updating the history row — needs
-- an UPDATE grant on an append-only table, and that is a far worse trade than a
-- GUC.
create or replace function app.log_listing_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  supplied_reason text := nullif(current_setting('app.status_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.listing_status_history (listing_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, auth.uid());
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.listing_status_history (listing_id, from_status, to_status, actor_id, reason)
    values (new.id, old.status, new.status, auth.uid(), supplied_reason);

    -- Cleared so a second status change in the same transaction does not
    -- inherit an explanation that was written about the first one.
    perform set_config('app.status_reason', '', true);
  end if;

  return null;
end;
$$;

/*
 * Move a listing, and record why.
 *
 * Invoker rights, deliberately. The update inside is subject to exactly the RLS
 * that 0016 already wrote — a reviewer may touch the status column and nothing
 * else, a seller may move their own listing, and anybody else matches zero rows
 * and changes nothing. Making this definer would have quietly handed every
 * caller the power the policies exist to withhold.
 *
 * Which means this is not a privileged operation dressed as a function. It is
 * the ordinary update, plus somewhere to put the sentence explaining it.
 */
create or replace function public.change_listing_status(
  target_listing_id uuid,
  new_status text,
  reason text default null
)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  moved integer;
begin
  if reason is not null and char_length(reason) > 1000 then
    raise exception 'A reason is limited to 1000 characters' using errcode = '22001';
  end if;

  perform set_config('app.status_reason', coalesce(reason, ''), true);

  update public.listings
     set status = new_status::app.listing_status
   where id = target_listing_id;

  get diagnostics moved = row_count;

  -- Left clean whether or not anything moved, so a denied call cannot leave an
  -- explanation lying around for the next statement in the transaction.
  perform set_config('app.status_reason', '', true);

  return moved;
end;
$$;

revoke all on function public.change_listing_status(uuid, text, text) from public, anon;
grant execute on function public.change_listing_status(uuid, text, text) to authenticated;

/*
 * ...and the column that reason opens up.
 *
 * 0016 admitted anybody who can see a discoverable listing to its status
 * history, with a comment reasoning that the reason text was seller-side only.
 * That was true right up until the function above started writing to it — and
 * RLS is row-level, so "they can read the row but not that column" was never
 * something the policy could express. A buyer browsing the market would have
 * been able to select `reason` directly through PostgREST.
 *
 * So the policy narrows to the people the reason is actually for, and the
 * public timeline moves to a view that has no reason column to leak. Same
 * teaser/detail split as listings themselves, one table down.
 */
drop policy listing_status_history_select on public.listing_status_history;

create policy listing_status_history_select on public.listing_status_history
  for select to authenticated
  using (app.controls_listing(listing_id) or app.is_platform_admin());

-- Not `security_invoker`, and that is the point: this view exists precisely to
-- show rows the caller's own policy now withholds. Its where clause is the
-- access check, so it is written to be read as one.
create or replace view public.listing_status_timeline as
  select
    h.id,
    h.listing_id,
    h.from_status,
    h.to_status,
    h.changed_at
  from public.listing_status_history h
  where app.controls_listing(h.listing_id)
     or app.listing_is_discoverable(h.listing_id)
     or app.is_platform_admin();

grant select on public.listing_status_timeline to authenticated;

-- ===========================================================================
-- Platform counts
-- ===========================================================================
--
-- What an operator needs to know the platform is alive, and nothing else. No
-- per-user or per-listing detail, because a dashboard that answers "how many"
-- does not need to answer "which".
create or replace function public.platform_stats()
returns table (
  live_listings integer,
  pending_review integer,
  total_users integer,
  unverified_users integer,
  active_jurisdictions integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    (select count(*) from public.listings where status = 'live')::integer,
    (select count(*) from public.listings where status = 'pending_review')::integer,
    (select count(*) from public.profiles)::integer,
    (select count(*) from public.profiles where verification_status = 'unverified')::integer,
    (select count(*) from public.jurisdictions where is_active)::integer
  where app.is_platform_admin();
$$;

revoke all on function public.platform_stats() from public, anon;
grant execute on function public.platform_stats() to authenticated;

-- ===========================================================================
-- Verification queue
-- ===========================================================================
--
-- Definer, because it reads profiles an admin can see but joins roles they
-- otherwise could not — `user_roles_select_self` restricts that table to the
-- caller's own rows. Guarded by an admin check inside the body, so it cannot be
-- pointed at anything by a non-admin.
create or replace function public.verification_queue()
returns table (
  user_id uuid,
  full_name text,
  email text,
  verification_status app.verification_status,
  roles text[],
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    p.id,
    p.full_name,
    p.email::text,
    p.verification_status,
    coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}') as roles,
    p.created_at
  from public.profiles p
  left join public.user_roles r on r.user_id = p.id
  where app.is_platform_admin()
  group by p.id, p.full_name, p.email, p.verification_status, p.created_at
  order by
    -- Pending first: somebody is waiting on those.
    case p.verification_status when 'pending' then 0 when 'unverified' then 1 else 2 end,
    p.created_at desc
  limit 200;
$$;

revoke all on function public.verification_queue() from public, anon;
grant execute on function public.verification_queue() to authenticated;
