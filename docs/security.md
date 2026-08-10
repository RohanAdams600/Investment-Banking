# Security model

How authorisation works, and why it is built the way it is. Read this before changing
anything under `supabase/migrations` or `packages/core/src/access`.

## Two independent layers

Authorisation is enforced twice, by mechanisms that do not share code.

**Layer 1 — application.** `packages/core/src/access`. Pure functions taking an `Actor`
and returning a decision. This is where business rules live: NDA gating, listing status
lifecycle, who may edit what and when.

**Layer 2 — Row Level Security.** Postgres policies in `supabase/migrations/0006_rls.sql`.
This is where tenant isolation lives: which rows a given user can see at all.

Neither is sufficient alone, which is the point of having both:

- RLS **cannot express every business rule.** "A signed NDA that has not expired unlocks
  the full profile, unless the listing was withdrawn" is application logic. Encoding it in
  a policy would make it unreadable and untestable.
- Application checks **cannot protect against a query that bypasses them.** A route handler
  that forgets to call `can()` still goes through RLS. A raw query written during an
  incident still goes through RLS.

A change that weakens one layer because "the other one covers it" is a change that removes
the redundancy both exist to provide.

## What RLS guarantees

Verified by 42 tests in `supabase/tests/rls.test.ts`, run against a real Postgres in CI, and re-verified against the live Supabase project:

| Guarantee                                | Mechanism                                                            |
| ---------------------------------------- | -------------------------------------------------------------------- |
| A user sees only their own firms         | `app.user_firm_ids()` in every tenant-scoped policy                  |
| Cross-tenant updates affect nothing      | `using` **and** `with check` on every update policy                  |
| No user can grant themselves `admin`     | `role <> 'admin'` in the `user_roles` insert policy                  |
| Consent records cannot be altered        | No update or delete policy, and no grant, for anyone                 |
| Clients cannot write the audit log       | No insert policy or grant; entries are written with the service role |
| Profiles are not a directory             | Select limited to self, firm colleagues, and admins                  |
| Unpublished legal templates stay private | `published_at is not null` in the select policy                      |
| No firm exists without an owner          | `create_firm()` inserts both rows in one transaction                 |

## Details that are load-bearing

**`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** Without FORCE, a connection that happens
to be the table's owning role bypasses every policy silently. A test asserts both flags on
every table in `public`.

**`SECURITY DEFINER` on the helper functions.** A policy on `firm_members` that itself
queries `firm_members` re-enters that table's policy and recurses. Running the lookup as
the definer bypasses RLS for that one query and breaks the cycle.

**Pinned `search_path` on every definer function.** A `SECURITY DEFINER` function with a
caller-controlled search path is privilege escalation: the caller creates their own
`public.firm_members` earlier in the path and the definer reads it with elevated rights. A
test asserts every definer function in the `app` schema pins its search path.

**`WITH CHECK` alongside `USING` on updates.** `USING` decides which rows you may target.
`WITH CHECK` re-validates the row afterwards. With only `USING`, an administrator of firm A
could update a row and hand it to firm B — the row was visible when the check ran, and
nothing re-examined it after.

**`create_firm()` rather than a direct insert.** A firm and its first member have to be
created in one transaction. Two statements leave a window in which the firm has no members,
and any policy permissive enough to let its creator claim it is permissive enough to let
somebody else claim it first. The function also solves a mundane problem: an insert with
`RETURNING` fails under RLS because no select policy covers a firm you are not yet a member
of, so the caller never learns the id.

**`ON DELETE RESTRICT` on `consent_records.user_id`.** Deleting an account must not silently
delete the evidence that the person agreed to the terms. Account deletion anonymises the
profile and leaves the consent record standing, and the user is told so at the time of the
request.

## What running against real Supabase changed

The migrations were verified against local Postgres first and passed. Applying them to an
actual Supabase project surfaced two problems that local testing could not have found,
because the local environment was _more_ restrictive than production.

**Supabase's default privileges grant `ALL` on every new table in `public` to `anon` and
`authenticated`.** The grant model treats privileges as the outer gate and deliberately
withholds a grant where an operation should be impossible — no DELETE on the audit log, no
UPDATE on consent records. Those omissions did nothing: the defaults had already granted
them. Row Level Security still denied the rows, so nothing leaked, but the outer gate stood
open and a single missing policy would have been all that separated a client from a
rewritten audit trail. Fixed in `0008_lock_down_grants.sql`, which revokes everything and
grants back an explicit allowlist, including for tables added in future.

**The same applies to functions, and that one was worse.** `create_firm` is `SECURITY
DEFINER`, and PostgREST publishes `public` functions at `/rest/v1/rpc/<name>`. It was
callable without signing in. Migration 0006 did `revoke all on function ... from public`,
which is not the same thing — `PUBLIC` is the implicit everyone-role, and the grant to
`anon` is a separate explicit one. The `auth.uid() is null` guard inside the function did
hold, so the behaviour looked right when tested through the error it returned; a test that
only observes the outcome cannot tell which layer caught it. Fixed in `0009_harden.sql`.

**The local shim now reproduces both defaults.** That is the durable fix. A test
environment more restrictive than production will pass on code that fails in production,
and will do it silently. The shim grants what Supabase grants, so the suite can prove the
lockdown works rather than assuming an absence of grants means an absence of access.

## Accepted linter findings

Supabase's database linter reports five warnings, all of the same class and all
intentional: **SECURITY DEFINER functions callable by `authenticated`.**

| Function                | Why it is definer-rights                                                                             | What contains it                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `create_firm`           | The caller has no rights on `firms`; the firm and its first owner must be created in one transaction | Takes no user identifier — it can only create a firm owned by the caller         |
| `list_my_sessions`      | `auth.sessions` is not exposed through PostgREST                                                     | Filtered on `auth.uid()`; takes no user identifier                               |
| `revoke_session`        | Same                                                                                                 | `user_id = auth.uid()` predicate on the delete makes the caller-supplied id safe |
| `revoke_other_sessions` | Same                                                                                                 | Filtered on `auth.uid()`; keeps the current session                              |
| `withdraw_message`      | The SELECT policy makes a client-side soft delete impossible (see above)                             | Re-checks sender identity and live membership                                    |

The pattern is what the linter flags, not a defect. Every one of these exists _because_ the
caller lacks direct rights, and each either takes no user identifier or re-checks ownership
inside. None is granted to `anon` — verified, not assumed.

Leaked-password protection is now enabled, so it no longer appears in the linter output.

## Deal room messaging

Authorisation is computed from one fact: is this user an **active** member of this
conversation. Everything else derives from it — reading a deal, listing its conversations,
subscribing to its realtime channel, downloading its attachments.

Verified by 34 tests in `supabase/tests/messaging-rls.test.ts`:

| Guarantee                                             | Mechanism                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| A buyer cannot read another deal's messages           | `app.is_active_conversation_member()` in the SELECT policy                       |
| A member cannot send as somebody else                 | `sender_id = auth.uid()` in the INSERT policy                                    |
| A message cannot be reattributed, moved, or backdated | `app.freeze_message_immutables()` trigger comparing OLD to NEW                   |
| A removed member loses access immediately             | Every helper filters `removed_at is null`                                        |
| A buyer cannot widen the room                         | Membership writes require `banker` or `admin`                                    |
| A withdrawn message's body never leaves the database  | `deleted_at is null` in the SELECT policy                                        |
| Audit entries cannot be forged or removed             | Written by triggers; no INSERT/UPDATE/DELETE grant for clients                   |
| Realtime is not a second path to content              | Private channel authorized by the same membership rule; payload carries ids only |
| Attachments have no permanent URL                     | Private bucket; signed URLs expire in 60 seconds                                 |

### Why deletion needs a function

`withdraw_message()` exists because of a Postgres behaviour worth stating plainly: **when a
table has SELECT policies, an UPDATE also checks the new row against them.** The SELECT
policy requires `deleted_at is null`, so any UPDATE setting `deleted_at` produces a row the
author could no longer see, and Postgres rejects it.

So a strict SELECT policy and client-side soft delete cannot coexist. Keeping the strict
policy is the better trade — it is what makes "a withdrawn body never leaves the database"
true over every path rather than only the ones the application remembers to filter. The
function re-checks sender identity and live membership, so routing around the policy does
not mean routing around the rule.

### Three role axes

`platform_role` (many per user) · `firm_role` (one per firm) · `conversation_role` (one per
conversation). They answer different questions, and `banker` exists only on the third — it
is a seat at a table, not a platform identity.

## The service role

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely. Legitimate uses are narrow:

- Writing audit entries
- Granting the `admin` platform role during operator provisioning
- Scheduled jobs with no user context

`createServiceRoleClient()` is in a module marked `server-only`, so importing it from a
Client Component is a build error rather than a runtime leak. Reaching for it to make a
query work removes the database's independent check on a query the application layer may
already have got wrong — which is exactly the query where the second check earns its keep.

## Admin is not a superuser

Platform admins hold operational capabilities — verification, listing review, templates,
audit — and deliberately **not** `deal_room:access`, `document:download`, or
`listing:view_full`.

An internal operator moderating listings should not thereby be able to read the
confidential financials of a business they are not party to. Where admins genuinely need
document access, such as a fraud investigation, that should be a separate, individually
audited elevation rather than an ambient permission.

## Known gaps

Honest list of what is not yet done. Tracked in `docs/roadmap.md`.

- **Rate limiting is in-process.** `apps/web/src/lib/rate-limit.ts` defines the interface
  and ships a fixed-window implementation held in memory. On serverless that is a speed
  bump, not a limit — each region and cold start gets its own counter. The seam is built so
  swapping in Redis or Upstash is one implementation; every call site already routes through
  it. Treat the current limits as protection against a stuck client, not an attacker.
- **Step-up auth is available but not applied.** `requireStepUp()` exists and MFA enrolment
  works; no route calls it yet. Downloading confidential documents and changing commission
  settings should, once those exist.
- **Content Security Policy.** Baseline headers are set in `next.config.ts`; the CSP waits
  until the real third-party origins are known. A permissive placeholder is worse than
  none, because it looks like coverage.
