# Open decisions

Business decisions, not engineering ones. Each records what is blocked, the options, and a
recommendation — but the call belongs to the founder.

---

## 1. Company name — RESOLVED

**Decision: Ashlar.** Tagline "The marketplace for buying and selling businesses."
Working legal entity name "Ashlar Markets, Inc." pending incorporation.

The name was Cairn until a preliminary screen found the field crowded — see
`docs/brand/naming.md` for what was found and what it does not cover.

Wired into `.env.example` and the defaults in `packages/core/src/brand`. Nothing else in
the codebase hard-codes it.

**Still outstanding, and these are yours to run:**

- `.com` availability and acquisition cost
- **Trademark clearance by an attorney.** A preliminary screen has been run and is
  recorded in `docs/brand/naming.md`. It is not a clearance opinion and does not cover
  state registrations, common-law use, or a likelihood-of-confusion analysis.
- Incorporation, which settles `BRAND_LEGAL_NAME` and `BRAND_MAILING_ADDRESS`

Until the support email and mailing address are real, `unconfiguredBrandFields` reports
them and the app shows a warning badge. Those two appear in the site footer and in
commercial email, where a placeholder is a wrong disclosure rather than an untidy one.

Full shortlist and rationale retained in `docs/brand/naming.md`.

---

## 2. Multi-tenancy — RESOLVED

**Decision: multi-tenant from the start.** Firms are the primary data boundary; users can
belong to multiple firms with different roles in each. Nearly every table carries a tenant
column and RLS policies are tenant-scoped.

The reasoning is preserved below because it is the rationale a future maintainer will want
when the cost of this shows up in a migration.

---

Does a firm — a PE fund, a family office, a brokerage — exist as a first-class tenant with
data isolation, or is firm membership an attribute of a user?

**Single-tenant with firm attribution.** Users belong to an optional `firm_id`. Simpler
schema, simpler policies, faster to build.

**Multi-tenant.** Firms are the primary boundary. Nearly every table carries a tenant
column; RLS policies are tenant-scoped; users can belong to multiple firms with different
roles in each.

**Recommendation (accepted): multi-tenant from the start**, despite the added cost.

The specification already describes firm-level PE accounts with multiple associated users,
broker commission splits across a brokerage, and family offices with elevated privacy
defaults. Those are tenant behaviors. Retrofitting tenancy after listings, deal rooms, and
audit logs exist means a migration across every table plus a rewrite of every RLS policy —
against production data that includes signed NDAs and commission records that cannot be
casually rebuilt.

The counter-argument is real: if the first hundred users are individual buyers and sellers
with no firm affiliation, multi-tenancy is complexity earning nothing for a year. Worth
weighing against who is actually in the launch cohort.

---

## 3. Jurisdiction scope — RESOLVED

**Decision: US multi-state.** The jurisdiction-config layer is built in step 2 even though
only one state may ship first. Consent records capture the jurisdiction and the disclosure
template version at the time of acceptance.

Still needed before step 11 (compliance templates), and this one is for counsel rather than
engineering: **the platform's own regulatory posture** — whether it acts as a broker, a
listing service, or neither, in each launch state. That answer determines what the software
is obliged to record, and it is cheaper to know before the disclosure templates are written
than after.

---

Which states or countries at launch, and are disclosures modeled per-jurisdiction from day
one?

The compliance layer is designed to be jurisdiction-configurable rather than hard-coded.
The question is how much of that layer to build now.

**Recommendation (accepted): build the jurisdiction-config layer in step 2 even if only
one state ships.** Consent records are retained for their legal life and are not reconstructable
after the fact — a consent row that does not record which jurisdiction's disclosure
version was accepted cannot have that recovered later. The table columns are cheap now and
impossible to backfill.

**Needed:** launch states, and whether broker licensing disclosures apply to the platform
itself in any of them. That second question is one for counsel, not for engineering — the
platform's own regulatory posture (whether it acts as a broker, a listing service, or
neither) shapes what the software has to record.

---

## 4. AI model routing — blocks step 8, not urgent

Which model serves which agent. The model-router abstraction means this is configuration,
so it can be deferred without blocking architecture.

Starting position, to be tuned on real cost and latency:

| Agent                                     | Model shape                        | Reasoning                                                          |
| ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Seller, Buyer, Deal Assistant             | Mid-tier Claude                    | Conversational, latency-sensitive, high volume                     |
| Valuation, Market Research, Due Diligence | Frontier Claude                    | Highest reasoning quality; user-visible consequences               |
| Outreach, CRM, Meeting                    | Mid-tier Claude                    | Drafting; a human reviews every output                             |
| Document extraction                       | Frontier Claude, batched           | Accuracy matters more than latency; verification UI catches errors |
| Matching (embeddings)                     | Cheapest competent embedding model | High volume, embeddings are commodity                              |
| Analytics                                 | Mid-tier Claude                    | Summarizing structured data                                        |

**Needed eventually:** a monthly AI budget ceiling, so the router has a target to optimize
against.

---

## 5. Transactional email provider — blocks step 7

Resend, Postmark, or SES. One, standardized.

**Recommendation: Resend** for developer experience and React-based templates, unless
volume projections make SES's pricing decisive. Postmark has the best deliverability
reputation for transactional mail and is the safer choice if NDA and deal notifications
landing in spam is considered a serious risk — which, on this product, it might be.

---

## 6. Hosting region and data residency — blocks step 2

Supabase projects are region-pinned at creation and moving one means a migration.

**Needed:** primary region, and whether any launch jurisdiction imposes a data residency
requirement. US-only launch makes this straightforward; any EU exposure changes it.

---

## 7. Payment processor — deferred by design

Out of scope for v1. Commission and transaction records model amounts and status so a
processor can be added against a clean seam. Stripe Connect is the stated intent.

No decision needed now. Recorded so the seam is not accidentally closed.

---

## 8. E-signature provider — blocks step 6 partially

The signing flow and UX are built in-house in step 6. The cryptographic backend is a
Phase 2 swap behind a provider interface.

**Needed before step 6 completes:** whether NDAs executed through the in-house flow during
the interim period are intended to be legally enforceable. If yes, that changes what step 6
has to capture — signer authentication, intent, and a tamper-evident audit trail — and is a
question for counsel rather than an engineering choice.
