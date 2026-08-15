-- Making the platform startable.
--
-- ---------------------------------------------------------------------------
-- The deadlock
-- ---------------------------------------------------------------------------
--
-- A fresh deployment of this schema cannot be used. Not "is empty" — cannot be
-- used, permanently, with no way out through the application:
--
--   1. `listJurisdictions()` offers only `is_active` jurisdictions, and the seed
--      ships all 51 states inactive. So the listing form's location field is an
--      empty dropdown and no seller can create a listing.
--   2. Activating one needs `admin:manage_jurisdictions`.
--   3. That needs the `admin` platform role.
--   4. `user_roles_insert_self_non_admin` carries `role <> 'admin'`, so nobody
--      can grant it to themselves — correctly, since otherwise every signup
--      could promote itself.
--   5. Nothing else in 0001–0027 grants it. No function, no seed, no trigger.
--
-- Every one of those is right on its own. Together they are a locked room with
-- the key inside, and it was only visible by asking the live database what it
-- actually contained rather than by reading the schema.
--
-- ---------------------------------------------------------------------------
-- Why this is not "just run some SQL in the dashboard"
-- ---------------------------------------------------------------------------
--
-- That works once. It also means the first act of the platform's life is an
-- unrecorded manual privilege grant, which is precisely the event an audit log
-- exists to capture — and the one somebody will ask about first.
--
-- So: a function. It records what it did, it refuses to do it twice, and the
-- conditions under which it will act are written down here rather than living
-- in somebody's shell history.

-- ===========================================================================
-- The first administrator
-- ===========================================================================

create or replace function app.bootstrap_admin(target_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  target uuid;
  existing integer;
begin
  /*
   * Refuses once an administrator exists.
   *
   * This is the whole safety story, and it is deliberately a property of the
   * data rather than of who is calling. A function that could be talked into
   * granting admin a second time is a privilege-escalation primitive sitting in
   * the schema forever; one that can only fire into an empty room is a
   * bootstrap. After the first success this is inert for the life of the
   * platform, and the admin panel is how every later operator is appointed.
   */
  select count(*) into existing from public.user_roles where role = 'admin';

  if existing > 0 then
    raise exception 'An administrator already exists. Appoint further operators from the admin panel.'
      using errcode = '42501';
  end if;

  select id into target from auth.users where lower(email) = lower(trim(target_email));

  if target is null then
    -- Deliberately says so. This is run by hand, once, by somebody who knows
    -- which account they meant — a silent no-op here is an hour of confusion.
    raise exception 'No account with that email. Sign up in the application first, then run this.'
      using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (target, 'admin', target)
  on conflict do nothing;

  /*
   * Recorded like any other privilege change.
   *
   * `actor_user_id` is the new administrator themselves, which is honest: there
   * was nobody else who could have done it. The metadata says how it happened so
   * this row is not mistaken later for an ordinary in-app grant.
   */
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    target,
    'user.role_granted',
    'user',
    target::text,
    jsonb_build_object('role', 'admin', 'via', 'bootstrap_admin', 'first', true)
  );

  return target;
end;
$$;

/*
 * Nobody may call this over the API.
 *
 * `app` is not an exposed schema, so PostgREST does not publish it — but the
 * revoke is explicit anyway, because "not currently exposed" is a configuration
 * fact and this is a function that hands out administrator.
 *
 * It is reachable from the SQL editor and from a service-role connection, both
 * of which already imply full control of the database. It grants nothing to
 * anybody who did not already have everything.
 */
revoke all on function app.bootstrap_admin(text) from public, anon, authenticated;

comment on function app.bootstrap_admin(text) is
  'One-time: promotes an existing account to admin when no administrator exists. Refuses afterwards.';

-- ===========================================================================
-- Is this deployment usable yet?
-- ===========================================================================
--
-- The counterpart to the deadlock: a way to ask, in one query, whether the
-- platform can actually do anything. Every launch checklist item below is a
-- thing whose absence makes some part of the product silently inert rather than
-- visibly broken, which is the kind of failure nobody notices until a customer
-- does.

create or replace function public.launch_readiness()
returns table (
  check_name text,
  ready boolean,
  detail text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    'administrator'::text,
    exists (select 1 from public.user_roles where role = 'admin'),
    'Without one, no jurisdiction can be opened and the admin panel is unreachable. Run app.bootstrap_admin(''you@example.com'').'::text
  union all
  select
    'open jurisdiction'::text,
    exists (select 1 from public.jurisdictions where is_active),
    'The listing form offers only active jurisdictions. With none, its location field is empty and no seller can list. Opening one asserts you have done your own licensing work in that state — nothing here verifies it.'::text
  union all
  select
    'terms of use published'::text,
    exists (
      select 1 from public.legal_templates
       where kind = 'terms_of_use' and published_at is not null and superseded_at is null
    ),
    '/legal/terms renders a placeholder until a published version exists.'::text
  union all
  select
    'privacy policy published'::text,
    exists (
      select 1 from public.legal_templates
       where kind = 'privacy_policy' and published_at is not null and superseded_at is null
    ),
    '/legal/privacy renders a placeholder until a published version exists.'::text
  union all
  select
    'NDA template published'::text,
    exists (
      select 1 from public.legal_templates
       where kind = 'nda' and published_at is not null and superseded_at is null
    ),
    'A seller can still issue an NDA without one, but nothing records which text the buyer agreed to — which is the question that gets asked in a dispute.'::text;
$$;

revoke all on function public.launch_readiness() from public, anon;
grant execute on function public.launch_readiness() to authenticated;

comment on function public.launch_readiness() is
  'One row per thing whose absence makes part of the product inert. Readable by any signed-in user; contains no customer data.';
