# Build sequence

Twelve steps, from the specification. Each is complete only when it has tests and its
documentation is current.

| #   | Step                                                    | Spec sections | Status                                          |
| --- | ------------------------------------------------------- | ------------- | ----------------------------------------------- |
| 1   | Repo scaffold, design tokens, shared UI, docs skeleton  | 1, 16         | **Complete**                                    |
| 2   | Auth, roles/permissions, base data model, RLS policies  | 3.2, 14       | **Complete** — consent capture awaits templates |
| 3   | Marketing site                                          | 1, 2          | **Complete** — landing page; blog/SEO deferred  |
| 4   | Core listings + buyer/seller dashboards                 | 3, 6, 7       | **Complete** — media gallery deferred           |
| 5   | Matching engine                                         | 5             | **Complete** — NL search deferred               |
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

## Step 2 — completed since

- **MFA (TOTP)**: enrol, verify, unenrol, with removal gated on a session that actually
  completed the second factor. `/settings/security`.
- **Session management**: device list with browser/platform, last-seen, and 2FA marker;
  revoke one or all others. Backed by `list_my_sessions()` and `revoke_session()`, both
  SECURITY DEFINER and filtered on `auth.uid()` — so the app never holds a credential that
  could read anybody else's sessions.
- **Step-up guard** (`requireStepUp`) for actions where a stolen session is the threat.
  Available; not yet applied to any route.

Role selection now ships (see below). Consent capture remains blocked on published legal
templates — see open question 3.

## Deal room messaging (out of sequence, requested)

Built ahead of steps 6–7 on request. `/deals/[dealId]/messages`.

- **Schema**: `deals`, `deal_conversations`, `conversation_members`, `messages`,
  `message_audit_log` (migrations 0011–0012).
- **A third role axis**: `conversation_role` (buyer / seller / banker / admin), separate
  from platform and firm roles.
- **RLS**: read and send require active membership; `sender_id` must equal `auth.uid()`;
  triggers freeze sender, conversation, and send time; withdrawal is a soft delete through
  `withdraw_message()`.
- **Audit log written by triggers**, not by the application, so no code path can skip it.
  Records body length, never bodies.
- **Realtime**: private broadcast channels, authorized by RLS on `realtime.messages`.
  Payload carries ids only; clients refetch through RLS.
- **Attachments**: private bucket, 60-second signed URLs, no permanent public URL.
- **34 RLS tests** covering cross-deal isolation, impersonation, removed members, and
  append-only guarantees.

Not built: message editing UI (the API and policies exist) and transcript export (the
`exported` audit action is defined for it). Deal creation landed in 0014, below.

## Onboarding and deal creation

The product was unusable end to end until this landed, and the two gaps compounded:

- A new account holds **no platform role**, so every capability check returned false. Deny
  by default is the right posture, but without a way to choose it is a dead end. `/onboarding`
  is the picker; the dashboard redirects there when an account is roleless.
- **There was no way to open a deal or its first conversation.** Every messaging policy
  computes authorisation from conversation membership, and membership could only be granted
  by an existing administrator — so nothing could ever be created, and the deal room verified
  at length in the previous step was unreachable by anyone.

`create_deal()` (migration 0014) creates the deal, its first conversation and the creator's
banker membership in one transaction. Same reasoning as `create_firm`: two statements leave
a window in which the thing exists unclaimed. Sell-side only — a buyer is invited into a
deal, they do not start one — and a test asserts the SQL rule agrees with `deal:create` in
the TypeScript capability catalog, since the two are the same rule expressed twice.

Also landed: valuation estimates persist (recalculated server-side from the inputs rather
than trusting the browser's numbers), and the dashboard links to every route that now
exists.

## Step 4 — what shipped

Listings, end to end: a seller brings a business to market, a buyer finds it, asks for
access, signs, and reads the confidential half.

- **Schema** (0015): `listings` (anonymised teaser), `listing_details` (NDA-gated),
  `listing_financials`, `listing_ndas`, `listing_status_history`, `listing_saves`.
- **The teaser/profile split.** Two tables rather than one, because **RLS is row-level, not
  column-level** — a single table cannot hide the company name from a buyer who has not
  signed. Mirrored in the API types: `ListingTeaser` and `ListingFullProfile` are separate
  types, so a public list component cannot be handed a confidential profile.
- **The gate** (0016): `listing_details_select_nda` requires an NDA that is signed, not
  revoked, not expired, held by this caller, on this listing — and the listing still on the
  market, so withdrawing it closes access already granted.
- **Lifecycle enforced in a trigger**, with every transition logged by the database rather
  than by the application. `closed` and `withdrawn` are terminal.
- **Seller**: create a draft, edit the public and confidential halves separately, add
  financial years, move the listing through its lifecycle, and work an inbound queue of
  access requests. `/listings/new`, `/listings/mine`, `/listings/[id]/edit`.
- **Buyer**: browse with filters as a shareable URL, request access, sign, read the full
  profile, save to a watchlist. `/listings`, `/listings/[id]`, `/watchlist`.
- **Dashboard** is now capability-driven rather than a fixed list — `can(actor, …)` decides
  which destinations appear.
- **`Select` and `Textarea`** added to the component library, both native elements.
- **92 new tests.** 72 against real Postgres for the gate and the lifecycle, 20 in core for
  band formatting and the transition map. Two parity tests drive SQL and TypeScript through
  the same cases: all 49 ordered status pairs, and every NDA state.

Three defects were caught by writing those tests and fixed before anything was applied: the
NDA insert policy was scoped to the `buyer` role and would have locked out family offices,
search funds and PE (all of which carry `nda:sign`); a buyer could have extended their own
`expires_at` indefinitely, making the expiry check decorative; and a seller could have
transferred a listing to another user, because the UPDATE policy's `WITH CHECK` evaluates
the committed row and therefore the _old_ owner.

Not built: the media gallery (`listing_media`), and the matching feed — `scoreFit()` has
been tested and unused since step 3, and now that listings exist it is the obvious next
thing to wire up.

## Step 5 — what shipped

Matching, buyer and seller identity, and outreach a person approves.

- **Schema** (0017): `match_scores` with the contributing factors stored, and
  `outreach_drafts` with an approval gate enforced by trigger.
- **The confidentiality problem, solved rather than dodged.** A good score needs the
  seller's exact figures; the buyer being scored has signed nothing. So the matcher runs
  server-side against the real numbers and stores **only a redacted explanation** —
  `redactFitResult()` strips every figure, and a test sweeps 2,520 input combinations
  asserting no digit survives. The buyer gets an accurate ranking; the seller discloses
  nothing.
- **AI on the thesis** (0018, `lib/ai/`). A model router (Claude first, OpenAI second,
  neither required) reads the buyer's free-text thesis against the listing teaser. Kept in
  separate columns from the arithmetic, because a blended number cannot be explained and
  the deterministic half has to stay reproducible. The model never sees the confidential
  profile — see `docs/agents.md`.
- **Outreach**: personalised automatically, sent only after a person approves the exact
  wording. Editing an approved draft withdraws the approval.

### The correction in 0018

0015 and 0016 anonymised too much. They treated the _people_ as confidential along with the
business, which is not how brokerage works:

- Every listing now names the broker or seller representing it. A buyer needs somebody to
  call, and a deal offered by nobody in particular does not get taken seriously.
- The seller's NDA queue and matched-buyer list show real identities — name, entity,
  funding source, prior deals. A seller shown "identity withheld" cannot judge whether to
  release their financials, and will approve everyone or no one.
- Buyers control this with `is_discoverable` on their criteria. Off means they keep their
  own match feed and disappear from every seller's view.

The business stays confidential. Getting those two the same way round was the mistake.

Also found and fixed while testing: `buyer_profiles_select_counterparty` subqueried
`match_scores`, whose own RLS hides those rows from the seller — so the policy denied
everything while looking correct. Third time this codebase has hit that class of bug; the
fix is a `SECURITY DEFINER` helper, `app.is_my_counterparty()`.

Not built: natural-language search with editable parsed filters, and behavioural signal
(browse/save/skip) feeding the score.

## Onboarding questionnaire, multi-method valuation, legal revision

Three additions that make the first ten minutes of the product actually work.

### The questionnaire

A new account used to land on an empty dashboard: no matches, no listing, no
valuation, because the platform knew nothing about them. Now onboarding hands
straight into a questionnaire — **one question per screen**, branching by role,
resumable across devices.

One at a time costs clicks and buys two things worth more. Answer quality: a
twenty-field form gets skimmed and half-filled, a single question gets read, and
everything downstream is only as good as what people actually tell us. And
branching that makes sense: asking a PE fund about SBA financing wastes their
time and says we were not listening.

The engine (`packages/core/src/questionnaire`) is framework-free, so the
questions can be reviewed as content rather than read out of JSX. Answers are
scratch until the flow completes; `finishQuestionnaire` maps them onto
`acquisition_criteria`, `buyer_profiles` and `seller_preferences`, and that
mapping lives in one file. Question wording can change without changing what
matching computes.

### Sellers say who they want to sell to

`seller_preferences` (migration 0019) is the part nobody else models. Owners who
spent decades building something care whether the staff keep their jobs, whether
the name survives, and whether the buyer is a competitor who will strip it —
often more than they care about the last five percent of price.

That makes matching two-sided: `scoreSellerFit()` ranks buyers _for the seller_,
stored alongside the existing score. A buyer scoring 91 on the business and 40 on
the seller's wishes is worth talking to and worth knowing about, because that gap
is where deals fall apart at week ten. The frictions are surfaced explicitly —
including that nothing on this platform binds a buyer to keep staff, which
belongs in the purchase agreement and is a conversation for an attorney.

### Valuation across methods

`valueAllMethods()` adds revenue-multiple and asset-based alongside the earnings
multiple, with derived metrics (margin, revenue per employee, concentration,
recurring share) and their interpretation.

Two things it fixes. A single range invites the reader to treat it as _the_
number — now the spread between methods is itself shown, and when they do not
overlap that is said rather than averaged away. And a business at or below
break-even used to get an error where a number should be; the revenue and asset
methods still say something a buyer would recognise.

`describeAskingPrice()` compares an asking price to the estimate and never
objects to it. A seller may price above the range for good reasons — a strategic
buyer circling, land under the building — and a platform that refused would be
substituting its judgement for the owner's on the sale of their own business. A
test asserts the wording never directs.

### Legal revision

`diffDocuments()` gives a proper LCS redline, and flags clauses that disappeared
between versions — indemnification, governing law, confidentiality — because
that is what gets missed in a long redline and matters most when it does. Every
version is kept; nothing is overwritten. `summariseRevision()` counts and flags
and never characterises a change as good, risky, or a concession. A test asserts
that too.

## What can proceed in parallel

The marketing site (step 3) does not depend on the data model and the brand name is now
settled. The component library can also grow — tables, dialogs, forms, toasts — against the
existing tokens.
