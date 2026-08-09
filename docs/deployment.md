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
pnpm test                                   # 23 tests
pnpm typecheck                              # all workspace packages
pnpm lint
pnpm --filter @ib/ui tokens:build           # after editing any design token
pnpm --filter @ib/ui tokens:check           # what CI runs
pnpm format
```

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

### Database (step 2)

- Supabase project creation and region pinning (see open question 6 — the region cannot be
  changed later without a migration)
- Migration workflow and how migrations run against staging before production
- RLS policy verification: a test that asserts every table has RLS enabled, since a table
  without it is publicly readable with the anon key
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
- [ ] Every table has RLS enabled, verified by test
- [ ] Backup restore tested end to end, with a date recorded here
- [ ] CSP set and verified against every third-party origin in use
- [ ] Legal templates (NDA, broker agreement, terms, privacy policy) reviewed by counsel
- [ ] Branch protection gating `main` on CI
