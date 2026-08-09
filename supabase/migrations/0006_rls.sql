-- Row Level Security: helper functions, policies, and grants.
--
-- Every policy in the schema is in this one file, on purpose. Security that is
-- scattered across a dozen table migrations can only be audited by reading all
-- of them and holding the result in your head; here it can be reviewed in one
-- pass, and a missing policy is visible by its absence.
--
-- RLS is the *second* line of defence. Application-level permission checks in
-- packages/core/src/access are the first. Neither is sufficient alone: RLS
-- cannot express every business rule, and application checks cannot protect
-- against a query that bypasses them.

-- ===========================================================================
-- Helper functions
-- ===========================================================================
--
-- Every helper is SECURITY DEFINER and STABLE.
--
-- SECURITY DEFINER is a correctness requirement, not a convenience. A policy on
-- `firm_members` that itself queries `firm_members` would re-enter that table's
-- policy and recurse. Running the lookup as the definer bypasses RLS for that
-- one query and breaks the cycle.
--
-- `search_path` is pinned on every one of them. A SECURITY DEFINER function
-- with a caller-controlled search_path is privilege escalation waiting to
-- happen: the caller creates their own `public.firm_members` earlier in the
-- path, and the definer reads it with elevated rights.

-- The firms the current user belongs to. The workhorse of tenant isolation.
create or replace function app.user_firm_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select firm_id from public.firm_members where user_id = auth.uid();
$$;

create or replace function app.is_firm_member(target_firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.firm_members
    where user_id = auth.uid() and firm_id = target_firm_id
  );
$$;

-- Owners and firm admins may administer the firm; plain members may not.
create or replace function app.is_firm_administrator(target_firm_id uuid)
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

create or replace function app.has_platform_role(target_role app.platform_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = target_role
  );
$$;

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.has_platform_role('admin');
$$;

-- Policies execute as the invoking role, so `authenticated` needs execute
-- rights on the helpers they call.
grant execute on all functions in schema app to authenticated, anon, service_role;

-- ===========================================================================
-- Enable and force RLS
-- ===========================================================================
--
-- FORCE matters as much as ENABLE. Without it, a connection that happens to be
-- the table's owning role silently bypasses every policy below — which is
-- precisely the accident RLS exists to prevent.

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.jurisdictions enable row level security;
alter table public.legal_templates enable row level security;
alter table public.consent_records enable row level security;
alter table public.audit_log enable row level security;

alter table public.firms force row level security;
alter table public.firm_members force row level security;
alter table public.profiles force row level security;
alter table public.user_roles force row level security;
alter table public.jurisdictions force row level security;
alter table public.legal_templates force row level security;
alter table public.consent_records force row level security;
alter table public.audit_log force row level security;

-- ===========================================================================
-- Firms
-- ===========================================================================

create policy firms_select_members on public.firms
  for select to authenticated
  using (id in (select app.user_firm_ids()) or app.is_platform_admin());

-- There is deliberately NO insert policy on `firms`, and no insert grant.
-- Firms are created only through `public.create_firm()` below.
--
-- The obvious alternative — let anyone insert a firm, then claim it by adding
-- the first membership row — has two problems. The insert cannot use RETURNING,
-- because no select policy covers a firm you are not yet a member of, so the
-- caller never learns the id. And between the two statements the firm sits
-- unclaimed, so a "first member may claim an empty firm" policy hands it to
-- whoever inserts first. One atomic function removes both.

-- Note both USING and WITH CHECK. USING alone would let an administrator of
-- firm A update the row and hand it to firm B; WITH CHECK re-validates the row
-- *after* the change and closes that.
create policy firms_update_administrators on public.firms
  for update to authenticated
  using (app.is_firm_administrator(id))
  with check (app.is_firm_administrator(id));

-- No delete policy: firms are never hard-deleted. Commission records, signed
-- NDAs, and audit entries reference them, and those have retention obligations
-- that outlive the account. Deactivation is a status change.

-- ===========================================================================
-- Firm members
-- ===========================================================================

create policy firm_members_select_same_firm on public.firm_members
  for select to authenticated
  using (firm_id in (select app.user_firm_ids()) or app.is_platform_admin());

-- Only an existing administrator of the firm may add members. There is no
-- self-join branch: the only way a firm gets its first member is through
-- `create_firm()`, which inserts the owner in the same transaction as the firm.
create policy firm_members_insert_administrators on public.firm_members
  for insert to authenticated
  with check (app.is_firm_administrator(firm_id));

create policy firm_members_update_administrators on public.firm_members
  for update to authenticated
  using (app.is_firm_administrator(firm_id))
  with check (app.is_firm_administrator(firm_id));

create policy firm_members_delete_administrators on public.firm_members
  for delete to authenticated
  using (app.is_firm_administrator(firm_id));

-- ===========================================================================
-- Profiles
-- ===========================================================================

-- Deliberately narrow: this is not a directory. A buyer cannot enumerate
-- sellers. Counterparties become visible to each other through deal-room
-- membership, which arrives with its own policies in step 6.
create policy profiles_select_self_or_colleagues on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or app.is_platform_admin()
    or exists (
      select 1 from public.firm_members fm
      where fm.user_id = public.profiles.id
        and fm.firm_id in (select app.user_firm_ids())
    )
  );

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ===========================================================================
-- User roles
-- ===========================================================================

create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or app.is_platform_admin());

-- A user may take on ordinary platform roles themselves — signing up as both a
-- buyer and a seller is a legitimate self-service action.
--
-- `admin` is excluded explicitly. Without that exclusion any authenticated user
-- could insert their own admin row and acquire every administrative capability
-- in the product. Admin is granted out of band, using the service role.
create policy user_roles_insert_self_non_admin on public.user_roles
  for insert to authenticated
  with check (user_id = auth.uid() and role <> 'admin');

create policy user_roles_delete_self_non_admin on public.user_roles
  for delete to authenticated
  using (user_id = auth.uid() and role <> 'admin');

-- ===========================================================================
-- Jurisdictions and legal templates
-- ===========================================================================

-- Active jurisdictions are public: the sign-up form needs them before there is
-- a session.
create policy jurisdictions_select_active on public.jurisdictions
  for select to anon, authenticated
  using (is_active or app.is_platform_admin());

create policy jurisdictions_write_admin on public.jurisdictions
  for all to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- Published templates are readable by anyone — the terms of use and privacy
-- policy have to be reachable before sign-up.
create policy legal_templates_select_published on public.legal_templates
  for select to anon, authenticated
  using (published_at is not null or app.is_platform_admin());

create policy legal_templates_write_admin on public.legal_templates
  for all to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- ===========================================================================
-- Consent records
-- ===========================================================================

-- A user reads their own consent history; this backs the privacy dashboard.
create policy consent_records_select_self on public.consent_records
  for select to authenticated
  using (user_id = auth.uid() or app.is_platform_admin());

create policy consent_records_insert_self on public.consent_records
  for insert to authenticated
  with check (user_id = auth.uid());

-- No update or delete policy, by design. Not for admins, not for the person who
-- created the row. Append-only is the entire value of the table — a consent
-- record that can be modified is not evidence of anything.

-- ===========================================================================
-- Audit log
-- ===========================================================================

-- Users see their own trail. This is a privacy feature as much as an audit one:
-- the user-facing privacy dashboard is built on it.
create policy audit_log_select_self on public.audit_log
  for select to authenticated
  using (actor_user_id = auth.uid() or app.is_platform_admin());

create policy audit_log_select_firm_administrators on public.audit_log
  for select to authenticated
  using (firm_id is not null and app.is_firm_administrator(firm_id));

-- No insert policy for `authenticated`, and no insert grant below. Audit
-- entries are written server-side with the service role, which bypasses RLS.
-- If clients could insert here they could forge history, and an audit log that
-- accepts arbitrary client writes is worse than none — it looks like evidence.
--
-- No update or delete policy for anyone, including admins.

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- Grants are the outer gate, policies the inner one. A missing policy denies
-- everything; a missing grant denies everything too. Both are stated
-- explicitly rather than relying on defaults.

-- No insert grant on `firms` — creation goes through `create_firm()`.
grant select, update on public.firms to authenticated;
grant select, insert, update, delete on public.firm_members to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.user_roles to authenticated;
grant select on public.jurisdictions to anon, authenticated;
grant insert, update, delete on public.jurisdictions to authenticated;
grant select on public.legal_templates to anon, authenticated;
grant insert, update, delete on public.legal_templates to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select on public.audit_log to authenticated;

-- ===========================================================================
-- Firm creation
-- ===========================================================================

-- Creates a firm and installs the caller as its owner, atomically.
--
-- Lives in `public` because it is the API for creating a firm — PostgREST
-- exposes it as an RPC endpoint, and the client calls it instead of inserting
-- into the table.
--
-- SECURITY DEFINER because the caller has no rights on `firms` at all. That
-- makes the authentication check below load-bearing rather than decorative: a
-- definer function with no `auth.uid()` guard would let the anon role create
-- firms.
create or replace function public.create_firm(
  firm_name text,
  firm_kind app.firm_kind default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  new_firm_id uuid;
begin
  if caller is null then
    raise exception 'create_firm requires an authenticated user'
      using errcode = '42501';
  end if;

  insert into public.firms (name, kind, created_by)
  values (firm_name, firm_kind, caller)
  returning id into new_firm_id;

  insert into public.firm_members (firm_id, user_id, role)
  values (new_firm_id, caller, 'owner');

  return new_firm_id;
end;
$$;

-- `anon` is intentionally excluded. The guard above would reject it anyway;
-- not granting execute means it never reaches the guard.
revoke all on function public.create_firm(text, app.firm_kind) from public;
grant execute on function public.create_firm(text, app.firm_kind) to authenticated;
