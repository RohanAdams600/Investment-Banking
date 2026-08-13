import 'server-only';

import {
  INDUSTRY_PROFILES,
  formatBand,
  redactFitResult,
  scoreFit,
  type AcquisitionCriteria,
  type IndustryKey,
  type ListingProfile,
} from '@ib/core';

import { isAiConfigured } from '@/lib/ai/router';
import { scoreThesisMatch, type ThesisMatchInput } from '@/lib/ai/thesis-match';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The matcher.
 *
 * **This is the only module in the application that reads confidential listing
 * data on behalf of somebody who has not signed an NDA, and it is deliberate.**
 *
 * A score is only worth showing if it is right, and a right score needs the
 * seller's exact revenue, earnings and customer concentration. Scoring against
 * the published bands instead would produce a number that looks precise and is
 * not. So the matcher runs with the service role, reads the real figures, and
 * writes back **only** the score and a redacted explanation — every figure
 * stripped by `redactFitResult()` before it touches the database.
 *
 * The rules that keep that defensible:
 *
 *   - Nothing in this module returns confidential data to its caller. Every
 *     exported function returns a count or nothing at all. There is no path
 *     from an HTTP request to a figure read here.
 *   - The service-role client is created inside the functions and never
 *     escapes them.
 *   - `match_scores` has no insert or update grant for any client role, so this
 *     is the only writer, and a bug that reached a user's connection would fail
 *     rather than write.
 *
 * If a future change makes one of these return listing detail, the NDA gate has
 * been routed around and the redaction is decoration.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Statuses at which a listing is on the market and worth matching. */
const MARKET_STATUSES = ['live', 'under_loi', 'under_contract'];

interface ScoredListing {
  listingId: string;
  profile: ListingProfile;
  /**
   * The anonymised half, kept separately from `profile`.
   *
   * `profile` holds the seller's real figures and never leaves this process.
   * `teaser` is what may be sent to a model. Two fields rather than one so the
   * distinction is visible at every call site instead of remembered.
   */
  teaser: Omit<ThesisMatchInput, 'thesis'>;
}

interface BuyerCriteria {
  buyerId: string;
  criteriaId: string;
  criteria: AcquisitionCriteria;
}

function toCriteria(row: Row): BuyerCriteria {
  return {
    buyerId: row.user_id,
    criteriaId: row.id,
    criteria: {
      industries: (row.industries ?? []) as IndustryKey[],
      jurisdictions: (row.jurisdictions ?? []) as string[],
      revenueMin: row.revenue_min_cents ?? undefined,
      revenueMax: row.revenue_max_cents ?? undefined,
      earningsMin: row.earnings_min_cents ?? undefined,
      earningsMax: row.earnings_max_cents ?? undefined,
      dealSizeMax: row.deal_size_max_cents ?? undefined,
      dealStructure: row.deal_structure,
      involvement: row.involvement,
      maxCustomerConcentration:
        row.max_customer_concentration === null
          ? undefined
          : Number(row.max_customer_concentration),
      minRecurringRevenueShare:
        row.min_recurring_revenue_share === null
          ? undefined
          : Number(row.min_recurring_revenue_share),
      thesis: row.thesis ?? undefined,
    },
  };
}

/**
 * Builds the scoring input from a listing and its confidential profile.
 *
 * Returns null when the seller has not filled in the figures yet. Scoring a
 * listing with zero revenue would rank it last everywhere and tell the seller
 * nothing about why — better to leave it unscored until there is something to
 * score, and say so on their dashboard.
 */
function toProfile(listing: Row, details: Row | undefined): ScoredListing | null {
  if (!details) return null;
  if (details.revenue_cents === null || details.earnings_cents === null) return null;

  const jurisdiction = Array.isArray(listing.jurisdictions)
    ? listing.jurisdictions[0]
    : listing.jurisdictions;

  return {
    listingId: listing.id,
    profile: {
      industry: listing.industry as IndustryKey,
      jurisdiction: listing.jurisdiction_code,
      revenue: Number(details.revenue_cents),
      earnings: Number(details.earnings_cents),
      askingPrice:
        details.asking_price_cents === null ? undefined : Number(details.asking_price_cents),
      dealStructure: listing.deal_structure,
      customerConcentration:
        details.customer_concentration === null
          ? undefined
          : Number(details.customer_concentration),
      recurringRevenueShare:
        details.recurring_revenue_share === null
          ? undefined
          : Number(details.recurring_revenue_share),
      ownerDependence: listing.owner_dependence ?? undefined,
    },
    // Published fields only. Everything here is already readable by any
    // signed-in buyer, which is the bar for sending it to a model.
    teaser: {
      headline: listing.headline,
      summary: listing.summary ?? null,
      industryLabel:
        INDUSTRY_PROFILES[listing.industry as IndustryKey]?.label ?? (listing.industry as string),
      location: jurisdiction?.name ?? null,
      earningsBand: formatBand(
        {
          lowCents: listing.earnings_band_low_cents ?? null,
          highCents: listing.earnings_band_high_cents ?? null,
        },
        '',
      ),
      employeeCount: listing.employee_count ?? null,
      yearsInBusiness: listing.years_in_business ?? null,
      growthTrend: listing.growth_trend ?? null,
      ownerDependence: listing.owner_dependence ?? null,
    },
  };
}

/**
 * The columns the teaser is built from. Kept next to `toProfile` so adding a
 * field to one without the other is obvious.
 */
const LISTING_COLUMNS = `
  id, status, industry, jurisdiction_code, deal_structure, owner_dependence,
  headline, summary, employee_count, years_in_business, growth_trend,
  earnings_band_low_cents, earnings_band_high_cents,
  jurisdictions ( name )
`;

/**
 * Asks the model how well the listing answers what the buyer wrote.
 *
 * Returns empty columns whenever there is no key, no thesis, or no usable
 * answer. The deterministic score stands on its own; this only ever adds.
 */
async function aiColumns(listing: ScoredListing, buyer: BuyerCriteria) {
  const thesis = buyer.criteria.thesis?.trim();
  if (!thesis || !isAiConfigured()) return {};

  const result = await scoreThesisMatch({ ...listing.teaser, thesis });
  if (!result) return {};

  return {
    ai_score: result.score,
    ai_rationale: result.rationale,
    ai_model: result.model,
    ai_computed_at: new Date().toISOString(),
  };
}

/** Scores one listing against one buyer and shapes the row to be written. */
async function scoreRow(listing: ScoredListing, buyer: BuyerCriteria) {
  const result = redactFitResult(scoreFit(buyer.criteria, listing.profile));
  const ai = await aiColumns(listing, buyer);

  return {
    ...ai,
    listing_id: listing.listingId,
    buyer_id: buyer.buyerId,
    criteria_id: buyer.criteriaId,
    score: result.score,
    excluded: result.excluded,
    // Redacted above, not here. Writing `scoreFit(...)` directly into this
    // object is the mistake this comment exists to prevent — the raw reasons
    // quote the seller's figures.
    reasons: result.allReasons,
    exclusion_reasons: result.exclusionReasons,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Rescores every active buyer against one listing.
 *
 * Called when a listing goes on the market or its figures change. Returns how
 * many buyers were scored — a number, never the scores.
 */
export async function recomputeMatchesForListing(listingId: string): Promise<number> {
  const service = createServiceRoleClient();

  const { data: listing } = await service
    .from('listings')
    .select(LISTING_COLUMNS)
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return 0;

  // A listing that has left the market keeps no scores. Otherwise a withdrawn
  // business goes on appearing in buyers' match lists, which is both wrong and
  // a slow disclosure that it was ever listed.
  if (!MARKET_STATUSES.includes((listing as Row).status)) {
    await service.from('match_scores').delete().eq('listing_id', listingId);
    return 0;
  }

  const { data: details } = await service
    .from('listing_details')
    .select(
      'revenue_cents, earnings_cents, asking_price_cents, customer_concentration, recurring_revenue_share',
    )
    .eq('listing_id', listingId)
    .maybeSingle();

  const scored = toProfile(listing as Row, (details ?? undefined) as Row | undefined);
  if (!scored) return 0;

  const { data: criteria } = await service
    .from('acquisition_criteria')
    .select('*')
    .is('superseded_at', null);

  if (!criteria || criteria.length === 0) return 0;

  const rows = await mapWithLimit(criteria, (row) => scoreRow(scored, toCriteria(row as Row)));

  const { error } = await service
    .from('match_scores')
    .upsert(rows, { onConflict: 'listing_id,buyer_id' });

  return error ? 0 : rows.length;
}

/**
 * Rescores one buyer against every listing on the market.
 *
 * Called when a buyer saves their criteria. Their previous scores are cleared
 * first, so a listing that no longer matches disappears rather than lingering
 * with a stale number attached to superseded criteria.
 */
export async function recomputeMatchesForBuyer(buyerId: string): Promise<number> {
  const service = createServiceRoleClient();

  const { data: criteriaRow } = await service
    .from('acquisition_criteria')
    .select('*')
    .eq('user_id', buyerId)
    .is('superseded_at', null)
    .maybeSingle();

  await service.from('match_scores').delete().eq('buyer_id', buyerId);

  if (!criteriaRow) return 0;
  const buyer = toCriteria(criteriaRow as Row);

  const { data: listings } = await service
    .from('listings')
    .select(LISTING_COLUMNS)
    .in('status', MARKET_STATUSES);

  if (!listings || listings.length === 0) return 0;

  const { data: allDetails } = await service
    .from('listing_details')
    .select(
      'listing_id, revenue_cents, earnings_cents, asking_price_cents, customer_concentration, recurring_revenue_share',
    )
    .in(
      'listing_id',
      listings.map((l) => (l as Row).id),
    );

  const detailsByListing = new Map<string, Row>(
    (allDetails ?? []).map((d) => [(d as Row).listing_id as string, d as Row]),
  );

  const scorable = listings
    .map((listing) => toProfile(listing as Row, detailsByListing.get((listing as Row).id)))
    .filter((scored): scored is ScoredListing => scored !== null);

  const rows = await mapWithLimit(scorable, (scored) => scoreRow(scored, buyer));

  if (rows.length === 0) return 0;

  const { error } = await service
    .from('match_scores')
    .upsert(rows, { onConflict: 'listing_id,buyer_id' });

  return error ? 0 : rows.length;
}

/**
 * Runs an async mapper over a list, a few at a time.
 *
 * Each `scoreRow` may make an API call, so mapping a hundred buyers with
 * `Promise.all` would open a hundred connections at once and collect a rate
 * limit for the trouble. Six is slow enough to be polite and fast enough that a
 * seller clicking "rescore" does not sit waiting.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit = 6,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(fn))));
  }

  return results;
}
