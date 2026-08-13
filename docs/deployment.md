# Deployment runbook

## Current state

The application deploys, but there is nothing behind it — no database, no auth, no
features. This runbook covers what exists and marks what is pending so it can be filled in
as each step lands.

## Local development

```bash
pnpm install
cp .env.example .env.local     # fill in as needed; defaults work for step 1
pnpm dev                       # http://localhost:3000
```

Useful:

```bash
pnpm test                                   # 438 tests
pnpm typecheck                              # all workspace packages
pnpm lint
pnpm --filter @ib/ui tokens:build           # after editing any design token
pnpm --filter @ib/ui tokens:check           # what CI runs
pnpm format
```

### Running the database tests

The RLS and schema-parity suites need a Postgres. Without `DATABASE_URL` they skip, so
`pnpm test` works on a machine with no database; CI always provides one and fails if it is
missing.

```bash
# any Postgres 16 will do — the suite rebuilds the schema from the migrations each run
createdb cairn_test
DATABASE_URL=postgresql://localhost/cairn_test pnpm test
```

The suite applies `supabase/tests/local_auth_shim.sql` first, which recreates the parts of
Supabase the migrations depend on (`auth.users`, `auth.uid()`, the `anon` /
`authenticated` / `service_role` roles). The shim is never applied to a real environment.

**After editing a design token, run `tokens:build`.** CI fails on a stale generated
stylesheet.

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

```
token drift check -> format check -> lint -> typecheck -> test -> build
```

Token drift runs first so a stale stylesheet fails in seconds with a clear message, rather
than surfacing later as a confusing visual regression.

**Pending:** branch protection on `main` requiring this workflow to pass. Until that is
configured in repository settings, the pipeline is advisory rather than gating.

## Environments

| Environment | Branch    | Purpose                                                  |
| ----------- | --------- | -------------------------------------------------------- |
| Production  | `main`    | Live                                                     |
| Staging     | `staging` | Pre-production verification against production-like data |
| Preview     | any PR    | Vercel per-PR deployment                                 |

**Pending:** none of these are provisioned yet. Vercel project creation is step 12 work,
though it can be done earlier if useful.

Environment variables are set per-environment in the Vercel dashboard, never committed.
Full list and secrecy classification: `docs/environment.md`.

Two settings differ by environment and matter:

- `NEXT_PUBLIC_ALLOW_INDEXING` — `"true"` in production only. Defaults closed, so a
  staging environment cannot be indexed by omission.
- `NEXT_PUBLIC_DEMO_DATA` — must be `"false"` in production. Sample statistics and
  testimonials on a live marketing site are a misrepresentation, not a placeholder.

## Deploying

Production deploys on merge to `main`. Vercel builds from the repository root; the
monorepo is detected via `pnpm-workspace.yaml`.

**Rollback:** promote the previous deployment in the Vercel dashboard. Instant, no rebuild.
Once a database exists, check whether the rollback target predates a migration — if it
does, the database has to be considered separately, and rolling the app back alone can be
worse than leaving it forward.

## Pending — to be written as each step lands

### Database

**Done:** migrations, seed, and RLS verification (`supabase/`). A test asserts every table
in `public` has RLS both enabled and forced.

**Project:** `Cairn`, ref `treltiukpuxhnzuplegu`, region **us-east-1**, org `Cairn Capital`.
All nine migrations and the jurisdiction seed are applied. Verified live: cross-tenant
isolation, self-grant admin denial, append-only guarantees, and anonymous access — the last
one exercised through PostgREST with the publishable key, which is the path a browser
actually takes rather than a direct SQL connection.

State after verification: 51 jurisdictions, all inactive; every other table empty. All
verification fixtures were removed.

An earlier project in `us-west-2` was left in place and is unused. **Delete it in the
dashboard** — the free tier caps you at two active projects, so leaving it costs you the
slot.

### Live migration state

**Migrations 0001–0016 are applied** to project `Cairn` (`treltiukpuxhnzuplegu`,
us-east-1), plus the jurisdiction seed.

**0017, 0018 and 0019 are written and tested locally but NOT applied.** The Supabase connection
dropped before they could be. Apply them in order, then re-run the invariant block below —
0018 adds `app.is_my_counterparty()`, which must appear in the pinned-`search_path` check,
and three tables that must appear with RLS forced.

#### ⚠️ Outstanding: verification fixtures left in the live project

`0015` and `0016` applied cleanly and the structural invariants were re-verified (table
below). Behavioural verification of the NDA gate was **partially completed** before the
connection dropped:

| Check                                             | Result             |
| ------------------------------------------------- | ------------------ |
| Buyer with no NDA sees the teaser                 | Confirmed — 1 row  |
| Buyer with no NDA sees no `listing_details`       | Confirmed — 0 rows |
| Buyer with no NDA sees no `listing_financials`    | Confirmed — 0 rows |
| Buyer who has only _requested_ still sees nothing | Confirmed — 0 rows |
| `published_at` stamped on first move to `live`    | Confirmed          |
| Seller issues, buyer signs, gate opens            | **Not run**        |
| Revocation closes the gate                        | **Not run**        |
| A second buyer is not admitted                    | **Not run**        |

**Fixtures from that run are still in the database and must be removed.** They are three
`auth.users` rows with fixed uuids, their roles, one listing with its details, financials
and one NDA, and `US-NY` was switched to active. Nothing else was touched.

```sql
-- Remove the step-4 verification fixtures.
delete from public.listing_ndas
 where listing_id = '44444444-4444-4444-4444-444444444444';
delete from public.listing_financials
 where listing_id = '44444444-4444-4444-4444-444444444444';
delete from public.listing_details
 where listing_id = '44444444-4444-4444-4444-444444444444';
delete from public.listing_status_history
 where listing_id = '44444444-4444-4444-4444-444444444444';
delete from public.listings
 where id = '44444444-4444-4444-4444-444444444444';
delete from public.user_roles where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');

-- Decide deliberately rather than leaving it as a side effect of testing.
-- US-NY was activated to satisfy the listing's foreign key. Leave it active only
-- if New York is genuinely a launch state.
update public.jurisdictions set is_active = false where code = 'US-NY';

-- Expect every count to be 0, and 51 jurisdictions.
select
  (select count(*) from public.listings) as listings,
  (select count(*) from public.listing_details) as details,
  (select count(*) from public.listing_ndas) as ndas,
  (select count(*) from public.listing_status_history) as history,
  (select count(*) from auth.users) as users,
  (select count(*) from public.jurisdictions) as jurisdictions,
  (select count(*) from public.jurisdictions where is_active) as active_jurisdictions;
```

Then finish the behavioural checks that did not run — the full round trip is covered by
`supabase/tests/listings-rls.test.ts` locally, but local Postgres and Supabase have
diverged twice before (see migrations 0008 and 0009), which is why the live pass exists.

The 0014 invariant checks below were also re-run at this point and passed:

```sql
-- expect 0 / 0 / 0
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)) as missing_rls,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and (p.proconfig is null or not exists (
      select 1 from unnest(p.proconfig) c where c like 'search_path=%'))) as unpinned_search_path,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_fns;
```

Verified against the live project after applying, using the same invariants the test suite
asserts:

| Check                                                    | Result                                       |
| -------------------------------------------------------- | -------------------------------------------- |
| Tables in `public` missing RLS or FORCE                  | 0 of 22                                      |
| Functions in `app` without a pinned `search_path`        | 0                                            |
| Functions in `public` executable by `anon`               | 0                                            |
| Listings helpers in `app` executable by `anon`           | 0                                            |
| TRUNCATE / TRIGGER / REFERENCES granted to a client role | 0                                            |
| `authenticated` grants                                   | match the allowlist in `rls.test.ts` exactly |
| Attachments bucket public                                | false                                        |
| Realtime authorization policies                          | 2                                            |

Note the fourth row. Postgres grants `EXECUTE` to `PUBLIC` on every function at creation,
and 0006's blanket grant to `anon` on the `app` schema is still in force — it is
load-bearing for the jurisdiction and legal-template policies, which run before there is a
session. New helpers inherit that by default, so 0016 revokes it back for the five listings
helpers explicitly. Any future migration adding an `app` helper has to do the same.

Messaging behaviour was also exercised live with temporary fixtures, since local Postgres
and Supabase have diverged before: cross-deal read denied, cross-deal post denied,
sender impersonation denied, audit trigger fired, audit metadata carried no message body.
All fixtures were removed — every table is empty except the 51 jurisdictions, all inactive.

**Pending:**

- Migration workflow: how migrations run against staging before production.
- **Enable leaked-password protection** under Authentication → Policies. It cannot be set
  from a migration.
- **Backups: automated, encrypted, with a documented and actually-executed restore test.**
  A backup that has never been restored is a hypothesis, not a backup. The restore
  procedure and the date it was last verified belong in this document.

### Security (step 11)

- Content Security Policy. Deliberately not set yet — it needs the real third-party origins
  (Supabase, Twilio, Maps, analytics) enumerated first, and a permissive placeholder CSP is
  worse than none because it looks like coverage. Baseline headers (HSTS, nosniff,
  frame-deny, referrer policy, permissions policy) are already set in `next.config.ts`.
- Rate limiting on auth and search endpoints
- Structured logging and where logs are shipped
- Anomaly alerting hooks

### Launch readiness (step 12)

- [ ] `isBrandFullyConfigured` is true — real support email and mailing address configured
- [ ] `NEXT_PUBLIC_DEMO_DATA` is `"false"`
- [ ] `NEXT_PUBLIC_ALLOW_INDEXING` is `"true"` in production only
- [x] Every table has RLS enabled and forced, verified by test
- [x] Migrations applied to the production Supabase project (us-east-1)
- [ ] **Step-4 verification fixtures removed from the live project** (SQL above)
- [ ] **NDA round trip verified live** — issue, sign, revoke, and a second buyer denied
- [ ] **0017, 0018 and 0019 applied** to the live project, and invariants re-run
- [ ] AI provider keys set, or accepted as absent (features degrade, they do not break)
- [ ] Leaked-password protection enabled in Auth settings
- [ ] Unused us-west-2 project deleted
- [ ] Backup restore tested end to end, with a date recorded here
- [ ] CSP set and verified against every third-party origin in use
- [ ] Legal templates (NDA, broker agreement, terms, privacy policy) reviewed by counsel
- [ ] Branch protection gating `main` on CI
