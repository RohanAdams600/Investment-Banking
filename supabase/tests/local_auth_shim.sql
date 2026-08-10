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

-- Sessions, for the device list and revocation functions in 0010.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'auth' and t.typname = 'aal_level') then
    create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
  end if;
end
$$;

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  refreshed_at timestamp,
  user_agent text,
  ip inet,
  aal auth.aal_level default 'aal1'
);

-- The full claim set, as PostgREST sets it. `auth.uid()` above reads the `sub`
-- claim from its own GUC; this one is what `session_id` is read from, which is
-- how a session identifies *itself* without the client asserting which it is.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
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

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Supabase authorizes private broadcast channels with RLS on
-- `realtime.messages`, where the topic being subscribed to is read from
-- `realtime.topic()`. Reproduced here so those policies can be exercised: a
-- test sets the topic GUC and asks whether the policy admits the subscriber,
-- which is the same question the real broker asks at subscribe time.
create schema if not exists realtime;

create table if not exists realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now()
);

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

-- Stub. The real implementation hands the payload to the broker; here it only
-- has to exist and accept the same arguments so the trigger runs.
create or replace function realtime.send(
  payload jsonb,
  event text,
  topic text,
  private boolean default true
)
returns void
language plpgsql
as $$
begin
  insert into realtime.messages (topic, extension, payload, event, private)
  values (topic, 'broadcast', payload, event, private);
end;
$$;

grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
--
-- Enough of `storage.buckets` and `storage.objects` for the attachment bucket
-- and its policies to be created and tested.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner_id text,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
