# Brand guide

## Positioning

Professional infrastructure for lower-middle-market M&A. The platform is plumbing that
happens to be well made — serious, discreet, data-driven. It is not a marketplace app that
happens to sell businesses.

The people on it are transacting the largest financial event of their lives, or deploying
committed capital against a mandate. Neither audience is entertained by a product that
tries to delight them. Both are reassured by one that is fast, precise, and does not lose
their documents.

## Voice

Precise, confident, understated. Specifics over adjectives.

| Instead of                            | Write                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "Revolutionary AI-powered matching"   | "Match scores from stated criteria and platform activity, with the three factors behind each score shown" |
| "Get your business valued instantly!" | "Estimated valuation range, with the assumptions you can edit"                                            |
| "Bank-level security"                 | "Documents encrypted at rest, access logged per view and download"                                        |
| "Join thousands of happy buyers"      | "1,240 active buyers. 61 deals under LOI this quarter."                                                   |

Rules that hold everywhere:

- **No hype vocabulary.** Never: revolutionary, game-changing, seamless, effortless,
  unlock, supercharge, cutting-edge, world-class.
- **No exclamation marks** in product copy. None.
- **Numbers beat adjectives.** If a claim can carry a figure, it carries a figure — and
  the figure has to be real, or visibly labeled as sample data.
- **Never promise an outcome.** Not "find your buyer" — "reach 1,240 qualified buyers".
- **Never claim compliance.** The platform provides tools that support the user's own
  compliance process. It does not make anyone compliant, and no copy may suggest it does.

## Tone by surface

| Surface            | Tone                                                                           | Example                                                                                      |
| ------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Marketing site     | Confident, warm. Full sentences, some rhythm.                                  | "Most owners sell once. The buyers on the other side of the table do it professionally."     |
| In-app             | Efficient, neutral. Short. No personality.                                     | "3 documents pending review."                                                                |
| Empty states       | Helpful, specific about the next action.                                       | "No listings match these filters. Widen the revenue range to see 12 more."                   |
| Errors             | Plain. What happened, what to do. Never blame the user, never apologize twice. | "That file is larger than the 50 MB limit. Split it, or upload it to the deal room instead." |
| Legal / compliance | Plain and unambiguous. Short sentences. No hedging, no reassurance.            | "This platform does not provide tax advice."                                                 |
| AI output          | Framed as input to a decision, never as the decision.                          | "Estimated range, based on the assumptions below."                                           |

The compliance register is deliberately flatter than everything else. A disclaimer written
warmly reads as an attempt to soften it, which is the opposite of what it is for.

## Color

Full token reference: `docs/design-system.md`. The brand-level rules:

- **Deep navy `#0B1220`** carries authority. Headers, dark surfaces, the mark.
- **Institutional blue `#1E3A5F`** is the working color — every primary action, every link.
- **Champagne gold `#C9A24B`** is the scarce one. Verification marks, premium tier
  indicators, at most one CTA per screen. Gold used as a background, a heading color, or
  on more than one element per view is the single fastest way to make this product look
  cheap. If a screen has two gold things on it, one of them is wrong.
- **Semantic colors** (`success`, `warning`, `danger`, `info`) carry state and only state.
  Never decorative.

## Typography

| Role    | Face          | Where                                         |
| ------- | ------------- | --------------------------------------------- |
| Display | Space Grotesk | Marketing hero, section headers, the wordmark |
| UI      | Inter         | Everything in the application                 |
| Mono    | IBM Plex Mono | Financial figures, IDs, anything in a column  |

Every monetary figure and every multiple renders in the mono face with tabular numerals
(`.font-tabular`). A column of dollar amounts that does not align down the decimal is the
detail that tells a CFO this was built by people who do not handle money.

The display face is one of two credible directions. The alternative is a high-contrast
serif (Fraunces) for a more traditional, less technical read. Switching is a two-line
change in `apps/web/src/app/layout.tsx` — the token system does not care. Worth mocking
both against the final logo before committing.

## Motion

Restrained. Three durations (150 / 250 / 400ms) and one standard curve, defined in
`packages/ui/src/tokens/layout.ts`.

Motion clarifies where something came from. It does not entertain. Nothing bounces,
nothing springs, nothing animates on scroll for its own sake. `prefers-reduced-motion` is
honored globally in `globals.css` — not per component, so it cannot be forgotten.

## Photography and illustration

- **No stock photography of people in suits shaking hands.** No exceptions.
- Prefer data visualization, documents, and structural abstractions over people.
- Where people appear (testimonials, team), use real photographs of real people. A
  testimonial with a stock headshot is worse than a testimonial with no image.
- Illustration, if used, is geometric and single-weight — consistent with the mark.
