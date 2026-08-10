-- Session management: letting a user see and revoke their own sessions.
--
-- `auth.sessions` is not exposed through PostgREST, and should not be — it is
-- Supabase's table, and publishing it would expose every user's session rows to
-- the API layer's policy surface.
--
-- The alternative usually reached for is the service role, which bypasses RLS
-- entirely and would mean the app holds a credential that can read and delete
-- anybody's sessions in order to let a user manage their own. These two
-- functions are narrower: they are SECURITY DEFINER, they take no user
-- identifier, and every statement inside them is filtered on `auth.uid()`. The
-- worst a caller can do with them is manage their own sessions.

-- ---------------------------------------------------------------------------
-- List
-- ---------------------------------------------------------------------------

create or replace function public.list_my_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  ip inet,
  aal text,
  is_current boolean
)
language sql
stable
security definer
set search_path = auth, pg_catalog
as $$
  select
    s.id,
    s.created_at,
    s.refreshed_at::timestamptz,
    s.user_agent,
    s.ip,
    s.aal::text,
    -- Supabase puts the session id in the JWT, so the current device can be
    -- marked without the client asserting which one it is.
    s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.refreshed_at desc nulls last, s.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Revoke
-- ---------------------------------------------------------------------------

-- Deleting the session row invalidates its refresh token. The access token
-- already issued stays valid until it expires — one hour by default — which is
-- a property of stateless JWTs rather than something this function can fix.
-- Worth knowing when reasoning about "sign out this device": it stops the
-- session continuing, it does not sever it instantly.
create or replace function public.revoke_session(target_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = auth, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  deleted int;
begin
  if caller is null then
    raise exception 'revoke_session requires an authenticated user'
      using errcode = '42501';
  end if;

  -- The `user_id = caller` predicate is what makes the caller-supplied id safe.
  -- Without it this function would revoke any session in the system by id.
  delete from auth.sessions
   where id = target_session_id
     and user_id = caller;

  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

-- "Sign out everywhere else" — the action someone takes when they think an
-- account is compromised. Keeps the current session so they are not logged out
-- of the device they are fixing the problem from.
create or replace function public.revoke_other_sessions()
returns integer
language plpgsql
security definer
set search_path = auth, pg_catalog
as $$
declare
  caller uuid := auth.uid();
  current_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  deleted int;
begin
  if caller is null then
    raise exception 'revoke_other_sessions requires an authenticated user'
      using errcode = '42501';
  end if;

  delete from auth.sessions
   where user_id = caller
     and (current_session is null or id <> current_session);

  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- 0009 revoked the default EXECUTE grant on public functions, so these are
-- unreachable until granted by name. `anon` is not granted: an unauthenticated
-- caller has no sessions to manage, and the guards inside would reject it
-- anyway — this is the outer gate.

revoke all on function public.list_my_sessions() from public, anon;
revoke all on function public.revoke_session(uuid) from public, anon;
revoke all on function public.revoke_other_sessions() from public, anon;

grant execute on function public.list_my_sessions() to authenticated;
grant execute on function public.revoke_session(uuid) to authenticated;
grant execute on function public.revoke_other_sessions() to authenticated;
