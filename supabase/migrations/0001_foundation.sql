-- Foundation: extensions, the application schema, and enums.
--
-- Migration order is tables first, security last:
--   0001  extensions, schema, enums, trigger helper
--   0002  tenancy tables
--   0003  identity tables
--   0004  compliance tables
--   0005  audit table
--   0006  RLS helper functions, policies, and grants — the whole security posture

create extension if not exists "pgcrypto"; -- gen_random_uuid()
create extension if not exists "citext"; -- case-insensitive email

-- Application-owned schema. Helper functions live here rather than in `public`
-- so they are not exposed through PostgREST as callable RPC endpoints.
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Mirrors PLATFORM_ROLES in packages/core/src/access/roles.ts. The two are kept
-- in step by a test that reads pg_enum and compares them — see
-- supabase/tests/schema-parity.test.ts. Add a role here and there, or the test
-- fails.
create type app.platform_role as enum (
  'buyer',
  'seller',
  'investor',
  'search_fund',
  'private_equity',
  'family_office',
  'broker',
  'admin'
);

create type app.firm_role as enum ('owner', 'admin', 'member');

create type app.firm_kind as enum (
  'brokerage',
  'private_equity',
  'family_office',
  'search_fund',
  'other'
);

create type app.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');

-- ---------------------------------------------------------------------------
-- Trigger helper
-- ---------------------------------------------------------------------------

-- The RLS helper functions are NOT here. They query the tables they protect, and
-- a SQL function body is validated at creation time, so they cannot be defined
-- before those tables exist. They live in 0006_rls.sql alongside the policies
-- that use them — which also means the entire security posture of the schema
-- can be audited by reading one file.

-- Keeps `updated_at` honest. Applied as a trigger rather than trusted to the
-- application, because a direct SQL fix in a console is exactly the change you
-- most want a timestamp on.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

grant usage on schema app to authenticated, anon, service_role;
