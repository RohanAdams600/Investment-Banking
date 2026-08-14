# Build sequence

Twelve steps, from the specification. Each is complete only when it has tests and its
documentation is current.

| #   | Step                                                    | Spec sections | Status                                               |
| --- | ------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| 1   | Repo scaffold, design tokens, shared UI, docs skeleton  | 1, 16         | **Complete**                                         |
| 2   | Auth, roles/permissions, base data model, RLS policies  | 3.2, 14       | **Complete** — consent capture awaits templates      |
| 3   | Marketing site                                          | 1, 2          | **Complete** — landing page; blog/SEO deferred       |
| 4   | Core listings + buyer/seller dashboards                 | 3, 6, 7       | **Complete** — media gallery deferred                |
| 5   | Matching engine                                         | 5             | **Complete** — NL search deferred                    |
| 6   | Deal room, NDA flow, document vault                     | 8             | **Complete** — watermarking deferred                 |
| 7   | CRM + messaging                                         | 9, 10         | Not started                                          |
| 8   | AI agents behind the orchestrator                       | 4             | Not started                                          |
| 9   | Commission system + tax exports                         | 11, 12        | **Partial** — records built; exports not             |
| 10  | Admin panel                                             | 13            | **Complete** — audit export deferred                 |
| 11  | Security hardening + compliance templates               | 14, 15        | **Partial** — step-up applied; CSP and templates not |
| 12  | Testing catch-up, deployment pipeline, launch readiness | 16            | Partial — CI pipeline exists                         |

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

## Step 10 — the admin panel

Five screens (`/admin`, review, verification, jurisdictions, audit) and one migration, 0022. Most of the work was in what the panel refuses to show.

### Admin is not a superuser, and this is where that got expensive

The capability catalog has said so since step 2: `admin` carries verification, listing
review, templates, jurisdictions and audit, and deliberately not `deal_room:access`,
`document:download` or `listing:view_full`. Building the screens is where that stopped
being a comment. The obvious way to build a review queue is broad read access filtered in
the UI, and every shortcut here would have been that.

So each power is granted as narrowly as it goes:

- verification changes `verification_status` and nothing else, enforced by a trigger that
  copies the new row, normalises the two columns that may move, and compares against the
  old — a whole-row comparison catches a column added next year that nobody thought to
  protect, which an explicit column list would not;
- listing review was already narrow (0016 restricts a non-controller to the status
  column), so the panel inherited it;
- `listing_details` and `listing_financials` stay unreachable, and two tests assert an
  admin reading them gets zero rows.

### The review queue collided with that principle immediately

The queue's first draft asked `exists (select 1 from listing_details ...)` inline, and it
was always false for the only person meant to read it. The view is declared
`security_invoker = true`, so that subquery runs with the caller's rights — and admins are
deliberately excluded from `listing_details`.

Which is the right collision to have. The fix is not to open the table but to ask a
narrower question: `app.listing_has_profile()` and `app.listing_financial_years()` return a
boolean and a count, guarded inside their own bodies, and never a value from inside the
row. A reviewer learns the listing is complete without learning what it says.

### Rejection needed a reason, and a reason needed a hiding place

`listing_status_history.reason` had existed since 0015 with nothing ever writing to it. A
reviewer sending a listing back to draft with no explanation gives the seller a rejection
and nothing to act on, so `change_listing_status()` now carries one — on a
transaction-local setting read by the history trigger, because the alternative was an
UPDATE grant on an append-only table.

That immediately created a leak. 0016 admitted anybody who can see a discoverable listing
to its status history, reasoning that the reason text was seller-side only; true until
something started writing to it, and RLS is row-level, so "they can read the row but not
that column" was never something the policy could say. A buyer could have selected
`reason` straight through PostgREST. The policy now narrows to the seller and admins, and
the public timeline moved to `listing_status_timeline` — a view with no reason column to
leak. Same teaser/detail split as listings themselves, one table down.

The function is invoker-rights, deliberately: the update inside is subject to exactly the
policies 0016 already wrote, so a buyer calling it moves zero rows. It is the ordinary
update plus somewhere to put the sentence explaining it.

### Jurisdictions are a switch, not a claim

Turning New York on opens it to new business. It does not verify a licence, check a
registration, or make the platform compliant there. The page says so in those words,
because the one thing this screen must never imply is that flipping it did any of the
compliance work.

### Deferred

Audit export for a regulator or an incident review. The log is readable and filterable at
200 entries; getting it out of the browser is step 11's problem.

## Step 6 — the document vault

Migration 0023, `packages/core/src/documents`, and one screen at
`/deals/[dealId]/documents`. It is also where `document:upload`,
`document:download` and `document:set_permissions` stop being aspirational —
they have been in the capability catalog since step 2 with nothing enforcing them.

### The scenario the whole design is for

A seller with two bidders in the same room. Everything here is about the second
bidder not seeing what the first one was shown, and it is why the vault is a
separate table from message attachments rather than a folder in one.

An attachment inherits its conversation's membership exactly, which is right for
"here is the thing I was talking about". A diligence document belongs to the deal,
is filed under a category, is superseded rather than resent, and is often released
to one party and not another.

### Three levels, and the sentence each one is

`private` / `restricted` / `deal`, labelled in the UI as "only my side", "only the
people I name", "everyone in this deal room". Every per-document permission scheme
grows towards a matrix nobody can reason about, and a model a seller cannot hold in
their head is one they will get wrong under time pressure — which is exactly when
the confidential file goes to the wrong bidder. Releasing names a person from the
room; there is nowhere to paste an identifier.

Deal membership is required in every branch of `app.can_read_document()`, so
removing somebody from the room closes their documents even if nobody remembered to
revoke the grants. A test asserts that.

### Two things the tests caught

**Firm membership is not deal membership.** The first version of the test put the
uploader's colleague outside the room and expected the firm branch to admit them. It
did not, and it should not: a brokerage runs twenty deals and not every broker
belongs in every room. What the firm branch buys is narrower — a colleague already
in the room reads their own side's documents without a separate grant.

**Withdrawal made the row unreachable to its own owner.** `can_read_document`
excludes withdrawn documents, and Postgres applies SELECT policies to
`UPDATE ... WHERE` — so after withdrawing, the next update matched zero rows instead
of being refused. Silent, and indistinguishable from success. The SELECT policy now
also admits `controls_document`, which is the honest model anyway: a withdrawn
document is part of the record of what was disclosed and when it was pulled.

### What the access log claims, and what it does not

That a signed URL was issued to this person for this document at this time. Whether
the bytes arrived, and whether they were then forwarded, is outside what any server
can observe — so the page says exactly that instead of implying a chain of custody.
Refusals are logged too, and a run of `denied` against one document is the
interesting row.

### Deferred

Watermarking. Stamping a viewer's name into a PDF is a real deterrent, and doing it
properly needs a render pipeline this step does not have. The access log is the part
that is actually evidence, and it is built.

## Step 7 — the CRM

Migration 0024, `packages/core/src/crm`, one screen at `/crm`. It also enforces
`crm:manage`, which had been in the capability catalog since step 2 with nothing
checking it.

### A contact is not a user

The shape of the whole schema follows from this. Most people in a broker's
pipeline have never signed up and never will — the accountant who refers deals,
the owner who might sell in two years, the buyer who called about a listing and
left a phone number. A CRM that could only track platform accounts is a CRM the
broker keeps in a spreadsheet instead.

So `contacts` carries its own identity with an **optional** `user_id`, set if and
when that person signs up. Building it the other way round — a profile row for
everybody a broker has ever met — would mean fabricating accounts nobody asked
for, and putting those people inside every policy that trusts `auth.users`.

### The firm is the boundary, and there is no admin branch

A brokerage's pipeline is the most commercially sensitive thing it owns; two
brokers at rival firms share this platform. Every policy here is
`app.owns_crm_row()`, and unlike listings there is no half of a contact that is
safe to show — so platform admins see nothing either. A test asserts that.
Operations verifies people and moderates listings; who a brokerage is talking to
is none of its business, and an escape hatch "for support" is how that stops
being true.

Unaffiliated sellers have no firm, so rows carry `owner_id` instead. A check
constraint says exactly one of the two is set: a row with neither is invisible to
every policy — data nobody can reach or delete — and a row with both would be
visible through two.

### Dedupe is a constraint, not a nightly job

The same person inquires on three listings and fills in the contact form twice.
Calling them five times is how a brokerage loses a referral source, so Postgres
refuses the duplicate: a unique index on `(firm_id, lower(email))`, partial so
phone-only leads do not collide with each other. `contactKey()` in
`packages/core` mirrors it so the warning arrives before the constraint
violation does.

Deliberately **not** applying Gmail's dot and plus rules. They are real and
specific to Gmail; applying them everywhere would merge two different people's
records at another provider, which is the wrong direction to be wrong in.

### Stage and status are separate facts

The stage is where somebody dragged the card; the status is what actually became
of the lead. Collapsing them would mean a board that has been tidied claims deals
that never closed, so the card carries both controls and `countPipeline()` trusts
the status over the column.

### What is deliberately absent

No lead score, no engagement index, no conversion rate. A percentage computed
over three weeks of pipeline is a number that gets quoted in a board meeting and
means nothing, and a "heat" score would be a guess dressed as a metric — which
this codebase has a rule about. What the board shows is counts, and one of them
is `overdue`: a next action whose date has passed is somebody who was promised a
call that did not happen.

### Deferred

Notification preferences, and meetings as calendar entries.

## What can proceed in parallel

The marketing site (step 3) does not depend on the data model and the brand name is now
settled. The component library can also grow — tables, dialogs, forms, toasts — against the
existing tokens.
