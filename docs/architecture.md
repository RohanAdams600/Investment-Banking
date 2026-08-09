# Architecture

## Current state

Build step 1 of 12 is complete: workspace, design tokens, shared UI library, docs. No data
model, no auth, no application features yet. See `docs/roadmap.md` for the sequence.

## Repository layout

```
apps/
  web/                    Next.js 15 App Router — marketing site + authenticated app
    src/app/              Routes. Marketing moves to app/(marketing) in step 3.
    src/features/         Feature modules (listings, matching, deal-room, crm, ...)
packages/
  ui/                     Design tokens + shared component library
    src/tokens/           TypeScript source of truth for every design decision
    src/components/       Radix primitives styled with Tailwind
    src/styles/           tokens.css — GENERATED, do not edit
    scripts/              Token CSS generator
  core/                   Framework-free domain logic. No React, no Next, no DOM.
    src/brand/            Brand configuration
    src/format/           Money and figure formatting
docs/
```

### Why a monorepo

Two forces, both from the specification.

The **partner API** and **mobile apps** are named as future expansion. Both need business
logic that is not entangled in React components. `packages/core` is that boundary: it has
no framework dependency, so a React Native app or a versioned partner API can import the
same commission calculator and the same matching score the web app uses. Enforced by the
package's dependency list, which contains exactly one entry (`zod`).

The **eight role-based portals** are one product with eight permission scopes, not eight
applications. They share the component library, so a change to how a table paginates
happens once. `packages/ui` is that boundary.

If either boundary starts to feel like overhead, the correct response is to check whether
something has leaked across it — not to collapse it.

### Why `core` has no React

A commission calculation that can only run inside a React tree can only be tested inside a
React tree, and can only run on a surface that has React. Commission math needs to run in
a scheduled job, in a PDF generator, and eventually behind a partner API. Keeping it in a
plain TypeScript package makes that free and makes the tests fast.

## Design token flow

```
packages/ui/src/tokens/*.ts          TypeScript — the source of truth
        |
        |-- tailwind-preset.ts  -->  apps/web/tailwind.config.ts   (utility classes)
        |
        `-- scripts/build-tokens.ts -> src/styles/tokens.css       (CSS variables)
                                              |
                                              v
                                       imported in layout.tsx
```

Both paths derive from the same TypeScript. The CSS is generated and committed, and CI
runs `tokens:check` to fail the build if the committed CSS no longer matches the source.
This is the mechanism that keeps "change the palette in one place" true rather than
aspirational.

Components reference **semantic roles** (`bg-surface`, `text-muted`), never primitives
(`bg-ink-900`). A role carries a different value in light and dark mode, so a component
written once is correct in both. Primitives remain reachable for the rare case that needs
a specific step — charts, brand surfaces — but a component reaching for one is a smell.

## Theming

Three states, all handled in the generated CSS:

1. No `data-theme` attribute — light palette, with dark applied via `prefers-color-scheme`
2. `data-theme="light"` — forced light, beats the media query
3. `data-theme="dark"` — forced dark, beats the media query

Colors are stored as space-separated RGB channels (`30 58 95`) rather than finished color
strings, which is what allows Tailwind's opacity modifiers (`bg-surface/60`) to work
against CSS-variable-backed colors.

## Planned architecture

Not yet built. Recorded here so the shape is agreed before implementation.

### Data and auth (step 2)

PostgreSQL via Supabase. Auth via Supabase Auth.

**Multi-tenant.** Firms — PE funds, family offices, brokerages — are the primary data
boundary, not an attribute of a user. Nearly every table carries a tenant column and every
RLS policy is tenant-scoped. A user may belong to several firms with a different role in
each.

**A user holds many roles.** A `user_roles` join table, never a role enum on `users` — a
broker who is also a buyer is one account with two roles, and the spec calls for this
explicitly. Getting it wrong here is expensive to undo once listings and deal rooms
reference user identity.

**Permissions are enforced twice.** Once at the API layer as route middleware, and again
as Postgres Row Level Security policies. The middleware is the primary control; RLS is the
backstop for the case where a route handler forgets. Neither is sufficient alone: RLS
cannot express every business rule, and middleware cannot protect against a query that
bypasses it. UI-level permission checks are presentation only and are never the control.

### Agent orchestrator (step 8)

Thirteen agents behind one orchestrator. Each declares an input contract, an output
contract, its allowed tools, and its human-approval boundary.

Model selection goes through a **model router**, not a hard-coded provider call per agent.
Reasoning and drafting route to Claude; embeddings and high-volume structured extraction
route to whichever provider is most cost-effective. An agent names the _shape_ of work it
needs, and the router picks the model — so re-routing an agent is a config change.

Two invariants hold across every agent:

1. **No autonomous external communication.** Any agent that produces an email, SMS, or
   call drafts it and stops. A human clicks send. This is a hard architectural boundary,
   not a setting.
2. **Every action is logged**, including suggestions the user never acted on, to a shared
   Agent Activity Log queryable per user and per deal.

### Documents (step 6)

Confidential documents are stored separately from general application data, with stricter
access policies. Downloads are watermarked server-side at request time with the viewer's
name, email, and timestamp — never client-side, which would be trivially bypassed.
Re-uploading a document creates a new version; nothing is silently overwritten.

## Decisions

Recorded in `docs/decisions/open-questions.md`. The three that shaped the data model —
name, tenancy, and jurisdiction scope — are resolved. The remaining open items (hosting
region, email provider, e-signature backend, AI budget) do not block step 2.
