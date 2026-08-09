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
pnpm test                                   # 94 tests
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
- [ ] Leaked-password protection enabled in Auth settings
- [ ] Unused us-west-2 project deleted
- [ ] Backup restore tested end to end, with a date recorded here
- [ ] CSP set and verified against every third-party origin in use
- [ ] Legal templates (NDA, broker agreement, terms, privacy policy) reviewed by counsel
- [ ] Branch protection gating `main` on CI
