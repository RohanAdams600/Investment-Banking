# Deployment runbook

## Current state

Everything in the roadmap is built, every migration is applied, and the application builds
clean. 821 tests pass and the linters are clean.

**One thing stands between this and a live site: it is not deployed to a domain.** That is
the six-step walk-through that follows, and none of it is a code change.

---

## Getting it running, from nothing

Six steps. The first four are mechanical; the last two are where judgement is needed.

### 1. Check what is missing

```bash
pnpm install
cp .env.example .env.local
pnpm preflight
```

`preflight` sorts what is unset into three buckets and exits non-zero only on the ones
that stop the site functioning. Run `pnpm preflight:strict` to fail on the launch ones
too — that is the version a production deploy should run.

The check worth reading twice is "service role key is not exposed to the browser". A
service-role key with a `NEXT_PUBLIC_` prefix is compiled into the client bundle and
bypasses every policy in the database for anybody who views source. It is the single most
expensive configuration mistake available here, and it is silent.

### 2. Fill in the Supabase values

From the Supabase dashboard, project **Cairn** (`treltiukpuxhnzuplegu`, us-east-1) →
Settings → API:

| Copy from                   | Into                            |
| --------------------------- | ------------------------------- |
| Project URL                 | `NEXT_PUBLIC_SUPABASE_URL`      |
| `anon` / publishable key    | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY`     |

Then `pnpm dev` and open `http://localhost:3000/api/health`. It should return
`{"status":"ok"}`. If `databaseReachable` is false, the URL or the anon key is wrong —
the endpoint makes a real query rather than checking that a variable is non-empty, so a
false there means the database genuinely did not answer.

### 3. Deploy

Vercel is the path of least resistance for a Next.js app, and nothing here depends on it.

1. Push the branch and import the repository at vercel.com/new.
2. Set the **root directory** to `apps/web`. The build command and output are detected.
3. Add every variable from `.env.local` under Settings → Environment Variables. The three
   Supabase ones are required; the rest can wait.
4. Deploy, then open `/api/health` on the deployed URL.

Add the deployment's URL to Supabase → Authentication → URL Configuration → Redirect URLs,
or email confirmation links will point at localhost and silently fail.

### 4. Point a domain at it

Buy the domain, add it in Vercel → Settings → Domains, follow the DNS instructions. Then
set `NEXT_PUBLIC_SITE_URL` to the real domain and redeploy — it builds every canonical URL
and every link in an email, and a stale value here is the kind of thing nobody notices
until a customer clicks a password reset.

### 5. Walk the app with the CSP report-only

The Content Security Policy ships as `Content-Security-Policy-Report-Only`. Open the
deployed site, open the browser console, and use every page: sign up, create a listing,
open a deal room, upload a document, download it. Any policy violation appears in the
console. When there are none, set `CSP_ENFORCE=true` and redeploy.

Doing this before the walk-through is how a policy takes the product down. Leaving it
undone forever is how a policy becomes decoration.

### 6. Open a state, and publish the legal documents

Nothing works for a real user until both:

- **A jurisdiction is active.** All 51 states are seeded and every one is off. A listing
  needs a state, and the state has to be one you can legally operate in. `/admin/jurisdictions`.
- **The legal documents exist.** `/legal/terms` and `/legal/privacy` currently say the
  document has not been published, and that is deliberate — there is no placeholder text,
  because plausible terms nobody with a licence has read are worse than an empty page.
  They render from `legal_templates`, so publishing one is an insert, not a deploy.

The second is the real launch gate and no amount of engineering moves it.

---

## Local development

```bash
pnpm install
cp .env.example .env.local     # fill in as needed; defaults work for step 1
pnpm dev                       # http://localhost:3000
```

Useful:

```bash
pnpm preflight                              # what is not configured yet
pnpm test                                   # 731 tests
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
  staging environment cannot be indexed by omission. It gates `robots.ts` and `sitemap.ts`
  as well as the per-page meta tag; a crawler reads `/robots.txt` first and may never fetch
  the page whose tag would have told it to stay away.
- `CSP_ENFORCE` — `"true"` only after the walk-through above.

`NEXT_PUBLIC_DEMO_DATA` used to be listed here and has been removed. Nothing read it: the
marketing copy was written with no statistics and no testimonials at all, with tests
asserting so, which is a stronger guarantee than a flag somebody has to remember to
set.

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
All twenty-two migrations and the jurisdiction seed are applied. Verified live: cross-tenant
isolation, self-grant admin denial, append-only guarantees, and anonymous access — the last
one exercised through PostgREST with the publishable key, which is the path a browser
actually takes rather than a direct SQL connection.

State after verification: 51 jurisdictions, all inactive; every other table empty. All
verification fixtures were removed.

An earlier project in `us-west-2` was left in place and is unused. **Delete it in the
dashboard** — the free tier caps you at two active projects, so leaving it costs you the
slot.

### The scheduler

`vercel.json` declares one cron: `/api/cron/due-tasks`, daily at 13:00 UTC. Deliberately
the only thing in that file — build settings are left to Vercel's own detection, because a
wrong `buildCommand` guessed into the repo breaks a deploy in a way that is tedious to
trace back to a JSON file nobody remembers adding.

It works because Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations
whenever an environment variable of exactly that name exists — which is the header the
route already checks, in constant time. So there is nothing to wire up beyond setting
`CRON_SECRET`. Without it the route refuses every caller, including Vercel's.

13:00 UTC is roughly 9am US Eastern, and the route looks 24 hours ahead, so somebody who
works mornings hears about the afternoon's tasks while there is still an afternoon.

**On any other host**, ignore the file and point a scheduler at the same path with the same
header:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/due-tasks
```

Nothing about the route is Vercel-specific; that was the point of building it as an
authenticated endpoint rather than a platform-specific hook.

### Verifying a migration actually landed

Worth its own section, because 0027 taught the lesson. It was pasted into the dashboard
SQL Editor and reported as run; it had not applied at all — zero of 38 policies rewritten,
zero of 15 indexes created. A dashboard paste that silently does nothing looks identical
to one that worked.

So do not trust "I ran it". Ask the database:

```sql
-- Zero, or 0027 did not land.
select count(*) from pg_policies
 where schemaname = 'public'
   and (regexp_replace(coalesce(qual,''),'\( SELECT auth\.(uid|jwt)\(\)( AS \w+)?\)','','g') ~ 'auth\.(uid|jwt)\(\)'
     or regexp_replace(coalesce(with_check,''),'\( SELECT auth\.(uid|jwt)\(\)( AS \w+)?\)','','g') ~ 'auth\.(uid|jwt)\(\)');
```

Or locally, which checks the same two invariants and more:

```bash
DATABASE_URL=... pnpm vitest run supabase/tests/rls.test.ts
```

### Live migration state

**Migrations 0001–0027 are applied** to project `Cairn` (`treltiukpuxhnzuplegu`,
us-east-1), plus the jurisdiction seed.

Verified after 0027 against the live project:

| Check                                                                                  | Result                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Policies still calling `auth.uid()` bare                                               | 0 (was 38)                                           |
| Policies using the InitPlan form                                                       | 38                                                   |
| Indexes from 0027 present                                                              | 15 of 15                                             |
| Unindexed `cascade`/`restrict` foreign keys                                            | 0                                                    |
| Total policies, before and after                                                       | 86 and 86 — none lost                                |
| Tables without RLS enabled **and** forced                                              | 0 of 41                                              |
| `TRUNCATE`/`TRIGGER`/`REFERENCES` to a client role                                     | 0                                                    |
| `auth_rls_initplan` advisories                                                         | 0 (was 38)                                           |
| Security advisories                                                                    | Unchanged — 1 ERROR, 13 WARN, all previously audited | 0017–0022 went on in one pass; the structural |
| invariants were re-run afterwards and the behavioural checks that had been outstanding |
| since step 4 were finished.                                                            |

State after that pass: **51 jurisdictions, none active; every other table empty.** The
step-4 verification fixtures have been removed.

#### What was verified live, and why it is verified live at all

Local Postgres and Supabase have diverged twice before — migrations 0008 and 0009 exist
because of it, both times because the local environment was _more_ restrictive than
production and the suite passed on code that would have failed. So structural claims get
re-run against the real project rather than inferred from a green local suite.

| Check                                               | Result                                        |
| --------------------------------------------------- | --------------------------------------------- |
| Every `public` table has RLS enabled **and** forced | 0 exceptions across 30 tables                 |
| Every `app` function pins `search_path`             | 0 exceptions                                  |
| `anon` can execute nothing in `public`              | 0 functions                                   |
| The `authenticated` grant allowlist                 | Identical to the 32 entries the suite asserts |

The NDA round trip, which had never been completed live:

| Check                                             | Result                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| Buyer with no NDA sees the teaser                 | Confirmed — 1 row                                   |
| Buyer with no NDA sees no `listing_details`       | Confirmed — 0 rows                                  |
| Buyer with no NDA sees no `listing_financials`    | Confirmed — 0 rows                                  |
| Buyer who has only _requested_ still sees nothing | Confirmed — 0 rows                                  |
| `published_at` stamped on first move to `live`    | Confirmed                                           |
| Seller issues, buyer signs, gate opens            | Confirmed — 1 detail row, 1 financial row           |
| Revocation closes the gate                        | Confirmed — 0 rows; teaser still visible            |
| A second buyer is not admitted                    | Confirmed — 0 rows while the first holds a live NDA |

And the admin panel from 0022:

| Check                                      | Result                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| An admin reads `listing_details`           | 0 rows — the line the whole migration defends               |
| An admin reads `listing_financials`        | 0 rows                                                      |
| An admin reads the review queue            | `has_profile: true`, `financial_years: 0`                   |
| A reviewer returns a listing with a reason | Recorded on the correct history row, and only that row      |
| The seller reads the reason                | Confirmed                                                   |
| A buyer reads the reason                   | 0 rows from the table; the timeline view has no such column |
| `platform_stats` / `verification_queue`    | Answer an admin, and are not granted to `anon`              |

Two notes from doing it, both worth keeping:

- **Revocation is a status change, not a timestamp write.** Setting `revoked_at` directly
  is silently ignored — `enforce_nda_transition()` freezes it and stamps it itself. A first
  attempt at the revocation check wrote the column and concluded the gate had failed. The
  application already uses `status = 'revoked'`, which is the supported verb.
- **Every row written in one transaction shares `now()`.** Ordering status history by
  `changed_at` alone therefore sorts arbitrarily among them. Harmless in the app, where
  each change is its own request, but it made a probe read the wrong row — and the
  timeline query now breaks the tie on `id`.

The invariant block, kept here because it is the thing to run after any migration goes on:

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

Earlier passes, kept for the record — the numbers moved as tables were added:

| Check                                                    | Result                                       |
| -------------------------------------------------------- | -------------------------------------------- |
| Tables in `public` missing RLS or FORCE                  | 0 of 22 (0 of 30 after 0022)                 |
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

- Content Security Policy is written and nonce-based, shipping **report-only** until
  `CSP_ENFORCE=true`. Baseline headers (HSTS, nosniff, frame-deny, referrer policy,
  permissions policy) are set in `next.config.ts`.
- Rate limiting exists but is **in-process**: each serverless instance keeps its own
  counters, so the effective limit is the configured one multiplied by the number of warm
  instances. `setRateLimiter()` in `apps/web/src/lib/rate-limit.ts` is the seam for a
  shared store. Adequate for launch traffic; not a defence against a determined attacker.
- Structured logging and where logs are shipped
- Anomaly alerting hooks

### What the Supabase linter reports, and why

Run `get_advisors` after any migration. Three families come back, and two of them are
expected — worth writing down so nobody re-derives it:

- **`security_definer_view` (ERROR) on `listing_status_timeline`.** Correct that it is a
  definer view, wrong that it is a problem. The view exists precisely to show rows the
  caller's own policy withholds — `listing_status_history` carries a reviewer's reason and
  RLS cannot hide a single column — so its `WHERE` clause is the access check. Two tests in
  `admin-rls.test.ts` verify a stranger gets nothing for a listing that is not on the
  market, and that an unfiltered select returns nothing that is not already public. If
  those tests are ever weakened, this stops being a false positive.
- **`authenticated_security_definer_function_executable` (WARN), 13 functions.** All
  intentional and all guarded internally: `is_platform_admin()`, `controls_listing()`, or a
  `= auth.uid()` predicate inside the body. Audited function by function.
- **`multiple_permissive_policies` (WARN), 12 tables.** Deliberate. Each is an OR'd access
  path — "mine, or my firm's, or an admin's" — and collapsing them into one policy would
  make a boolean nobody can read. The cost is real and accepted.

`auth_rls_initplan` and the foreign-key findings were **fixed** in 0027 rather than
documented, and two schema tests now prevent them coming back.

### Launch readiness (step 12)

- [ ] `isBrandFullyConfigured` is true — real support email and mailing address configured
- [ ] `NEXT_PUBLIC_ALLOW_INDEXING` is `"true"` in production only
- [x] Every table has RLS enabled and forced, verified by test
- [x] Migrations 0001–0026 applied to the production Supabase project (us-east-1)
- [x] **Migration 0027 applied** and verified against the live project — see the table
      above. Do not take a dashboard SQL Editor run on trust; it reported success once
      while applying nothing.
- [x] Step-4 verification fixtures removed from the live project
- [x] NDA round trip verified live — issue, sign, revoke, and a second buyer denied
- [x] Admin panel verified live — an operator reads no confidential half
- [ ] AI provider keys set, or accepted as absent (features degrade, they do not break)
- [ ] Leaked-password protection enabled in Auth settings
- [ ] Unused us-west-2 project deleted
- [ ] Backup restore tested end to end, with a date recorded here
- [ ] A violation-report endpoint, if the browser reports are to be collected rather than
      read from a console during the walk-through
- [x] CSP written, nonce-based, shipping **report-only** (`apps/web/src/lib/security/csp.ts`)
- [ ] **CSP enforced** — deploy, walk every page, read the violation reports, then set
      `CSP_ENFORCE=true`. Doing this before walking the app is how a policy takes the
      product down; leaving it undone forever is how a policy becomes decoration.
- [ ] Legal templates (NDA, broker agreement, terms, privacy policy) reviewed by counsel
- [ ] Branch protection gating `main` on CI
- [ ] `CRON_SECRET` set, and a scheduler pointed at `/api/cron/due-tasks`. Without it the
      route refuses every caller and nobody is reminded about a due task. Everything else
      still works.

### Known gaps, stated plainly

Not blockers, but nobody should discover these from a customer:

- **Nothing sends email.** Notifications are rows; they appear in-app and on the
  dashboard badge immediately. The preferences page says so with a "Not sending yet"
  badge, and `wantsEmail()` is the switch a sender would read.
- **Lists cap, and now say so.** Every user-facing list over-fetches by one row and shows
  a notice when there is more. The commission CSV export is the exception: it refuses with
  a 409 rather than hand over a file that opens in Excel and sums to the wrong number.
  Notes are the one list still capping quietly; they are grouped per contact and the cap
  is far from reach.
- **PostgREST's `max-rows` is 1000 and applies to any query that sets no limit of its
  own.** The matcher now pages with `.range()` rather than trusting an unbounded read —
  see `fetchAll()` in `features/matching/recompute.ts`. Worth remembering when writing any
  new query that means "all of them": no limit does not mean no ceiling.
- **No document watermarking**, and no listing photos.
- **Payments and escrow are out of scope**, by design. Commission is record-keeping with a
  clean seam for Stripe Connect later.
