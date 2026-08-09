-- Local/CI stand-in for the pieces of Supabase the migrations depend on.
--
-- On a real Supabase project the `auth` schema, the `auth.users` table, the
-- `auth.uid()` function, and the `anon` / `authenticated` / `service_role`
-- roles are all provided by the platform. This file recreates just enough of
-- them to run the migrations and exercise the policies against a plain
-- Postgres instance.
--
-- It is NOT part of the migration set and is never applied to a real
-- environment. It exists so that RLS can be tested for real rather than
-- reviewed by eye — policy bugs are close to invisible on inspection and
-- obvious the moment a wrong role runs a query.

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  -- Supabase stores sign-up form fields here. Present in the shim because the
  -- profile-provisioning trigger reads it.
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Mirrors Supabase's implementation: the current user id comes from the JWT
-- claim that PostgREST sets as a GUC on the connection. Tests set the same GUC
-- directly, so they exercise the identical code path the policies see in
-- production.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants ALL on every newly created table in `public` to `anon` and
-- `authenticated`, via default privileges configured on a fresh project.
--
-- This shim must reproduce that, and reproducing it is not a detail. Without
-- it, vanilla Postgres denies any statement we simply neglected to grant, so a
-- migration that relies on "no grant means no access" passes locally and is
-- wide open on Supabase. That exact gap let two append-only guarantees through
-- until they were run against a real project.
--
-- 0008 revokes these back down to an explicit allowlist. Keeping the permissive
-- default here is what makes the local suite able to prove that it worked.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

-- The same applies to functions, and this one is easier to miss. `revoke all
-- ... from public` does not touch an explicit grant to `anon`, so a SECURITY
-- DEFINER function intended for signed-in users stays callable anonymously
-- through PostgREST. 0009 revokes it; reproducing the default here is what
-- lets the local suite prove that.
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- Supabase keeps extensions out of `public`.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
