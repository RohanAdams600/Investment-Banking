# Design system

Live reference: run `pnpm dev` and open `/foundations`. That page renders directly from the
token source, so it cannot drift from what components actually use.

## Rules

1. **Components use semantic roles, never primitives.** `bg-surface`, not `bg-white`.
   `text-muted`, not `text-gray-500`.
2. **Hex values appear in exactly one file** — `packages/ui/src/tokens/primitives.ts`.
3. **After editing any token, run `pnpm --filter @ib/ui tokens:build`.** CI fails if the
   generated CSS is stale.
4. **Every interactive element implements six states**: default, hover, active,
   focus-visible, disabled, loading.
5. **Every table implements**: sorting, column visibility, pagination, empty state, loading
   skeleton, and CSV export where the data warrants it.

## Color roles

| Role                                                 | Use                                                   |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `canvas`                                             | Page background                                       |
| `surface`                                            | Cards, panels, tables                                 |
| `surface-raised`                                     | Popovers, dropdowns, modals                           |
| `surface-sunken`                                     | Wells, table headers, code blocks                     |
| `surface-inverted`                                   | Deliberate contrast bands, tooltips                   |
| `text-primary`                                       | Body copy and headings                                |
| `text-secondary`                                     | Supporting copy                                       |
| `text-muted`                                         | Labels, captions, placeholders                        |
| `text-inverted`                                      | Text on inverted surfaces or solid primary fills      |
| `border-subtle`                                      | Row dividers, hairlines                               |
| `border-default`                                     | Input borders, card outlines                          |
| `border-strong`                                      | Hovered inputs, emphasized separation                 |
| `primary` / `-hover` / `-active` / `-subtle` / `-fg` | Primary actions and links                             |
| `accent` / `-subtle` / `-fg`                         | Verification and premium only — see the scarcity rule |
| `success` `warning` `danger` `info` (+ `-subtle`)    | State, never decoration                               |
| `ring`                                               | Focus ring                                            |
| `overlay`                                            | Modal scrim, always at reduced opacity                |

### The gold rule

Champagne gold (`accent`) appears at most once per screen. It marks verification and
premium status. It is never a background, never a heading color, never a second CTA. Two
gold elements in one view means one of them is wrong.

## Type scale

`2xs` 11 · `xs` 12 · `sm` 14 · `base` 16 · `lg` 18 · `xl` 20 · `2xl` 24 · `3xl` 32 ·
`4xl` 40 · `5xl` 56

Every size ships with a paired line height and, above 24px, tightened letter-spacing.
`5xl` is hero-only.

Three families: `font-display` (marketing headers), `font-sans` (the application),
`font-mono` (figures).

### Financial figures

Every monetary value, multiple, and percentage uses `.font-tabular` — the mono face with
tabular numerals. Non-aligning digits in a column of dollar amounts is the detail that
tells a finance audience the product was not built for them.

Amounts are stored and passed as **integer cents**, never floats. `packages/core/src/format/money.ts`
throws on a non-integer input rather than rounding it, because a float arriving there means
an upstream calculation escaped integer arithmetic — and on a commission ledger, that is a
bug worth failing loudly on.

## Spacing

4px base grid. Tailwind's default numeric scale, extended with `4.5` `13` `15` `18` `22`
`30` `38` for the gaps that recur in dense forms and marketing rhythm.

## Radius

`sm` 3 · `DEFAULT` 4 · `md` 6 · `lg` 8 · `xl` 12 · `full`

Restrained on purpose. Nothing above `xl` except pills.

## Elevation

`xs` `sm` `md` `lg` `xl`, tinted with ink rather than pure black so shadows read as depth
rather than dirt. In dark mode, depth comes from surface role changes
(`surface` → `surface-raised`), not from heavier shadows.

## Motion

Durations: `fast` 150ms (hover, focus, color), `base` 250ms (dropdowns, tooltips,
accordions), `slow` 400ms (modals, drawers).

One standard easing curve — `cubic-bezier(0.2, 0, 0.1, 1)` — with `enter` and `exit`
variants for elements crossing the viewport boundary.

`prefers-reduced-motion` is honored globally in `globals.css`. It is not a per-component
concern and cannot be forgotten on a new component.

## z-index

Named layers only: `base` `raised` `sticky` `header` `overlay` `modal` `popover` `toast`
`tooltip`. No bare numbers in components — stacking conflicts get resolved in the token
file rather than by escalating magic numbers across the codebase.

## Components

Current set (`packages/ui/src/components`):

`Button` · `Badge` / `VerifiedBadge` · `Input` · `Card` · `Skeleton` / `SkeletonText` ·
`EmptyState` · `AIDisclaimer`

Built on Radix primitives where behavior is non-trivial. Installed and ready for the next
wave: accordion, checkbox, dialog, dropdown-menu, label, popover, select, tabs, toast,
tooltip.

### `AIDisclaimer` is mandatory

Every surface that renders AI output renders an `AIDisclaimer` beside it. It exists as a
component specifically so a new page cannot omit it by accident, and so a reviewer can
grep for it.

Variants: `general` · `valuation` · `legal` · `tax` · `market-context` · `match`

The `valuation`, `legal`, and `tax` variants carry **fixed wording that callers cannot
override**. `children` adds context around the fixed text; it never replaces it. The exact
strings are asserted in `ai-disclaimer.test.tsx`, so tightening them for tone becomes a
deliberate act with a visible diff rather than an incidental edit.

`TAX_DISCLAIMER_TEXT` and `VALUATION_DISCLAIMER_TEXT` are exported as plain strings so
non-React surfaces — PDF footers, CSV headers, email — use the identical language.
