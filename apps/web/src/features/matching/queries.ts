import 'server-only';

import { capped, overFetch, type Capped, type FitReason } from '@ib/core';

import { createClient } from '@/lib/supabase/server';
import type { ListingTeaser } from '@/features/listings/types';
import type {
  ListingRepresentative,
  MatchedBuyer,
  MatchedListing,
  MatchSummary,
  OutreachDraft,
} from './types';

/**
 * Reads for the matching feature.
 *
 * All through the user's client, so RLS applies. A buyer sees their own scores
 * and nobody else's — `match_scores_select_own` is keyed on `auth.uid()`.
 *
 * The seller's side goes through two definer functions, both of which check
 * `controls_listing()` internally rather than trusting the caller:
 * `match_summary()` for the headline counts, and `matched_buyers()` for the
 * buyers themselves, by name.
 *
 * Naming them is deliberate and was a correction. The business stays anonymous
 * until an NDA is signed; the people do not. A seller who cannot see who
 * matched cannot decide who to approach, and a seller shown "identity withheld"
 * on an access request cannot judge whether to release their financials at all.
 * Buyers appear only if they left `is_discoverable` on.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const TEASER_COLUMNS = `
  id, status, headline, summary, industry, jurisdiction_code,
  revenue_band_low_cents, revenue_band_high_cents,
  earnings_band_low_cents, earnings_band_high_cents,
  asking_price_band_low_cents, asking_price_band_high_cents,
  deal_structure, employee_count, years_in_business, growth_trend,
  real_estate_included, owner_dependence, reason_for_sale,
  published_at, created_at,
  jurisdictions ( name )
`;

function toTeaser(row: Row, saved: boolean): ListingTeaser {
  const jurisdiction = Array.isArray(row.jurisdictions) ? row.jurisdictions[0] : row.jurisdictions;

  return {
    id: row.id,
    status: row.status,
    headline: row.headline,
    summary: row.summary ?? null,
    industry: row.industry,
    jurisdictionCode: row.jurisdiction_code,
    jurisdictionName: jurisdiction?.name ?? null,
    revenueBand: {
      lowCents: row.revenue_band_low_cents ?? null,
      highCents: row.revenue_band_high_cents ?? null,
    },
    earningsBand: {
      lowCents: row.earnings_band_low_cents ?? null,
      highCents: row.earnings_band_high_cents ?? null,
    },
    askingBand: {
      lowCents: row.asking_price_band_low_cents ?? null,
      highCents: row.asking_price_band_high_cents ?? null,
    },
    dealStructure: row.deal_structure,
    employeeCount: row.employee_count ?? null,
    yearsInBusiness: row.years_in_business ?? null,
    growthTrend: row.growth_trend ?? null,
    realEstateIncluded: Boolean(row.real_estate_included),
    ownerDependence: row.owner_dependence ?? null,
    reasonForSale: row.reason_for_sale ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    saved,
  };
}

/**
 * The buyer's ranked feed.
 *
 * Excluded matches are fetched separately rather than filtered out here, so a
 * buyer staring at an empty list can be shown that their own limits produced it
 * — "nothing matches" and "your concentration limit ruled out eleven of these"
 * lead to very different next actions.
 */
export const MATCHES_PAGE_SIZE = 100;

export async function listMatches(includeExcluded = false): Promise<Capped<MatchedListing>> {
  const supabase = await createClient();

  let query = supabase
    .from('match_scores')
    .select(
      `score, excluded, reasons, exclusion_reasons, computed_at, ai_score, ai_rationale, listings ( ${TEASER_COLUMNS} )`,
    )
    .order('score', { ascending: false })
    .limit(overFetch(MATCHES_PAGE_SIZE));

  if (!includeExcluded) query = query.eq('excluded', false);

  const { data, error } = await query;
  if (error || !data) return capped<MatchedListing>([], MATCHES_PAGE_SIZE);

  const page = capped(data as Row[], MATCHES_PAGE_SIZE);

  const saved = await savedListingIds();

  const rows = page.rows
    .map((row) => {
      const r = row as Row;
      const listing = Array.isArray(r.listings) ? r.listings[0] : r.listings;
      // The join goes through the listings SELECT policy as well, so a listing
      // that has left the market yields null here even if a stale score exists.
      if (!listing) return null;

      return {
        teaser: toTeaser(listing as Row, saved.has((listing as Row).id)),
        score: r.score,
        excluded: Boolean(r.excluded),
        reasons: (r.reasons ?? []) as FitReason[],
        exclusionReasons: (r.exclusion_reasons ?? []) as string[],
        computedAt: r.computed_at,
        aiScore: r.ai_score ?? null,
        aiRationale: r.ai_rationale ?? null,
      };
    })
    .filter((match): match is MatchedListing => match !== null);

  // `truncated` comes from the query, not from `rows.length`. The filter above
  // drops scores whose listing has left the market, so a full page can arrive
  // here shorter than the cap — and that is not the same fact.
  return { ...page, rows };
}

/** How many listings the buyer's own hard limits ruled out. */
export async function countExcludedMatches(): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from('match_scores')
    .select('id', { count: 'exact', head: true })
    .eq('excluded', true);

  return count ?? 0;
}

async function savedListingIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase.from('listing_saves').select('listing_id');
  return new Set((data ?? []).map((row) => (row as Row).listing_id as string));
}

/** Demand for one listing, as counts. The function refuses if you do not control it. */
export async function loadMatchSummary(listingId: string): Promise<MatchSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('match_summary', { target_listing_id: listingId });

  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
  if (error || !row) return { totalBuyers: 0, strongMatches: 0, bestScore: null };

  return {
    totalBuyers: row.total_buyers ?? 0,
    strongMatches: row.strong_matches ?? 0,
    bestScore: row.best_score ?? null,
  };
}

/**
 * The buyers who matched a listing, by name.
 *
 * This is what makes outreach possible, and it is the correction to the first
 * cut of this feature — a seller shown only a count cannot decide who to
 * contact, and a seller shown "identity withheld" on an access request cannot
 * decide whether to release their financials at all.
 *
 * Buyers who turned off `is_discoverable` are excluded by the function itself.
 */
export async function listMatchedBuyers(listingId: string): Promise<MatchedBuyer[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('matched_buyers', {
    target_listing_id: listingId,
  });

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    buyerId: row.buyer_id,
    fullName: row.full_name ?? null,
    entityName: row.entity_name ?? null,
    headline: row.headline ?? null,
    fundingSource: row.funding_source ?? null,
    priorAcquisitions: row.prior_acquisitions ?? null,
    capitalLowCents: row.capital_low_cents ?? null,
    capitalHighCents: row.capital_high_cents ?? null,
    score: row.score,
    aiScore: row.ai_score ?? null,
    aiRationale: row.ai_rationale ?? null,
    sellerFitScore: row.seller_fit_score ?? null,
    sellerFrictions: (row.seller_frictions ?? []) as string[],
    verificationStatus: row.verification_status ?? 'unverified',
    hasNda: Boolean(row.has_nda),
  }));
}

/**
 * Who is representing a listing.
 *
 * Every listing on a real brokerage names its broker — a buyer needs somebody
 * to call, and a deal offered by nobody in particular does not get taken
 * seriously. This discloses the person, not the business.
 */
export async function loadRepresentative(listingId: string): Promise<ListingRepresentative | null> {
  const supabase = await createClient();

  const { data: listing } = await supabase
    .from('listings')
    .select('seller_id, firm_id')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return null;
  const row = listing as Row;

  const [profile, firm] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, verification_status')
      .eq('id', row.seller_id)
      .maybeSingle(),
    row.firm_id
      ? supabase.from('firms').select('name').eq('id', row.firm_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!profile.data) return null;
  const p = profile.data as Row;

  return {
    userId: p.id,
    fullName: p.full_name ?? null,
    firmName: (firm.data as Row | null)?.name ?? null,
    verificationStatus: p.verification_status ?? 'unverified',
  };
}

/** The signed-in buyer's own profile, for editing. */
export async function loadMyBuyerProfile(): Promise<Row | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from('buyer_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return (data as Row) ?? null;
}

/** Outreach on a listing the caller controls. */
export async function listOutreachDrafts(listingId: string): Promise<OutreachDraft[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('outreach_drafts')
    .select(
      'id, recipient_id, channel, status, subject, body, match_score, approved_at, sent_at, created_at',
    )
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  // Names come through `profiles_select_nda_counterparty`, so a recipient with
  // no NDA on this listing stays anonymous. That is correct: outreach can go to
  // a matched buyer the seller has never been introduced to.
  const recipientIds = [...new Set(data.map((row) => (row as Row).recipient_id as string))];
  const names = new Map<string, string>();

  if (recipientIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', recipientIds);

    for (const profile of profiles ?? []) {
      const p = profile as Row;
      if (p.full_name) names.set(p.id as string, p.full_name as string);
    }
  }

  return data.map((row) => {
    const r = row as Row;
    return {
      id: r.id,
      recipientId: r.recipient_id,
      recipientName: names.get(r.recipient_id as string) ?? null,
      channel: r.channel,
      status: r.status,
      subject: r.subject ?? null,
      body: r.body,
      matchScore: r.match_score ?? null,
      approvedAt: r.approved_at ?? null,
      sentAt: r.sent_at ?? null,
      createdAt: r.created_at,
    };
  });
}
