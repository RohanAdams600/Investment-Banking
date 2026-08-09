# AI-powered investment banking marketplace

A marketplace platform for lower-middle-market M&A: business listings, role-based portals
for buyers, sellers, investors, search funds, PE, family offices and brokers, AI-assisted
matching and valuation, secure deal rooms, CRM, and commission tracking.

**Status: build step 1 of 12 complete.** Foundations — workspace, design tokens, shared
component library, documentation. No data model, auth, or application features yet.

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

- `http://localhost:3000` — placeholder home
- `http://localhost:3000/foundations` — living design-system reference

## Commands

| Command                             | What it does                                                  |
| ----------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                          | Development server                                            |
| `pnpm build`                        | Production build                                              |
| `pnpm test`                         | Test suite                                                    |
| `pnpm typecheck`                    | Typecheck every workspace package                             |
| `pnpm lint`                         | Lint packages and app                                         |
| `pnpm format`                       | Prettier                                                      |
| `pnpm --filter @ib/ui tokens:build` | Regenerate token CSS — **run after editing any design token** |

## Layout

```
apps/web         Next.js 15 App Router
packages/ui      Design tokens + shared component library
packages/core    Framework-free domain logic (no React, no Next, no DOM)
docs/            Architecture, design system, brand, open decisions
```

## Conventions worth knowing before contributing

- **Money is integer cents.** Never floats. The formatters in `packages/core` throw on
  non-integer input rather than rounding it.
- **Components use semantic color roles**, never primitives. `bg-surface`, not `bg-white`.
- **Hex values live in exactly one file**: `packages/ui/src/tokens/primitives.ts`.
- **Every AI surface renders `<AIDisclaimer />`.** The `valuation`, `legal`, and `tax`
  variants carry fixed wording that callers cannot override.
- **The company name is not hard-coded anywhere.** It comes from `NEXT_PUBLIC_BRAND_NAME`.

## Documentation

Start at [`docs/README.md`](./docs/README.md).

Two worth reading first:

- [`docs/roadmap.md`](./docs/roadmap.md) — the build sequence and what is blocked
- [`docs/decisions/open-questions.md`](./docs/decisions/open-questions.md) — decisions
  needed before step 2 can start

## Compliance posture

Non-negotiable, and baked into components rather than left to per-page discipline:

- AI output is **informational only**. Never legal, tax, or investment advice.
- Valuations are **estimates with a range and visible assumptions** — never a single number,
  never an appraisal.
- No agent sends anything externally without a human clicking send.
- The platform never claims to guarantee legal or regulatory compliance. Compliance
  features are tools supporting the user's own process.
