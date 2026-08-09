# Build sequence

Twelve steps, from the specification. Each is complete only when it has tests and its
documentation is current.

| #   | Step                                                    | Spec sections | Status                                          |
| --- | ------------------------------------------------------- | ------------- | ----------------------------------------------- |
| 1   | Repo scaffold, design tokens, shared UI, docs skeleton  | 1, 16         | **Complete**                                    |
| 2   | Auth, roles/permissions, base data model, RLS policies  | 3.2, 14       | **Mostly complete** — MFA and session UI remain |
| 3   | Marketing site                                          | 1, 2          | Not started — brand name settled (Cairn)        |
| 4   | Core listings + buyer/seller dashboards                 | 3, 6, 7       | Not started                                     |
| 5   | Matching engine                                         | 5             | Not started                                     |
| 6   | Deal room, NDA flow, document vault                     | 8             | Not started                                     |
| 7   | CRM + messaging                                         | 9, 10         | Not started                                     |
| 8   | AI agents behind the orchestrator                       | 4             | Not started                                     |
| 9   | Commission system + tax exports                         | 11, 12        | Not started                                     |
| 10  | Admin panel                                             | 13            | Not started                                     |
| 11  | Security hardening + compliance templates               | 14, 15        | Not started                                     |
| 12  | Testing catch-up, deployment pipeline, launch readiness | 16            | Partial — CI pipeline exists                    |

## Step 1 — what shipped

- pnpm workspace: `apps/web`, `packages/ui`, `packages/core`
- Design tokens in TypeScript, generating both a Tailwind preset and CSS variables, with a
  CI check that fails on drift
- Light and dark mode across all three theme states
- Component library: Button, Badge/VerifiedBadge, Input, Card, Skeleton, EmptyState,
  AIDisclaimer
- `/foundations` — a living style guide rendered from the token source
- Brand configuration behind a single environment value; no hard-coded company name
- Money handling in integer cents, with formatters that reject float input
- 23 tests: money formatting, token integrity, regulated disclaimer wording
- CI: token drift → format → lint → typecheck → test → build
- Documentation: architecture, design system, environment, brand guide, naming, logo brief,
  open questions

## Decisions that shaped step 2

All three resolved — see `docs/decisions/open-questions.md` for the full reasoning.

| Decision     | Outcome                                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company name | **Cairn** — "Mark the way."                                                                                                                                                                                 |
| Tenancy      | **Multi-tenant from the start.** Firms are the primary data boundary; users can belong to several with different roles in each. Nearly every table carries a tenant column; RLS policies are tenant-scoped. |
| Jurisdiction | **US multi-state.** The jurisdiction-config layer is built now even if one state ships first, because consent records capture the jurisdiction and template version at acceptance and cannot be backfilled. |

## Step 2 — what shipped

- **Permission model** in `packages/core/src/access`: platform roles, firm roles, a
  capability catalog, and resource-aware checks. Framework-free, so the same code serves
  the API layer, scheduled jobs, and a future partner API. 31 unit tests.
- **Schema**: `firms`, `firm_members`, `profiles`, `user_roles`, `jurisdictions`,
  `legal_templates`, `consent_records`, `audit_log`.
- **Row Level Security** on every table, enabled _and_ forced, with all policies in one
  auditable file (`0006_rls.sql`). Verified against a real Postgres — 42 tests covering
  cross-tenant isolation, privilege escalation, and append-only guarantees.
- **Schema parity test** so the Postgres role enum cannot drift from the TypeScript union.
- **Supabase wiring**: server, browser, and service-role clients; session-refresh
  middleware; a `getActor()` bridge from session to permission model.
- **Auth flows**: sign-in, sign-up, sign-out, email confirmation callback.
- **Seed**: all 51 US jurisdictions, every one inactive until deliberately switched on.
- **Live**: applied to Supabase project `Cairn` in **us-east-1**. Two grant-model defects
  that local testing could not surface were found and fixed (migrations 0008 and 0009); see
  `docs/security.md`. Supabase's security linter is down from five warnings to one accepted
  and one dashboard setting.

CI now runs a Postgres service, and fails rather than skips if the database is missing.

## Step 2 — what remains

- MFA enrolment (TOTP) and the enrolment UI
- Session list with remote sign-out
- Onboarding: role selection and consent capture. Consent capture is blocked on published
  legal templates, which need counsel — see open question 3.
- Enabling leaked-password protection in the Supabase Auth settings (dashboard only).

## What can proceed in parallel

The marketing site (step 3) does not depend on the data model and the brand name is now
settled. The component library can also grow — tables, dialogs, forms, toasts — against the
existing tokens.
