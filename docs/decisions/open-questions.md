# Open decisions

Business decisions, not engineering ones. Each records what is blocked, the options, and a
recommendation — but the call belongs to the founder.

---

## 1. Company name — blocks step 3

Ten candidates with rationale, taglines, and collision risk: `docs/brand/naming.md`.
Recommendation there is **Cairn**, with **Thesis** as the alternative and **Provenance** as
the fallback.

**Blocks:** the marketing site, the logo, the domain purchase, the legal entity.
**Does not block:** everything else. The name is one environment variable.

**Needed:** a name, plus a `.com` and trademark check on it.

---

## 2. Multi-tenancy — blocks step 2

Does a firm — a PE fund, a family office, a brokerage — exist as a first-class tenant with
data isolation, or is firm membership an attribute of a user?

**Single-tenant with firm attribution.** Users belong to an optional `firm_id`. Simpler
schema, simpler policies, faster to build.

**Multi-tenant.** Firms are the primary boundary. Nearly every table carries a tenant
column; RLS policies are tenant-scoped; users can belong to multiple firms with different
roles in each.

**Recommendation: multi-tenant from the start**, despite the added cost.

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

## 3. Jurisdiction scope — blocks step 2

Which states or countries at launch, and are disclosures modeled per-jurisdiction from day
one?

The compliance layer is designed to be jurisdiction-configurable rather than hard-coded.
The question is how much of that layer to build now.

**Recommendation: build the jurisdiction-config layer in step 2 even if only one state
ships.** Consent records are retained for their legal life and are not reconstructable
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
