# Data model

Sections marked **Built** describe tables that exist; the rest is the entity inventory
drawn from the specification, and lands with its build step. The migrations in
`supabase/migrations` are the authority — where this document and a migration disagree,
the migration is right and this document is a bug.

Tenancy is decided: **multi-tenant**. Firms are the primary data boundary, so nearly every
table below carries a tenant column and every RLS policy is tenant-scoped. Jurisdiction is
decided: **US multi-state**, so consent records capture jurisdiction and template version
at the time of acceptance.

| Area                  | State                                                   |
| --------------------- | ------------------------------------------------------- |
| Identity and access   | **Built** — 0001–0010                                   |
| Listings              | **Built** — 0015, 0016. Media gallery not built         |
| Deal room / messaging | **Partly built** — 0011–0014. Document vault not built  |
| Matching              | **Built** — 0013, 0017, 0018                            |
| Compliance            | **Partly built** — awaiting attorney-reviewed templates |
| Onboarding            | **Built** — 0019                                        |
| Commission            | Not built                                               |

## Identity and access

| Entity         | Notes                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `users`        | Auth identity. **No role column** — see below.                                                    |
| `user_roles`   | Join table. A broker who also buys is one account with two roles.                                 |
| `firms`        | PE funds, family offices, brokerages. **First-class tenants** — the primary data boundary.        |
| `firm_members` | User↔firm with a per-firm role. A user may belong to several firms with a different role in each. |
| `sessions`     | Device list, remote sign-out, configurable length.                                                |
| `mfa_factors`  | TOTP minimum; SMS OTP optional.                                                                   |

The single most consequential choice here is that **roles are a join table, not an enum on
`users`**. The specification calls for it, and it is the difference between a broker who
also buys having one account or two.

## Listings

**Built** — migrations 0015 and 0016.

| Entity                   | Notes                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `listings`               | The anonymised **teaser**. Industry, state, size **bands**, deal structure, employee count, years in business, growth trend, owner dependence. |
| `listing_details`        | The **full profile**, NDA-gated. Legal name, address, exact figures, customer concentration, key customers, risks.                             |
| `listing_financials`     | Revenue/EBITDA/SDE by year, add-backs. Integer cents. Behind the same gate. Earnings may be negative; revenue may not.                         |
| `listing_ndas`           | One per buyer per listing. This row **is** the gate. Captures template id and version at signature, plus signer IP and user agent.             |
| `listing_status_history` | Draft → Pending Review → Live → Under LOI → Under Contract → Closed/Withdrawn. Every transition logged with actor and timestamp, by trigger.   |
| `listing_saves`          | Watchlist. Private to the user — a seller is never told who saved their listing.                                                               |
| `listing_media`          | **Not built.** Gallery with ordering, alt text, cover selection.                                                                               |

### Why the teaser and the profile are two tables

Not normalisation. **Row Level Security is row-level, not column-level.** A single
`listings` table cannot show a browsing buyer the industry and revenue band while hiding
the company name — column privileges exist but are static per role, not per row, so they
cannot express "this buyer, on this listing, has signed". The only way to make the
confidential half genuinely unreachable is to put it in its own row, in its own table,
behind its own policy.

That constraint shapes the API types too: `ListingTeaser` and `ListingFullProfile` are
separate TypeScript types rather than one type with optional fields, so a component that
renders a public list cannot be handed a full profile without the compiler objecting.

### The gate

`listing_details_select_nda` admits a reader when **either**:

- `app.controls_listing()` — they are the seller or a broker at the managing firm; or
- the listing is discoverable **and** `app.has_executed_nda()`.

Four conditions inside that helper are all load-bearing: the NDA belongs to this listing
and this caller, its status is `signed`, `revoked_at` is null, and `expires_at` has not
passed. A gate that checked only the status word would keep a lapsed agreement open.

The listing must still be discoverable, so a signed NDA on a listing since **withdrawn**
does not reopen it — pulling a business off the market closes the door behind it.

Platform admins are deliberately excluded from `listing_details`. Reviewing a headline
does not require the seller's customer concentration.

Which means a reviewer cannot see whether a seller filled the profile in at all, and they
genuinely need that before publishing to the market. `app.listing_has_profile()` and
`app.listing_financial_years()` (0022) answer it as a boolean and a count, guarded inside
their own bodies — completeness without contents. The `listing_review_queue` view is built
on those rather than on an inline `exists`, which under `security_invoker` would have
correctly returned false to the only person meant to read it.

### The reviewer's reason, and where it may not go

`listing_status_history.reason` records why a listing moved — mostly, why a reviewer sent
one back to draft. Written through `change_listing_status()`, which passes it on a
transaction-local setting to the trigger that writes the history row, so the table stays
append-only with no UPDATE grant.

RLS is row-level. Since 0016 admitted anybody who can see a discoverable listing to its
status history, populating that column would have published the reviewer's note to the
market — "readable row, unreadable column" is not something a policy can express. So the
policy narrowed to the seller and admins, and everyone else reads
`listing_status_timeline`, a view with no `reason` column in it. Same split as the teaser
and the profile, one table down.

### Bands, not figures

The teaser carries `revenue_band_low/high_cents`, not `revenue_cents`. Industry plus state
plus an exact revenue figure identifies most lower-middle-market businesses on its own.
`deriveBand()` in `packages/core` rounds an exact figure **outwards** onto fixed steps for
this reason: a band that brackets the true number too tightly is itself a disclosure.

## Matching

**Built** — migrations 0017 and 0018.

| Entity                 | Notes                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `acquisition_criteria` | Versioned (superseded, not updated). `is_discoverable` is the buyer's consent to be shown to sellers.                                  |
| `match_scores`         | 0–100 with the contributing factors stored, **redacted**. Plus `ai_score`/`ai_rationale`, kept in separate columns.                    |
| `buyer_profiles`       | Who the buyer is: entity, funding source, capital band, prior deals. What a seller uses to decide whether to release their financials. |
| `outreach_drafts`      | Personalised automatically, sent only after a person approves. Trigger refuses `sent` without an approver.                             |
| `listing_saves`        | Watchlist. Built in 0015.                                                                                                              |
| `saved_searches`       | **Not built.** With change alerts.                                                                                                     |
| `preference_profiles`  | **Not built.** Implicit signal (browse/save/skip) on top of explicit criteria.                                                         |

### Scores are stored, not computed on read

Three reasons, in order of how much they matter:

1. **The scoring inputs are confidential.** A good score needs the seller's exact revenue,
   earnings and customer concentration — the NDA-gated half. Computing at read time would
   mean a buyer's own request reads data they are not entitled to. Computing ahead of time,
   server-side, and storing only the redacted result keeps those figures off any path the
   buyer can reach.
2. **A changed ranking has to be explainable.** `criteria_id` records which version of the
   buyer's criteria produced the score, so "why did this drop off my list" has an answer.
3. Speed, which is the least interesting reason and the one usually given.

`match_scores` has **no insert or update grant for any client role**. The matcher writes it
with the service role; a client that could write here would promote itself to the top of
every seller's list.

### Identity: the business is confidential, the people are not

0018 corrected an over-anonymisation in 0015–0016.

- **Sellers are named.** `profiles_select_listing_representative` lets any signed-in buyer
  read the profile of whoever represents a live listing, and
  `firms_select_listing_representative` does the same for the brokerage. Buyers need
  somebody to call.
- **Buyers are named to their counterparties.** `app.is_my_counterparty()` admits a seller
  to a buyer's profile on two grounds: the buyer requested access to a listing they control,
  or the buyer matched one and left `is_discoverable` on.
- **Neither reveals the business.** Knowing Sam Reyes is selling _a_ home-services company
  in New York is not knowing which one.

`app.is_my_counterparty()` is `SECURITY DEFINER` for a reason worth remembering: a policy's
subqueries are themselves subject to RLS, and `match_scores_select_own` hides those rows
from the seller. Written inline, the policy denied everything while looking correct.

## Onboarding

**Built** — migration 0019.

| Entity                    | Notes                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `questionnaire_responses` | Scratch. A half-finished questionnaire, resumable across devices. Not authoritative — the mapped tables are.      |
| `seller_preferences`      | What the seller wants from a buyer: acceptable kinds, staff and legacy priorities, transition, financing, timing. |

### Two tables, two jobs

`questionnaire_responses` holds answers in progress as `jsonb`, because the shape
varies by question type and a column per question would need a migration every time
the wording changes. It is scratch: on completion the answers are mapped into
`acquisition_criteria`, `buyer_profiles` and `seller_preferences`, and those are what
the product reads. Keeping them separate means rewording a question never silently
changes what matching runs on.

`seller_preferences` is the new idea. Every marketplace models what a buyer wants;
almost none model what a seller wants beyond price. It makes matching two-sided —
`match_scores.seller_fit_score` is the mirror of `match_scores.score`.

Buyers see a seller's preferences only after signing an NDA. Before that they are
negotiating positions: a buyer who knows on day one that the seller is desperate to
retire has an advantage the seller never meant to give.

## Deal room

| Entity                 | Notes                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `deal_rooms`           | Per listing/buyer pairing.                                                                |
| `documents`            | Stored separately from general app data, stricter policies.                               |
| `document_versions`    | Re-upload creates a version. **Nothing is overwritten.**                                  |
| `document_permissions` | Per-document, per-user. View-only vs download, with bulk presets.                         |
| `ndas`                 | Template per listing, status per buyer, gates full-profile access.                        |
| `nda_signatures`       | Signer, timestamp, template version.                                                      |
| `audit_log`            | **Immutable.** Every view, download, permission change, upload. Exportable per deal room. |

## CRM and messaging

| Entity                         | Notes                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `contacts`                     | One contact, many relationships — buyer on deal A, seller-side broker on deal B. |
| `leads`                        | Unified across listing inquiry, contact form, manual. Deduped on email/phone.    |
| `pipeline_stages`              | Configurable per user/firm.                                                      |
| `notes` · `tasks` · `meetings` | Threaded notes; assignable dated tasks; calendar entries.                        |
| `conversations` · `messages`   | Threaded per deal/listing. Read receipts.                                        |
| `notification_preferences`     | Granular per channel and per category. Respected everywhere.                     |

## Commission and transactions

| Entity                  | Notes                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `commission_structures` | Flat %, flat fee, Lehman, double-Lehman. Platform default, overridable per listing/broker.                   |
| `commission_records`    | Computed amount **plus the formula and inputs used** — a number with no visible derivation is not auditable. |
| `transactions`          | **Immutable ledger.** Integer cents. Exportable.                                                             |

`paid` is a record-keeping flag in v1. No payment processing. The amount and status columns
are the seam a processor plugs into later.

## Compliance

| Entity                  | Notes                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `jurisdictions`         | State/country config driving disclosures and feature availability.                                                            |
| `legal_templates`       | NDA, broker agreement, terms, privacy policy. **Versioned**, admin-editable, never hard-coded strings.                        |
| `consent_records`       | What was consented to, when, **which jurisdiction, and which template version**. None of this is backfillable after the fact. |
| `data_subject_requests` | Export and deletion requests, with documented retention exceptions.                                                           |

## Retention

Account deletion does not delete records with a legitimate retention need — signed NDAs,
transaction and commission records, audit logs. This has to be **disclosed to the user at
the time of the request**, not buried in the privacy policy. The schema needs to
distinguish "user-deleted" from "retained for legal obligation" rather than treating
deletion as a single flag.
