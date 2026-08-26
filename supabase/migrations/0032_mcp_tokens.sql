-- Letting another AI agent reach this platform.
--
-- ---------------------------------------------------------------------------
-- The rule that shapes everything below
-- ---------------------------------------------------------------------------
--
-- An agent may read anything its owner could read, and may write a draft. It may
-- not send, publish, issue, or transmit anything to another human being. That is
-- the platform's standing constraint — no outbound message reaches a buyer or a
-- seller without a person clicking send — and connecting an external model is
-- exactly the moment it would be lost by accident.
--
-- So it is enforced in three independent places rather than one:
--
--   1. `scope` here is an enum with no value that means "send".
--   2. The route refuses any tool not on an allowlist.
--   3. Every query runs as the token's owner under RLS, so a token cannot reach
--      a row its owner could not.
--
-- Any one of those failing leaves the other two standing.
--
-- ---------------------------------------------------------------------------
-- Why the token is stored as a hash
-- ---------------------------------------------------------------------------
--
-- The plaintext token is shown once, at creation, and never again. What is kept
-- is a SHA-256 digest, so a copy of this table is not a set of working
-- credentials. This is the same reasoning as a password, and it matters more
-- here: a leaked token authenticates as a real user against their own live deal
-- data, and unlike a password there is no second factor in front of it.
--
-- SHA-256 rather than bcrypt deliberately. A token is 256 bits of output from a
-- CSPRNG, not a human-chosen secret, so there is no dictionary to slow down — a
-- work factor would buy nothing and cost a hash on every API call.

create type app.mcp_scope as enum (
  -- Read the caller's own market view: teasers, and full profiles only where an
  -- NDA is already signed. RLS decides which, not this enum.
  'read:listings',
  -- The caller's own match scores and reasoning.
  'read:matches',
  -- The caller's own deals, tasks, and pipeline. Never message bodies.
  'read:pipeline',
  -- Run the deterministic valuation. Touches no stored row.
  'run:valuation',
  -- Write an outreach draft into the approval queue. A human still sends it.
  'draft:outreach'
);

comment on type app.mcp_scope is
  'What an external agent may do. There is deliberately no scope that transmits anything to another person.';

/*
 * Used by the scopes check below.
 *
 * A CHECK constraint may not contain a subquery, and de-duplicating an array
 * needs one. A function may, so the subquery moves in here and the constraint
 * calls it. IMMUTABLE is what makes it legal in a constraint at all.
 */
create or replace function app.array_is_distinct(items anyarray)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select cardinality(items) = (select count(distinct x) from unnest(items) x);
$$;

/*
 * Revoked back for the same reason as every other `app` helper: creation grants
 * EXECUTE to PUBLIC, and 0006 grants `anon` usage on this schema. A constraint
 * helper is harmless to call, but "harmless" is a judgement that has to be
 * re-made every time somebody reads the grant list — and the schema test does
 * not accept judgement calls.
 *
 * `authenticated` keeps EXECUTE because the constraint is evaluated as the
 * inserting role.
 */
revoke all on function app.array_is_distinct(anyarray) from public, anon;
grant execute on function app.array_is_distinct(anyarray) to authenticated;

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users (id) on delete cascade,

  -- What the user called it: "Manus", "my research agent". Shown in the list of
  -- tokens so revoking the right one does not require guessing.
  label text not null check (char_length(trim(label)) between 1 and 100),

  /*
   * SHA-256 of the plaintext token, hex. Unique so a lookup is an index probe on
   * the digest rather than a scan, and so two tokens can never collide silently.
   */
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),

  /*
   * A short, non-secret prefix of the plaintext ("ash_mcp_7f3a"), stored so the
   * UI can show which token is which without holding anything usable.
   */
  token_hint text not null check (char_length(token_hint) between 4 and 24),

  scopes app.mcp_scope[] not null check (
    array_length(scopes, 1) between 1 and 5
    -- No duplicates: a token with 'read:listings' twice is a bug somewhere.
    and app.array_is_distinct(scopes)
  ),

  /*
   * Expiry is mandatory.
   *
   * A credential handed to a third-party agent and never reviewed again is the
   * one that is still live when that service is breached. The application caps
   * this; the column simply refuses a token that never dies.
   */
  expires_at timestamptz not null,

  last_used_at timestamptz,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),

  constraint mcp_tokens_expiry_future check (expires_at > created_at)
);

comment on table public.mcp_tokens is
  'Credentials for external AI agents. Read and draft only — no scope transmits anything to another person.';

create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;
alter table public.mcp_tokens force row level security;

-- ---------------------------------------------------------------------------
-- A token is entirely its owner's business
-- ---------------------------------------------------------------------------
--
-- No administrator branch anywhere in this table, on purpose. An operator has no
-- reason to enumerate which agents a user has connected, and the digest would be
-- useless to them if they did.

create policy mcp_tokens_select_own
  on public.mcp_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy mcp_tokens_insert_own
  on public.mcp_tokens
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy mcp_tokens_update_own
  on public.mcp_tokens
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

/*
 * Revocation only.
 *
 * Widening a live token's scopes is how a read-only agent quietly becomes
 * something else. Issuing a new token is cheap; mutating an old one in place
 * loses the record of what the old one was allowed to do while it was in use.
 */
create or replace function app.enforce_mcp_token_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  probe public.mcp_tokens;
begin
  probe := new;
  probe.revoked_at := old.revoked_at;
  probe.last_used_at := old.last_used_at;

  if probe is distinct from old then
    raise exception 'A token may be revoked, not rewritten. Issue a new one instead.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger mcp_tokens_enforce_update
  before update on public.mcp_tokens
  for each row execute function app.enforce_mcp_token_update();

-- Deleting is fine: a user removing an agent entirely should leave no digest.
create policy mcp_tokens_delete_own
  on public.mcp_tokens
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.mcp_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- Resolving a token, at request time
-- ---------------------------------------------------------------------------
--
-- Called by the MCP route with the service role, because at this point there is
-- no session — resolving the credential is what establishes one. It returns the
-- owner and scopes for a token that is live, and nothing at all otherwise.
--
-- It takes a digest, never a plaintext token: hashing happens in the application
-- so the secret never travels to the database, never appears in a query log, and
-- never sits in pg_stat_statements.

create or replace function app.resolve_mcp_token(digest text)
returns table (token_id uuid, owner uuid, scopes app.mcp_scope[])
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  update public.mcp_tokens
     set last_used_at = now()
   where token_sha256 = digest
     and revoked_at is null
     and expires_at > now()
  returning id, user_id, scopes;
$$;

revoke all on function app.resolve_mcp_token(text) from public, anon, authenticated;

comment on function app.resolve_mcp_token(text) is
  'Service-role only. Takes a SHA-256 digest, returns the owner and scopes of a live token and stamps last_used_at. Returns no rows for a revoked, expired or unknown token.';
