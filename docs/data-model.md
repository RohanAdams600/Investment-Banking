# Data model

**Status: not implemented. Build step 2, now unblocked.**

Tenancy is decided: **multi-tenant**. Firms are the primary data boundary, so nearly every
table below carries a tenant column and every RLS policy is tenant-scoped. Jurisdiction is
decided: **US multi-state**, so consent records capture jurisdiction and template version
at the time of acceptance.

This is the entity inventory drawn from the specification. Column-level design and the ERD
land with the migrations.

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

| Entity                   | Notes                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listings`               | Core record. Industry (NAICS/SIC), geography, revenue, EBITDA, asking price, deal type, employee count, real estate, years in business, growth trend. |
| `listing_visibility`     | Two tiers: **teaser** (anonymized, public) and **full profile** (NDA-gated). The gate is enforced at the API and RLS layers, never only in the UI.    |
| `listing_status_history` | Draft → Pending Review → Live → Under LOI → Under Contract → Closed/Withdrawn. **Every transition logged** with actor and timestamp.                  |
| `listing_media`          | Gallery with ordering, alt text, cover selection.                                                                                                     |
| `listing_financials`     | Revenue/EBITDA by year, add-backs, SDE. Integer cents.                                                                                                |

## Matching

| Entity                 | Notes                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `acquisition_criteria` | Shared by search fund, PE, and family office portals. Feeds the matching agent.                                                    |
| `preference_profiles`  | **Versioned.** Implicit (browse/save/skip) plus explicit criteria. Versioning is what makes a change in recommendations traceable. |
| `match_scores`         | 0–100, with the contributing factors stored — not just the score, or the "why this match" explanation cannot be reconstructed.     |
| `saved_searches`       | With change alerts.                                                                                                                |
| `watchlists`           | Saved listings with status-change notifications.                                                                                   |

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
