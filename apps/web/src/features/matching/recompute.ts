import 'server-only';

import {
  INDUSTRY_PROFILES,
  formatBand,
  redactFitResult,
  scoreFit,
  scoreSellerFit,
  type AcquisitionCriteria,
  type BuyerKind,
  type BuyerSnapshot,
  type IndustryKey,
  type ListingProfile,
  type SellerPreferences,
  worthNotifying,
} from '@ib/core';

import { isAiConfigured } from '@/lib/ai/router';
import { scoreThesisMatch, type ThesisMatchInput } from '@/lib/ai/thesis-match';
import { notifyCollapsed } from '@/lib/notify/notify';
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
  /**
   * Everything the *seller's* half of the match needs.
   *
   * Null when the buyer has not filled in a profile. The seller-fit score is
   * then left off rather than computed from defaults — a made-up 60% is worse
   * than an honest blank, because a seller would act on it.
   */
  snapshot: BuyerSnapshot | null;
}

function toCriteria(row: Row, profile?: Row, roles: string[] = []): BuyerCriteria {
  return {
    buyerId: row.user_id,
    criteriaId: row.id,
    snapshot: profile ? toSnapshot(row, profile, roles) : null,
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
 * The buyer, as the seller's half of the match sees them.
 *
 * `kind` is derived from the buyer's platform roles rather than asked again —
 * somebody who signed up as a family office should not have to restate it — and
 * falls back to `individual`, which is what a plain `buyer` role means.
 */
function toSnapshot(criteria: Row, profile: Row, roles: string[]): BuyerSnapshot {
  const kind: BuyerKind = roles.includes('private_equity')
    ? 'private_equity'
    : roles.includes('family_office')
      ? 'family_office'
      : roles.includes('search_fund')
        ? 'search_fund'
        : 'individual';

  return {
    kind,
    fundingSource: fundingFromLabel(profile.funding_source as string | null),
    involvement: (criteria.involvement ?? 'either') as BuyerSnapshot['involvement'],
    // Not collected on the criteria row yet. `six_months` is the middle of the
    // range rather than an optimistic guess, and it is the one field here the
    // seller-fit score treats as soft.
    timeline: 'six_months',
    priorAcquisitions: profile.prior_acquisitions ?? undefined,
  };
}

/**
 * Maps the stored funding label back to the enum the scorer takes.
 *
 * The label is stored for display, so this is a reverse lookup rather than a
 * second source of truth. Anything unrecognised is `undecided`, which is the
 * conservative answer — a seller should not be told a buyer is paying cash
 * because a string failed to match.
 */
function fundingFromLabel(label: string | null): BuyerSnapshot['fundingSource'] {
  if (!label) return 'undecided';

  const normalised = label.toLowerCase();
  if (normalised.includes('cash')) return 'cash';
  if (normalised.includes('sba')) return 'sba';
  if (normalised.includes('bank')) return 'conventional';
  if (normalised.includes('fund')) return 'fund';
  if (normalised.includes('seller')) return 'seller';
  return 'undecided';
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
  id, status, seller_id, industry, jurisdiction_code, deal_structure, owner_dependence,
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

/**
 * The seller's half of the match.
 *
 * Empty when the seller has stated no preferences or the buyer has no profile.
 * A score computed from defaults would look like a finding and is a guess, and
 * a seller would act on it.
 */
function sellerFitColumns(buyer: BuyerCriteria, preferences: SellerPreferences | null) {
  if (!preferences || !buyer.snapshot) return {};

  const result = scoreSellerFit(preferences, buyer.snapshot);

  return {
    seller_fit_score: result.score,
    seller_fit_reasons: result.reasons,
    seller_frictions: result.frictions,
  };
}

/** Scores one listing against one buyer and shapes the row to be written. */
async function scoreRow(
  listing: ScoredListing,
  buyer: BuyerCriteria,
  preferences: SellerPreferences | null,
) {
  const result = redactFitResult(scoreFit(buyer.criteria, listing.profile));
  const ai = await aiColumns(listing, buyer);

  return {
    ...ai,
    ...sellerFitColumns(buyer, preferences),
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

  // The seller's half of the match. Loaded once for the whole batch, since
  // every buyer here is being scored against the same seller.
  const preferences = await loadSellerPreferences(service, (listing as Row).seller_id);
  const buyerIds = criteria.map((row) => (row as Row).user_id as string);
  const [profiles, roles] = await Promise.all([
    loadBuyerProfiles(service, buyerIds),
    loadRoles(service, buyerIds),
  ]);

  const rows = await mapWithLimit(criteria, (row) => {
    const userId = (row as Row).user_id as string;
    return scoreRow(
      scored,
      toCriteria(row as Row, profiles.get(userId), roles.get(userId) ?? []),
      preferences,
    );
  });

  // Read before write, because "new" is a comparison and the upsert destroys
  // the left-hand side of it.
  const previous = await loadPreviousScores(service, listingId);

  const { error } = await service
    .from('match_scores')
    .upsert(rows, { onConflict: 'listing_id,buyer_id' });

  if (error) return 0;

  await announceNewMatches(rows, previous);

  return rows.length;
}

/**
 * Buyers who already had a strong match on this listing.
 *
 * The set, not the scores. Everything this module returns is a count or
 * nothing; a map of buyer to score would be the first crack in that.
 */
async function loadPreviousScores(service: ServiceClient, listingId: string): Promise<Set<string>> {
  const { data } = await service
    .from('match_scores')
    .select('buyer_id, score, excluded')
    .eq('listing_id', listingId);

  return new Set(
    ((data ?? []) as Row[])
      .filter((row) => worthNotifying(Number(row.score), Boolean(row.excluded)))
      .map((row) => row.buyer_id as string),
  );
}

/**
 * Tells buyers a business worth their attention came on the market.
 *
 * Two conditions, and the second is the one that makes this bearable. The score
 * has to clear the bar the match card draws in green — and the buyer must not
 * have already been above that bar on this listing. A seller can press
 * "rescore" ten times in an afternoon; without the comparison, so would this.
 *
 * Nothing about the business travels. The count is the only variable the copy
 * accepts, and it is `1` here: this is one listing, and a buyer is being told
 * about one listing.
 */
async function announceNewMatches(
  rows: readonly Row[],
  previouslyStrong: ReadonlySet<string>,
): Promise<void> {
  const newlyStrong = rows
    .filter((row) => worthNotifying(Number(row.score), Boolean(row.excluded)))
    .map((row) => row.buyer_id as string)
    .filter((buyerId) => !previouslyStrong.has(buyerId));

  if (newlyStrong.length === 0) return;

  // Not `entityId: listingId`. A notification carrying the listing id would
  // link a buyer straight to a listing they may not be able to open, and the
  // id itself is a fact about which business matched them. `/matches` shows
  // them exactly what they are entitled to see.
  await notifyCollapsed(newlyStrong, { kind: 'new_match' });
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

  const [profiles, roles] = await Promise.all([
    loadBuyerProfiles(service, [buyerId]),
    loadRoles(service, [buyerId]),
  ]);

  const buyer = toCriteria(criteriaRow as Row, profiles.get(buyerId), roles.get(buyerId) ?? []);

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

  // Each listing has a different seller, so preferences are looked up per
  // listing rather than once. Fetched in one query and indexed, not N queries.
  const sellerIds = [...new Set(listings.map((l) => (l as Row).seller_id as string))];
  const preferencesBySeller = await loadSellerPreferencesFor(service, sellerIds);
  const sellerByListing = new Map<string, string>(
    listings.map((l) => [(l as Row).id as string, (l as Row).seller_id as string]),
  );

  const rows = await mapWithLimit(scorable, (scored) =>
    scoreRow(
      scored,
      buyer,
      preferencesBySeller.get(sellerByListing.get(scored.listingId) ?? '') ?? null,
    ),
  );

  if (rows.length === 0) return 0;

  const { error } = await service
    .from('match_scores')
    .upsert(rows, { onConflict: 'listing_id,buyer_id' });

  return error ? 0 : rows.length;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

function toPreferences(row: Row): SellerPreferences {
  return {
    acceptableBuyerTypes: (row.acceptable_buyer_types ?? []) as BuyerKind[],
    employeePriority: row.employee_priority ?? 3,
    legacyPriority: row.legacy_priority ?? 3,
    transition: row.transition ?? 'months',
    sellerFinancing: row.seller_financing ?? 'open',
    timeline: row.timeline ?? 'six_months',
  };
}

async function loadSellerPreferences(
  service: ServiceClient,
  sellerId: string,
): Promise<SellerPreferences | null> {
  const { data } = await service
    .from('seller_preferences')
    .select('*')
    .eq('user_id', sellerId)
    .maybeSingle();

  return data ? toPreferences(data as Row) : null;
}

async function loadSellerPreferencesFor(
  service: ServiceClient,
  sellerIds: string[],
): Promise<Map<string, SellerPreferences>> {
  if (sellerIds.length === 0) return new Map();

  const { data } = await service.from('seller_preferences').select('*').in('user_id', sellerIds);

  return new Map(((data ?? []) as Row[]).map((row) => [row.user_id as string, toPreferences(row)]));
}

async function loadBuyerProfiles(
  service: ServiceClient,
  buyerIds: string[],
): Promise<Map<string, Row>> {
  if (buyerIds.length === 0) return new Map();

  const { data } = await service
    .from('buyer_profiles')
    .select('user_id, funding_source, prior_acquisitions')
    .in('user_id', buyerIds);

  return new Map(((data ?? []) as Row[]).map((row) => [row.user_id as string, row]));
}

/** Platform roles per buyer, used to derive what kind of buyer they are. */
async function loadRoles(
  service: ServiceClient,
  buyerIds: string[],
): Promise<Map<string, string[]>> {
  if (buyerIds.length === 0) return new Map();

  const { data } = await service.from('user_roles').select('user_id, role').in('user_id', buyerIds);

  const byUser = new Map<string, string[]>();
  for (const row of (data ?? []) as Row[]) {
    const list = byUser.get(row.user_id as string) ?? [];
    list.push(row.role as string);
    byUser.set(row.user_id as string, list);
  }
  return byUser;
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
