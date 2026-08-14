import 'server-only';

import {
  INDUSTRY_KEYS,
  estimateValuation,
  summariseReadiness,
  valueAllMethods,
  type IndustryKey,
  type ListingSnapshot,
  type ReadinessSummary,
} from '@ib/core';

import { recordBlocked, runStep } from '@/lib/ai/orchestrator';
import { createServiceRoleClient } from '@/lib/supabase/server';

import { recomputeMatchesForListing } from '@/features/matching/recompute';

/**
 * The four-step pipeline, end to end.
 *
 * Step 1 analyses what the seller submitted, step 2 values it, step 3 finds
 * buyers, step 4 drafts an approach for a human to approve. Steps 1–3 run here;
 * step 4 is deliberately not automatic, and the reason is in the note at the
 * bottom of this file.
 *
 * ## Sequencing is the point
 *
 * The steps are not independent. Matching against a listing with no financial
 * years produces scores computed from nothing, which is worse than no scores —
 * a buyer shown a 40% match on a business with no numbers has been told
 * something false with a decimal point on it. So a blocked step records *why*
 * it did not run rather than running badly, and the seller sees the reason on
 * their own listing.
 *
 * ## Confidential data does not leave this process
 *
 * Everything here runs with the service role and reads the NDA-gated half. What
 * gets written back is the analysis (which goes to the seller, who owns the
 * data), the valuation (same), and — through `recomputeMatchesForListing` — a
 * redacted score. No model is called with any of it. The only AI in the whole
 * pipeline is the thesis matcher, which sees the anonymised teaser and the
 * buyer's own words, and that boundary is enforced by the shape of
 * `ThesisMatchInput` rather than by care.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface PipelineResult {
  readiness: ReadinessSummary | null;
  valued: boolean;
  matchCount: number | null;
  /** Set when the pipeline stopped early, in words the seller can act on. */
  blockedBy: string | null;
}

/**
 * Reads everything the pipeline needs, once.
 *
 * Assembled here rather than re-queried per step, because three steps reading
 * the same listing three times is three chances for them to disagree about what
 * they were looking at — and the run record would then describe a state that
 * never existed as a whole.
 */
async function loadSnapshot(listingId: string): Promise<{
  snapshot: ListingSnapshot;
  sellerId: string;
  firmId: string | null;
  status: string;
} | null> {
  const service = createServiceRoleClient();

  const { data: listing } = await service
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return null;
  const row = listing as Row;

  const [{ data: details }, { data: financials }] = await Promise.all([
    service.from('listing_details').select('*').eq('listing_id', listingId).maybeSingle(),
    service
      .from('listing_financials')
      .select('fiscal_year, revenue_cents, ebitda_cents, sde_cents')
      .eq('listing_id', listingId)
      .order('fiscal_year', { ascending: false }),
  ]);

  const detail = (details ?? null) as Row | null;
  const years = (financials ?? []) as Row[];
  const latest = years[0] ?? null;

  // "Recent" is measured against the fiscal year rather than a filing date,
  // because a seller entering FY2024 in mid-2026 has stale numbers however
  // recently they typed them in.
  const currentYear = new Date().getFullYear();
  const financialsAreRecent = latest ? currentYear - Number(latest.fiscal_year) <= 1 : false;

  return {
    sellerId: row.seller_id,
    firmId: row.firm_id ?? null,
    status: row.status,
    snapshot: {
      headline: row.headline ?? null,
      industry: row.industry ?? null,
      jurisdictionCode: row.jurisdiction_code ?? null,
      askingPriceCents: row.asking_price_cents === null ? null : Number(row.asking_price_cents),
      hasProfile: detail !== null,
      legalName: detail?.legal_name ?? null,
      revenueCents:
        detail?.revenue_cents != null
          ? Number(detail.revenue_cents)
          : latest?.revenue_cents != null
            ? Number(latest.revenue_cents)
            : null,
      sdeCents:
        detail?.sde_cents != null
          ? Number(detail.sde_cents)
          : latest?.sde_cents != null
            ? Number(latest.sde_cents)
            : null,
      ebitdaCents:
        detail?.ebitda_cents != null
          ? Number(detail.ebitda_cents)
          : latest?.ebitda_cents != null
            ? Number(latest.ebitda_cents)
            : null,
      customerConcentration:
        detail?.customer_concentration == null ? null : Number(detail.customer_concentration),
      ownerDependence: row.owner_dependence == null ? null : Number(row.owner_dependence),
      employeeCount: row.employee_count == null ? null : Number(row.employee_count),
      yearsInBusiness: row.years_in_business == null ? null : Number(row.years_in_business),
      financialYears: years.length,
      financialsAreRecent,
    },
  };
}

/**
 * Runs steps one to three for a listing.
 *
 * Safe to call repeatedly: each call produces a fresh set of runs rather than
 * mutating the last ones, which is what keeps "what did it say last week"
 * answerable.
 */
export async function runListingPipeline(listingId: string): Promise<PipelineResult> {
  const loaded = await loadSnapshot(listingId);

  if (!loaded) {
    return { readiness: null, valued: false, matchCount: null, blockedBy: 'That listing is gone.' };
  }

  const { snapshot, sellerId, firmId } = loaded;
  const base = { listingId, subjectUserId: sellerId, firmId };

  // --- step 1: analyse -----------------------------------------------------

  const analysis = await runStep<ReadinessSummary>(
    { ...base, kind: 'analyse_listing' },
    async () => {
      const summary = summariseReadiness(snapshot);

      return {
        value: summary,
        // Findings carry their own evidence strings, which are derived from the
        // confidential figures — "largest customer is 60% of revenue". That is
        // fine here and only here: this output is shown to the seller, whose
        // data it is, and `agent_runs` is readable only by them and whoever
        // controls the listing.
        output: {
          findings: summary.findings,
          blocking: summary.blocking,
          important: summary.important,
          notes: summary.notes,
          readyForReview: summary.readyForReview,
        },
      };
    },
  );

  const readiness = analysis.value;

  // --- step 2: value -------------------------------------------------------

  let valued = false;

  if (snapshot.financialYears === 0) {
    await recordBlocked(
      { ...base, kind: 'value_listing' },
      'No financial years have been entered, so there is nothing to value.',
    );
  } else {
    const valuation = await runStep(
      {
        ...base,
        kind: 'value_listing',
        // What was read, not what it said.
        inputs: {
          financialYears: snapshot.financialYears,
          basis: snapshot.sdeCents !== null ? 'sde' : 'ebitda',
          industry: snapshot.industry,
        },
      },
      async () => {
        const earnings = snapshot.sdeCents ?? snapshot.ebitdaCents;
        if (earnings === null) {
          throw new Error('No earnings figure on record, so no multiple can be applied.');
        }

        const industry = asIndustry(snapshot.industry);
        if (industry === undefined) {
          throw new Error('The listing has no industry the model has a profile for.');
        }
        if (snapshot.revenueCents === null) {
          throw new Error('No revenue figure on record.');
        }

        const methods = valueAllMethods({
          industry,
          revenue: snapshot.revenueCents,
          sde: snapshot.sdeCents ?? undefined,
          ebitda: snapshot.ebitdaCents ?? undefined,
          customerConcentration: snapshot.customerConcentration ?? undefined,
          yearsInBusiness: snapshot.yearsInBusiness ?? undefined,
          employeeCount: snapshot.employeeCount ?? undefined,
          ownerDependence: ownerDependenceBand(snapshot.ownerDependence),
        });

        return {
          value: methods,
          output: {
            methods: methods.methods.map((method) => ({
              key: method.key,
              label: method.label,
              rangeLow: method.range?.low ?? null,
              rangeHigh: method.range?.high ?? null,
              rationale: method.rationale,
              weight: method.weight,
            })),
            overallLow: methods.overall?.low ?? null,
            overallHigh: methods.overall?.high ?? null,
            methodsDisagree: methods.methodsDisagree,
            missingInputs: methods.missingInputs,
            // Never "we recommend listing at". The estimate informs the
            // seller's decision and does not constrain it — they may market at
            // any price they choose, and a platform that implied otherwise
            // would be substituting its judgement for theirs on the sale of
            // their own business.
            disclaimer:
              'An estimate for discussion, not a valuation, an appraisal, or advice. You may list at any price you choose.',
          },
        };
      },
    );

    valued = valuation.ok;
  }

  // --- step 3: match -------------------------------------------------------

  let matchCount: number | null = null;
  let blockedBy: string | null = null;

  const blocker = readiness?.findings.find((finding) => finding.severity === 'blocking');

  if (blocker) {
    // Matching against a listing with no numbers produces scores computed from
    // nothing — worse than no scores, because a buyer shown 40% has been told
    // something false with a decimal point on it.
    blockedBy = blocker.title;
    await recordBlocked({ ...base, kind: 'match_buyers' }, `${blocker.title}. ${blocker.action}`);
  } else {
    const matching = await runStep<number>(
      { ...base, kind: 'match_buyers', inputs: { source: 'listing_pipeline' } },
      async () => {
        const scored = await recomputeMatchesForListing(listingId);
        return {
          value: scored,
          // A count and nothing else. Which buyers matched is in `match_scores`,
          // behind the policy written for it — copying it here would put a
          // seller's view of named buyers in a second place with different
          // rules.
          output: { buyersScored: scored },
        };
      },
    );

    matchCount = matching.value;
    if (!matching.ok) blockedBy = matching.reason;
  }

  /*
   * There is no step four here, and its absence is the feature.
   *
   * Drafting outreach is built (`composeOutreach`, `outreach_drafts`), and a
   * seller triggers it per buyer from their own queue. Running it as part of an
   * automatic pipeline would generate a message to every matched buyer the
   * moment a listing was submitted — which is one accidental click away from
   * exactly the autonomous outbound the specification forbids, even with the
   * approval trigger catching the send.
   *
   * The database refuses a `draft_outreach` run that claims success for the
   * same reason. Two mechanisms, because this is the one that gets somebody
   * sued.
   */

  return { readiness, valued, matchCount, blockedBy };
}

/**
 * A listing's industry as the valuation model's own union, or undefined.
 *
 * The column is text and the model takes a key. Narrowing here rather than
 * casting means an industry the model has no profile for falls back to the
 * generic multiple instead of producing a confident number from a lookup miss.
 */
/**
 * The 1–5 self-rating the listing carries, as the three bands the model uses.
 *
 * Two scales for one idea, and this is the seam between them. The listing form
 * asks for a number because people answer a 1–5 more honestly than they pick
 * "critical"; the model wants a band because a multiple adjustment per point
 * would imply a precision the rating does not have.
 */
function ownerDependenceBand(
  rating: number | null,
): 'absentee' | 'moderate' | 'critical' | undefined {
  if (rating === null) return undefined;
  if (rating <= 2) return 'absentee';
  if (rating >= 4) return 'critical';
  return 'moderate';
}

function asIndustry(value: string | null): IndustryKey | undefined {
  return value !== null && (INDUSTRY_KEYS as string[]).includes(value)
    ? (value as IndustryKey)
    : undefined;
}

/** The estimate on its own, for the seller's valuation panel. */
export function quickEstimate(snapshot: ListingSnapshot) {
  const earnings = snapshot.sdeCents ?? snapshot.ebitdaCents;
  const industry = asIndustry(snapshot.industry);
  if (earnings === null || industry === undefined) return null;

  try {
    return estimateValuation({
      industry,
      revenue: snapshot.revenueCents ?? earnings,
      sde: snapshot.sdeCents ?? undefined,
      ebitda: snapshot.ebitdaCents ?? undefined,
    });
  } catch {
    // A business at or below break-even. The multi-method view still says
    // something useful, and that is what the panel falls back to.
    return null;
  }
}
