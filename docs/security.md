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

Verified by 37 tests in `supabase/tests/rls.test.ts`, run against a real Postgres in CI:

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

- **MFA.** Supabase Auth supports TOTP; enrolment and the enforcement policy are not built.
- **Session management.** No device list, no remote sign-out, no forced re-auth before
  sensitive actions.
- **Rate limiting.** Nothing on auth or search endpoints yet.
- **Content Security Policy.** Baseline headers are set in `next.config.ts`; the CSP waits
  until the real third-party origins are known. A permissive placeholder is worse than
  none, because it looks like coverage.
- **Nothing is verified against a live Supabase project.** All database guarantees above
  are verified against local Postgres 16 with an auth shim. The shim mirrors Supabase's
  `auth.uid()` and role setup closely, but it is not the same system.
