# Build sequence

Twelve steps, from the specification. Each is complete only when it has tests and its
documentation is current.

| #   | Step                                                    | Spec sections | Status                                   |
| --- | ------------------------------------------------------- | ------------- | ---------------------------------------- |
| 1   | Repo scaffold, design tokens, shared UI, docs skeleton  | 1, 16         | **Complete**                             |
| 2   | Auth, roles/permissions, base data model, RLS policies  | 3.2, 14       | **Unblocked** — ready to start           |
| 3   | Marketing site                                          | 1, 2          | Not started — brand name settled (Cairn) |
| 4   | Core listings + buyer/seller dashboards                 | 3, 6, 7       | Not started                              |
| 5   | Matching engine                                         | 5             | Not started                              |
| 6   | Deal room, NDA flow, document vault                     | 8             | Not started                              |
| 7   | CRM + messaging                                         | 9, 10         | Not started                              |
| 8   | AI agents behind the orchestrator                       | 4             | Not started                              |
| 9   | Commission system + tax exports                         | 11, 12        | Not started                              |
| 10  | Admin panel                                             | 13            | Not started                              |
| 11  | Security hardening + compliance templates               | 14, 15        | Not started                              |
| 12  | Testing catch-up, deployment pipeline, launch readiness | 16            | Partial — CI pipeline exists             |

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

## Step 2 scope

1. Supabase project, region pinned (see open question 6)
2. Migrations: `firms`, `firm_members`, `users`, `user_roles`, `jurisdictions`,
   `legal_templates`, `consent_records`, `sessions`, `mfa_factors`
3. Tenant-scoped RLS on every table, plus a test asserting no table has RLS disabled — a
   table without it is publicly readable with the anon key
4. Permission model in `packages/core`, framework-free and unit-tested, so the same
   capability checks serve the API layer, scheduled jobs, and a future partner API
5. Auth flows: sign-up, sign-in, MFA enrolment, session list with remote sign-out

The entity inventory is in `docs/data-model.md`. Column-level design lands with the
migrations.

## What can proceed in parallel

The marketing site (step 3) does not depend on the data model and the brand name is now
settled. The component library can also grow — tables, dialogs, forms, toasts — against the
existing tokens.
