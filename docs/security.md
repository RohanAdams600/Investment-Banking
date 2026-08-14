# Security model

How authorisation works, and why it is built the way it is. Read this before changing
anything under `supabase/migrations` or `packages/core/src/access`.

## Two independent layers

Authorisation is enforced twice, by mechanisms that do not share code.

**Layer 1 — application.** `packages/core/src/access`. Pure functions taking an `Actor`
and returning a decision. This is where business rules live: NDA gating, listing status
lifecycle, who may edit what and when.

**Layer 2 — Row Level Security.** Postgres policies in `supabase/migrations/0006_rls.sql`.
This is where tenant isolation lives: which rows a given user can see at all.

Neither is sufficient alone, which is the point of having both:

- RLS **cannot express every business rule.** "A signed NDA that has not expired unlocks
  the full profile, unless the listing was withdrawn" is application logic. Encoding it in
  a policy would make it unreadable and untestable.
- Application checks **cannot protect against a query that bypasses them.** A route handler
  that forgets to call `can()` still goes through RLS. A raw query written during an
  incident still goes through RLS.

A change that weakens one layer because "the other one covers it" is a change that removes
the redundancy both exist to provide.

## What RLS guarantees

Verified by 42 tests in `supabase/tests/rls.test.ts`, run against a real Postgres in CI, and re-verified against the live Supabase project:

| Guarantee                                | Mechanism                                                            |
| ---------------------------------------- | -------------------------------------------------------------------- |
| A user sees only their own firms         | `app.user_firm_ids()` in every tenant-scoped policy                  |
| Cross-tenant updates affect nothing      | `using` **and** `with check` on every update policy                  |
| No user can grant themselves `admin`     | `role <> 'admin'` in the `user_roles` insert policy                  |
| Consent records cannot be altered        | No update or delete policy, and no grant, for anyone                 |
| Clients cannot write the audit log       | No insert policy or grant; entries are written with the service role |
| Profiles are not a directory             | Select limited to self, firm colleagues, and admins                  |
| Unpublished legal templates stay private | `published_at is not null` in the select policy                      |
| No firm exists without an owner          | `create_firm()` inserts both rows in one transaction                 |

## Details that are load-bearing

**`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** Without FORCE, a connection that happens
to be the table's owning role bypasses every policy silently. A test asserts both flags on
every table in `public`.

**`SECURITY DEFINER` on the helper functions.** A policy on `firm_members` that itself
queries `firm_members` re-enters that table's policy and recurses. Running the lookup as
the definer bypasses RLS for that one query and breaks the cycle.

**Pinned `search_path` on every definer function.** A `SECURITY DEFINER` function with a
caller-controlled search path is privilege escalation: the caller creates their own
`public.firm_members` earlier in the path and the definer reads it with elevated rights. A
test asserts every definer function in the `app` schema pins its search path.

**`WITH CHECK` alongside `USING` on updates.** `USING` decides which rows you may target.
`WITH CHECK` re-validates the row afterwards. With only `USING`, an administrator of firm A
could update a row and hand it to firm B — the row was visible when the check ran, and
nothing re-examined it after.

**`create_firm()` rather than a direct insert.** A firm and its first member have to be
created in one transaction. Two statements leave a window in which the firm has no members,
and any policy permissive enough to let its creator claim it is permissive enough to let
somebody else claim it first. The function also solves a mundane problem: an insert with
`RETURNING` fails under RLS because no select policy covers a firm you are not yet a member
of, so the caller never learns the id.

**`ON DELETE RESTRICT` on `consent_records.user_id`.** Deleting an account must not silently
delete the evidence that the person agreed to the terms. Account deletion anonymises the
profile and leaves the consent record standing, and the user is told so at the time of the
request.

## What running against real Supabase changed

The migrations were verified against local Postgres first and passed. Applying them to an
actual Supabase project surfaced two problems that local testing could not have found,
because the local environment was _more_ restrictive than production.

**Supabase's default privileges grant `ALL` on every new table in `public` to `anon` and
`authenticated`.** The grant model treats privileges as the outer gate and deliberately
withholds a grant where an operation should be impossible — no DELETE on the audit log, no
UPDATE on consent records. Those omissions did nothing: the defaults had already granted
them. Row Level Security still denied the rows, so nothing leaked, but the outer gate stood
open and a single missing policy would have been all that separated a client from a
rewritten audit trail. Fixed in `0008_lock_down_grants.sql`, which revokes everything and
grants back an explicit allowlist, including for tables added in future.

**The same applies to functions, and that one was worse.** `create_firm` is `SECURITY
DEFINER`, and PostgREST publishes `public` functions at `/rest/v1/rpc/<name>`. It was
callable without signing in. Migration 0006 did `revoke all on function ... from public`,
which is not the same thing — `PUBLIC` is the implicit everyone-role, and the grant to
`anon` is a separate explicit one. The `auth.uid() is null` guard inside the function did
hold, so the behaviour looked right when tested through the error it returned; a test that
only observes the outcome cannot tell which layer caught it. Fixed in `0009_harden.sql`.

**The local shim now reproduces both defaults.** That is the durable fix. A test
environment more restrictive than production will pass on code that fails in production,
and will do it silently. The shim grants what Supabase grants, so the suite can prove the
lockdown works rather than assuming an absence of grants means an absence of access.

## Accepted linter findings

Supabase's database linter reports warnings of one class, all intentional: **SECURITY
DEFINER functions callable by `authenticated`.**

| Function                | Why it is definer-rights                                                                             | What contains it                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `create_firm`           | The caller has no rights on `firms`; the firm and its first owner must be created in one transaction | Takes no user identifier — it can only create a firm owned by the caller         |
| `create_deal`           | Same shape — the deal, its first conversation, and its membership rows in one transaction            | Membership is written for the caller; the caller cannot name somebody else       |
| `list_my_sessions`      | `auth.sessions` is not exposed through PostgREST                                                     | Filtered on `auth.uid()`; takes no user identifier                               |
| `revoke_session`        | Same                                                                                                 | `user_id = auth.uid()` predicate on the delete makes the caller-supplied id safe |
| `revoke_other_sessions` | Same                                                                                                 | Filtered on `auth.uid()`; keeps the current session                              |
| `withdraw_message`      | The SELECT policy makes a client-side soft delete impossible (see above)                             | Re-checks sender identity and live membership                                    |
| `match_summary`         | Reads every buyer's scores, which no user may read                                                   | `app.controls_listing()` inside the body; returns counts, never identities       |
| `matched_buyers`        | Joins buyer profiles and criteria across rows the seller cannot select                               | `app.controls_listing()` inside the body; excludes buyers who opted out          |
| `platform_stats`        | Counts rows across tables no one user can see                                                        | `app.is_platform_admin()` inside the body; returns "how many", never "which"     |
| `verification_queue`    | Joins `user_roles`, which is restricted to the caller's own rows                                     | `app.is_platform_admin()` inside the body                                        |

The pattern is what the linter flags, not a defect. Every one of these exists _because_ the
caller lacks direct rights, and each either takes no user identifier or re-checks ownership
inside. None is granted to `anon` — verified, not assumed.

### One ERROR-level finding, also accepted

`public.listing_status_timeline` is reported as a **Security Definer View**. It is one, and
deliberately: it exists precisely to show rows the caller's own policy withholds.

The reasoning is above, under "A column RLS could not hide". The status history table now
admits only the listing's controllers and platform admins, because it carries a reviewer's
note written for the seller. But a buyer browsing a live listing has a legitimate interest
in its timeline — a business going under LOI is market information. A definer view with the
three access grounds in its `where` clause serves that, and has no `reason` column to leak.

The alternatives were both worse. Widening the policy again reinstates the leak, since RLS
cannot withhold one column from a reader who can see the row. Column-level `GRANT` can, but
it applies per role and not per row, so it would hide the reason from the seller too — the
one person it was written for.

Verified against the live project rather than assumed: a signed-in stranger reads 0 rows
from `listing_status_history` and sees only the discoverable listing's transitions through
the view.

Leaked-password protection is now enabled, so it no longer appears in the linter output.

## Deal room messaging

Authorisation is computed from one fact: is this user an **active** member of this
conversation. Everything else derives from it — reading a deal, listing its conversations,
subscribing to its realtime channel, downloading its attachments.

Verified by 34 tests in `supabase/tests/messaging-rls.test.ts`:

| Guarantee                                             | Mechanism                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| A buyer cannot read another deal's messages           | `app.is_active_conversation_member()` in the SELECT policy                       |
| A member cannot send as somebody else                 | `sender_id = auth.uid()` in the INSERT policy                                    |
| A message cannot be reattributed, moved, or backdated | `app.freeze_message_immutables()` trigger comparing OLD to NEW                   |
| A removed member loses access immediately             | Every helper filters `removed_at is null`                                        |
| A buyer cannot widen the room                         | Membership writes require `banker` or `admin`                                    |
| A withdrawn message's body never leaves the database  | `deleted_at is null` in the SELECT policy                                        |
| Audit entries cannot be forged or removed             | Written by triggers; no INSERT/UPDATE/DELETE grant for clients                   |
| Realtime is not a second path to content              | Private channel authorized by the same membership rule; payload carries ids only |
| Attachments have no permanent URL                     | Private bucket; signed URLs expire in 60 seconds                                 |

### Why deletion needs a function

`withdraw_message()` exists because of a Postgres behaviour worth stating plainly: **when a
table has SELECT policies, an UPDATE also checks the new row against them.** The SELECT
policy requires `deleted_at is null`, so any UPDATE setting `deleted_at` produces a row the
author could no longer see, and Postgres rejects it.

So a strict SELECT policy and client-side soft delete cannot coexist. Keeping the strict
policy is the better trade — it is what makes "a withdrawn body never leaves the database"
true over every path rather than only the ones the application remembers to filter. The
function re-checks sender identity and live membership, so routing around the policy does
not mean routing around the rule.

### Three role axes

`platform_role` (many per user) · `firm_role` (one per firm) · `conversation_role` (one per
conversation). They answer different questions, and `banker` exists only on the third — it
is a seat at a table, not a platform identity.

## The NDA gate

The most consequential boundary in the product. A seller's business being identifiable
before they chose to disclose it can cost them staff, customers, and the sale itself.

It exists twice, deliberately: `canViewFullListing()` in `packages/core` and
`listing_details_select_nda` in Postgres. Neither is sufficient alone — a route that
forgets the application check still meets the policy — and a parity test drives every NDA
state through real Postgres and asserts the two answer identically.

Verified by 72 tests in `supabase/tests/listings-rls.test.ts`:

| Guarantee                                                       | Mechanism                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| The full profile is unreachable without a signed, in-force NDA  | `app.has_executed_nda()` — status, revocation and expiry all checked |
| One buyer's NDA does not open another buyer's door              | `buyer_id = auth.uid()` inside the helper                            |
| A signature on one listing is not a signature on all            | `listing_id` matched inside the helper                               |
| Withdrawing a listing closes access already granted             | The gate also requires `app.listing_is_discoverable()`               |
| A buyer cannot sign their own NDA                               | INSERT policy admits only `requested`; the trigger requires `sent`   |
| A seller cannot sign on the buyer's behalf                      | `app.enforce_nda_transition()` — only `is_buyer` may reach `signed`  |
| A buyer cannot extend their own access                          | The trigger rejects `expires_at` changes from anyone but the seller  |
| An NDA cannot be moved to another listing after signature       | `listing_id`/`buyer_id` frozen in the trigger                        |
| Signature timestamps cannot be forged by a client               | Trigger overwrites `sent_at`/`signed_at`/`revoked_at` from OLD       |
| A signed NDA cannot be walked back to an earlier state          | Explicit regression check in the trigger                             |
| Financials are not a second path to the same disclosure         | Separate table, same gate predicate                                  |
| Platform admins have no ambient access to any confidential half | No admin branch in `listing_details_select_nda`                      |

### The lifecycle is enforced, not suggested

`app.enforce_listing_status_transition()` validates every move and logs it. `closed` and
`withdrawn` are terminal. The same map exists in TypeScript as `LISTING_TRANSITIONS`, and a
test drives all 49 ordered pairs through the real trigger to assert they agree — so the UI
cannot render a button the database will refuse.

The trigger also does three things a policy cannot, because a policy sees only the new row:

- **Ownership is frozen.** The UPDATE policy's `WITH CHECK` calls `controls_listing()`,
  which reads the _committed_ row — so it evaluates the old owner and would let a seller
  hand their listing to somebody else. The trigger is what actually stops that.
- **Firm attribution is proven.** Attaching a listing to a firm grants every broker there
  control of it, so a caller-supplied id is checked against membership, on insert and on
  update.
- **Moderation is narrow.** Admins can change a listing's status to take it down. The
  trigger compares the whole row and rejects any admin update that touches another column,
  so "moderation" cannot quietly become "rewriting a seller's copy".

### One widening, stated plainly

`profiles_select_nda_counterparty` lets a seller read the profile of a buyer who has an
active NDA request on their listing. Without it the seller's queue shows an anonymous
request, and a seller who cannot tell a search fund from a competitor will approve
everything or nothing — both of which defeat the gate.

It is one-directional. The buyer is revealed to the seller; the seller is not revealed to
the buyer. That asymmetry is the product.

## Matching: accurate scores without disclosure

The matcher has a problem the rest of the product does not. A score is only worth showing
if it is right, and a right score needs the seller's exact revenue, earnings and customer
concentration — the NDA-gated half. The buyer being scored has signed nothing.

Resolved by computing against the real figures **server-side** and storing only a redacted
explanation. `redactFitResult()` in `packages/core` strips every figure before anything is
written, with two overlapping defences: reasons built from confidential numbers are
replaced wholesale, and whatever survives is scrubbed of digits anyway. The second exists
because the first depends on recognising which reasons leak, and that judgement will
eventually be wrong.

A test sweeps 2,520 input combinations and asserts no digit appears in any output a buyer
can read. A new reason added to the scoring model that quotes a figure fails the build
without anyone having to remember the redaction exists.

Verified by 38 tests in `supabase/tests/matching-rls.test.ts`:

| Guarantee                                               | Mechanism                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| A buyer sees only their own scores                      | `match_scores_select_own` on `auth.uid()`                       |
| No client can write a score                             | SELECT-only grant; the matcher uses the service role            |
| A buyer cannot delete an unflattering score             | No DELETE policy or grant                                       |
| A seller cannot read the raw score table                | Reaches buyers through `matched_buyers()`, which checks consent |
| A buyer who opted out is invisible to sellers           | `is_discoverable` joined inside the definer function            |
| A definer function cannot be pointed at another listing | `app.controls_listing()` checked inside the function body       |

### Identity is disclosed; the business is not

0018 corrected an over-anonymisation. Sellers are named on their listings, and buyers are
named to the sellers they match or petition — because a seller shown "identity withheld"
cannot judge whether to release their financials, and will approve everyone or no one.
Neither disclosure reveals what is for sale.

### The third instance of one bug

`buyer_profiles_select_counterparty` originally subqueried `match_scores` inline. **A
policy's subqueries are themselves subject to RLS**, and `match_scores_select_own` hides
those rows from the seller — so the policy denied everything while reading as correct. This
codebase has now hit that exact shape three times (messaging, listings, matching). The fix
each time is a `SECURITY DEFINER` helper with a pinned `search_path`; here,
`app.is_my_counterparty()`.

**If a policy queries a table other than the one it protects, check whether the caller can
read that table.** Usually they cannot.

## What leaves the platform

`apps/web/src/lib/ai/router.ts` is the only module that talks to a model provider. No
feature calls one directly, so "what did we send to whom" is answerable from one file.

**Confidential listing data never reaches a provider.** The deterministic matcher reads the
seller's exact figures because it runs inside our own Postgres; sending them to a
third-party API is a disclosure to a subprocessor the seller never agreed to, and no
retention setting undoes it. The model gets the anonymised teaser and the buyer's own
thesis text.

That is enforced by types rather than by care: `ThesisMatchInput` has no field for a legal
name, an address, or an exact figure, and `ScoredListing` keeps `profile` (never leaves the
process) and `teaser` (publishable) as separate fields. Passing the wrong one requires
changing a type first.

Buyer thesis text is fenced and labelled as data in the prompt. It is user-supplied and
reaches a model; treating it as instructions is how prompt injection works.

## No agent sends anything on its own

Outreach is personalised automatically and sent only after a person approves it. The
`outreach_drafts` trigger makes that an invariant of the data:

- rows are created as `draft`; any other starting state is refused;
- `sent` requires `approved_by` and `approved_at`, both stamped from `auth.uid()` rather
  than accepted from the caller;
- editing an approved draft withdraws the approval, so "approve something bland then
  rewrite it" does not work;
- a sent message cannot be unsent or edited.

## The service role

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely. Legitimate uses are narrow:

- Writing audit entries
- Granting the `admin` platform role during operator provisioning
- Scheduled jobs with no user context

`createServiceRoleClient()` is in a module marked `server-only`, so importing it from a
Client Component is a build error rather than a runtime leak. Reaching for it to make a
query work removes the database's independent check on a query the application layer may
already have got wrong — which is exactly the query where the second check earns its keep.

## Admin is not a superuser

Platform admins hold operational capabilities — verification, listing review, templates,
audit — and deliberately **not** `deal_room:access`, `document:download`, or
`listing:view_full`.

An internal operator moderating listings should not thereby be able to read the
confidential financials of a business they are not party to. Where admins genuinely need
document access, such as a fraud investigation, that should be a separate, individually
audited elevation rather than an ambient permission.

Migration 0022 is where that stopped being a comment, because every admin screen has an
easy version that violates it.

| Power           | How it is bounded                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification    | `enforce_profile_verification()` copies the new row, normalises `verification_status` / `verified_at` / `updated_at`, and rejects the update if anything else moved. `verified_at` is stamped by the database, not accepted. An account holder cannot verify themselves. |
| Listing review  | Inherited from 0016 — a non-controller may touch the status column and nothing else, checked by whole-row comparison.                                                                                                                                                    |
| Review queue    | `listing_review_queue` is `security_invoker`. Completeness comes from two guarded definer helpers returning a boolean and a count, never a value from the row.                                                                                                           |
| Platform counts | `platform_stats()` answers "how many", never "which", and is guarded by `app.is_platform_admin()` inside the body because definer rights ignore RLS.                                                                                                                     |
| Status changes  | `change_listing_status()` is **invoker**-rights. It adds a place to record why, not a way to move a listing you could not otherwise move.                                                                                                                                |
| Audit log       | Readable by admins; no UPDATE or DELETE policy and no grant to back one, for anybody. A log an administrator can rewrite still looks like evidence.                                                                                                                      |

Two tests assert the negative case directly: an admin selecting `listing_details` and
`listing_financials` gets zero rows.

### A column RLS could not hide

Populating `listing_status_history.reason` created a leak that had been latent since 0016:
the select policy admitted anybody who could see a discoverable listing, on the reasoning
that the reason text was seller-side only. That held while nothing wrote to it. RLS filters
rows, not columns, so once a reviewer's note landed there, a buyer could have read it
straight through PostgREST.

The policy now narrows to the listing's controllers and admins, and the market reads
`listing_status_timeline` — a view that has no `reason` column to leak. Worth naming the
general shape: **a comment explaining why a column is safe is not a control.** If a column
must be hidden from a reader who can see the row, it needs its own table or its own view.

## The document vault

Verified by 32 tests in `supabase/tests/document-vault.test.ts`, all built around one
scenario: a seller with two bidders in the same deal room.

| Guarantee                                                       | Mechanism                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Membership of the room does not open a restricted document      | `app.can_read_document()` requires an explicit grant on top of deal access  |
| One bidder cannot see what the other was released               | `document_grants_select` admits the controller and the grantee, nobody else |
| A buyer cannot re-release a seller's document                   | `app.controls_document()` on the grant write policy                         |
| A grant to somebody outside the room admits nothing             | Deal access is required in **every** branch, not only the grant branch      |
| Removing somebody from the room closes their documents          | Same — the grant survives, the access does not                              |
| A document cannot be repointed at another file after release    | `app.freeze_document_immutables()`, whole-row comparison                    |
| Withdrawal is one-way                                           | Same trigger; `withdrawn_at` is stamped, never accepted                     |
| The access log cannot be written, edited or deleted by a client | No insert/update/delete policy or grant; entries use the service role       |
| The bucket has no permanent URL                                 | `public = false`; reads are 60-second signed URLs minted per request        |
| A malformed object path denies rather than raises               | `app.can_read_document_path()` catches the cast                             |

Two of those deserve the reasoning, because the obvious implementation gets them wrong.

**Repointing.** Without the freeze trigger, "set permissions" and "change the file this
row points at" are the same grant. A party could release something harmless, wait for it
to be reviewed, then swap the object — and the audit log would show a release of the
reviewed document and a download of something else.

**The path segment.** Object keys are `<deal_id>/<document_id>/<file_name>` and the
storage policy checks the **second** segment. A file name containing a slash moves the
boundary, so `../../other-deal/x.pdf` would produce a key whose second segment names a
document the uploader has nothing to do with — and the policy would faithfully check that
one. `safeFileName()` in `packages/core` is what keeps the segment where it is, and a test
asserts the key always has exactly three parts with the document id in the middle.

### What the access log claims

That a signed URL was issued to this person for this document at this time. Not that a
file was read, and not where it went afterwards — no server can observe that, and the page
says so rather than implying a chain of custody it does not have. Withdrawing access says
the same thing in the confirmation: _anything already downloaded stays downloaded._

## Known gaps

Honest list of what is not yet done. Tracked in `docs/roadmap.md`.

- **Rate limiting is in-process.** `apps/web/src/lib/rate-limit.ts` defines the interface
  and ships a fixed-window implementation held in memory. On serverless that is a speed
  bump, not a limit — each region and cold start gets its own counter. The seam is built so
  swapping in Redis or Upstash is one implementation; every call site already routes through
  it. Treat the current limits as protection against a stuck client, not an attacker.
- **Step-up auth protects the accounts that opted into MFA, and reports on the rest.**
  Applied to confidential document downloads and to fee-schedule changes — the two places
  where a stolen session, rather than a stolen password, is the threat. `stepUpIfPossible()`
  challenges any account that has a second factor. An account with none has nothing to step
  up to, so the action proceeds and an audit entry records that it happened without one;
  blocking there would mean "download this document, or first go and enrol in MFA", which
  reads as a security feature and functions as a wall in front of the product on the day
  somebody is closing a deal. The real fix is requiring MFA for the roles that touch a data
  room, which is an operator policy — and the count of
  `document.downloaded_without_second_factor` entries is the number that argument gets made
  on. `requireStepUp()` still blocks unconditionally and is right for removing a factor,
  where an account with none has nothing to remove.
- **Content Security Policy — written, and shipping report-only.** The origins are known
  now: exactly one, Supabase, because every model call goes through the server-side router
  and the browser never touches a provider. `apps/web/src/lib/security/csp.ts` builds a
  nonce-based policy and `src/middleware.ts` mints the nonce per request, which is the only
  layer that runs before Next renders. Scripts get a nonce and `'strict-dynamic'` rather
  than `'unsafe-inline'`; styles still allow inline, which is a smaller and deliberate
  concession — Next and Tailwind both emit inline style attributes, there is no nonce
  plumbing for them, and injected CSS is a far weaker primitive than injected script.

  It goes out as `Content-Security-Policy-Report-Only` until `CSP_ENFORCE=true`. A CSP
  that breaks production is a worse outage than no CSP is a vulnerability, and report-only
  says so in the header name — which is not the failure the original note warned about. A
  permissive _enforcing_ policy claims a protection it does not provide; this one claims
  nothing yet. The rollout is on the launch checklist: deploy, walk the app, read the
  violations, flip the flag.
