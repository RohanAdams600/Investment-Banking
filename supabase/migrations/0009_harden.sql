-- Hardening pass, driven by Supabase's database linter run against the live
-- project. Each item below was a real warning, not a theoretical one.

-- ---------------------------------------------------------------------------
-- 1. Function EXECUTE privileges
-- ---------------------------------------------------------------------------
--
-- Supabase's default privileges grant EXECUTE on every function in `public` to
-- `anon` as well as `authenticated`, and PostgREST exposes those as
-- `/rest/v1/rpc/<name>`. So `create_firm` — a SECURITY DEFINER function that
-- runs with the privileges of its owner — was callable without signing in.
--
-- 0006 already did `revoke all on function ... from public`. That was not
-- enough, and the reason is worth remembering: `PUBLIC` is the implicit
-- everyone-role, and revoking from it does nothing about a *separate explicit*
-- grant to `anon`. The two are different things.
--
-- The `auth.uid() is null` guard inside `create_firm` did hold the line, which
-- is why the behaviour looked correct when tested through the error it
-- returned. That guard is the second layer, not the first, and a test that only
-- observes the outcome cannot tell which one caught it.

revoke all on all functions in schema public from anon, authenticated;

-- Future functions too, so the next RPC added to `public` is not anonymously
-- callable the moment it is created.
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

-- Signed-in users only, granted back by name.
grant execute on function public.create_firm(text, app.firm_kind) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Mutable search_path on the trigger helper
-- ---------------------------------------------------------------------------
--
-- `touch_updated_at` is SECURITY INVOKER, so it does not carry the escalation
-- risk the definer functions do. It still gets a pinned search_path: a trigger
-- function resolving `now()` through a caller-controlled path is a needless
-- loose end, and the linter is right to flag it.
--
-- Worth noting the gap this exposed in our own test — it asserts a pinned
-- search_path only on functions where `prosecdef` is true, so it skipped this
-- one entirely. The test is widened alongside this migration.

alter function app.touch_updated_at() set search_path = public, pg_catalog;

-- ---------------------------------------------------------------------------
-- 3. citext out of the public schema
-- ---------------------------------------------------------------------------
--
-- An extension installed in `public` puts its functions into the schema
-- PostgREST exposes. Moving it does not affect existing `citext` columns —
-- the type keeps its identity, only its schema changes.

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase already installs pgcrypto into `extensions`; a plain Postgres puts
-- both here in `public`. Loop over them so the migration converges to the same
-- state either way rather than assuming which one it is running against.
do $$
declare
  ext text;
begin
  foreach ext in array array['citext', 'pgcrypto'] loop
    if exists (
      select 1 from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname = ext and n.nspname = 'public'
    ) then
      execute format('alter extension %I set schema extensions', ext);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Not fixable here
-- ---------------------------------------------------------------------------
--
-- The linter also flags leaked-password protection as disabled. That is an Auth
-- project setting rather than schema, so it cannot be set from a migration —
-- it has to be switched on in the Supabase dashboard under
-- Authentication → Policies. It checks new passwords against HaveIBeenPwned,
-- and on a product whose accounts gate confidential financial documents it
-- should be on. Tracked in docs/security.md.
