# Build sequence

Twelve steps, from the specification. Each is complete only when it has tests and its
documentation is current.

| #   | Step                                                    | Spec sections | Status                                                       |
| --- | ------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| 1   | Repo scaffold, design tokens, shared UI, docs skeleton  | 1, 16         | **Complete**                                                 |
| 2   | Auth, roles/permissions, base data model, RLS policies  | 3.2, 14       | **Blocked** — needs multi-tenancy and jurisdiction decisions |
| 3   | Marketing site                                          | 1, 2          | Not started — needs the brand name                           |
| 4   | Core listings + buyer/seller dashboards                 | 3, 6, 7       | Not started                                                  |
| 5   | Matching engine                                         | 5             | Not started                                                  |
| 6   | Deal room, NDA flow, document vault                     | 8             | Not started                                                  |
| 7   | CRM + messaging                                         | 9, 10         | Not started                                                  |
| 8   | AI agents behind the orchestrator                       | 4             | Not started                                                  |
| 9   | Commission system + tax exports                         | 11, 12        | Not started                                                  |
| 10  | Admin panel                                             | 13            | Not started                                                  |
| 11  | Security hardening + compliance templates               | 14, 15        | Not started                                                  |
| 12  | Testing catch-up, deployment pipeline, launch readiness | 16            | Partial — CI pipeline exists                                 |

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

## Why step 2 is blocked

The data model is expensive to change once listings, deal rooms, and audit logs reference
identity. Two decisions have to land first:

**Multi-tenancy.** Whether firms (PE, family office, brokerages) are first-class tenants
with firm-scoped data isolation, or whether firm membership is an attribute of a user.
This determines whether nearly every table carries a tenant column and whether RLS policies
are tenant-scoped. Retrofitting it later means a migration touching every table plus a
rewrite of every policy.

**Jurisdiction scope.** Whether disclosure and consent records are modeled per-state from
day one. Broker licensing disclosure requirements vary by state, and consent records are
retained for their legal life — reconstructing which version of which disclosure a user
accepted, after the fact, is not possible if it was not recorded at the time.

Both are in `docs/decisions/open-questions.md`.

## What can proceed in parallel

Nothing in step 3 (marketing site) depends on the data model, but it does need the brand
name to avoid building pages that get rewritten. The component library can grow (tables,
dialogs, forms, toasts) against the existing tokens without either decision.
