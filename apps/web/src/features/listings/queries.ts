import 'server-only';

import {
  capped,
  controlsListing,
  overFetch,
  type Capped,
  type ListingStatus,
  type NdaStatus,
} from '@ib/core';

import { getActor } from '@/lib/auth/actor';
import { createClient } from '@/lib/supabase/server';
import type {
  BrowseFilters,
  JurisdictionOption,
  ListingDetailView,
  ListingFinancialYear,
  ListingFullProfile,
  ListingNda,
  ListingNdaRequest,
  ListingStatusEntry,
  ListingTeaser,
} from './types';

/**
 * Reads for the listings feature.
 *
 * Every query here goes through the *user's* client, never the service role.
 * That is the point: the NDA gate is a policy on `listing_details`, and a query
 * made with the service role would sail straight past it. If a full profile
 * comes back from `loadListing`, it is because Postgres decided the caller was
 * entitled to it — this module never makes that decision itself, and never
 * filters a profile out in JavaScript after fetching it.
 *
 * The one thing the application layer must not do here is "fetch it and hide
 * it". A profile that reaches the Node process has already left the database;
 * hiding it in the component is a rendering choice, not an access control, and
 * it leaks the moment somebody serialises props. So the query for the
 * confidential half is a separate request that either returns a row or does not.
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

function toTeaser(row: Row, saved = false): ListingTeaser {
  const jurisdiction = Array.isArray(row.jurisdictions) ? row.jurisdictions[0] : row.jurisdictions;

  return {
    id: row.id,
    status: row.status as ListingStatus,
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

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

/**
 * The market.
 *
 * No status filter is applied here, and that is deliberate rather than an
 * omission: `listings_select_discoverable` already restricts the result to
 * listings on the market plus the caller's own. Repeating the filter in the
 * query would make it look as though the application were the thing enforcing
 * it, and someone would eventually "optimise" the policy away.
 *
 * The seller's own drafts do come back through that policy, so the browse page
 * asks for market statuses explicitly — as a *presentation* choice, since a
 * seller browsing the market should not see their own unpublished drafts mixed
 * into it.
 */
export const BROWSE_PAGE_SIZE = 100;

export async function browseListings(filters: BrowseFilters = {}): Promise<Capped<ListingTeaser>> {
  const supabase = await createClient();

  // One more than we intend to show. The extra row is the entire mechanism: it
  // is how the page knows the difference between "there were exactly 100" and
  // "there were more and you are not being told".
  let query = supabase
    .from('listings')
    .select(TEASER_COLUMNS)
    .in('status', ['live', 'under_loi', 'under_contract'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(overFetch(BROWSE_PAGE_SIZE));

  if (filters.industry) query = query.eq('industry', filters.industry);
  if (filters.jurisdiction) query = query.eq('jurisdiction_code', filters.jurisdiction);
  if (filters.minEarningsCents !== undefined) {
    query = query.gte('earnings_band_high_cents', filters.minEarningsCents);
  }
  if (filters.maxAskingCents !== undefined) {
    query = query.lte('asking_price_band_low_cents', filters.maxAskingCents);
  }

  const { data, error } = await query;
  if (error || !data) return capped<ListingTeaser>([], BROWSE_PAGE_SIZE);

  const page = capped(data as Row[], BROWSE_PAGE_SIZE);
  const saved = await savedListingIds();

  return {
    ...page,
    rows: page.rows.map((row) => toTeaser(row, saved.has(row.id))),
  };
}

/** Listings the caller owns or manages, at any status. */
export async function listMyListings(): Promise<ListingTeaser[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Filtered to the caller's own rows rather than relying on the policy, because
  // the policy also admits the whole market — "mine" is a narrower question than
  // "what may I see".
  const { data, error } = await supabase
    .from('listings')
    .select(TEASER_COLUMNS)
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((row) => toTeaser(row as Row));
}

/** Listings managed through a firm the caller belongs to, excluding their own. */
export async function listFirmListings(): Promise<ListingTeaser[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from('listings')
    .select(TEASER_COLUMNS)
    .not('firm_id', 'is', null)
    .neq('seller_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((row) => toTeaser(row as Row));
}

export async function listWatchlist(): Promise<ListingTeaser[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_saves')
    .select(`created_at, listings ( ${TEASER_COLUMNS} )`)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data
    .map((row) => {
      const listing = Array.isArray((row as Row).listings)
        ? (row as Row).listings[0]
        : (row as Row).listings;
      return listing ? toTeaser(listing as Row, true) : null;
    })
    .filter((teaser): teaser is ListingTeaser => teaser !== null);
}

async function savedListingIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase.from('listing_saves').select('listing_id');
  return new Set((data ?? []).map((row) => (row as Row).listing_id as string));
}

// ---------------------------------------------------------------------------
// One listing
// ---------------------------------------------------------------------------

/**
 * The detail view.
 *
 * `profile` is null unless the database returned one. The gate is
 * `listing_details_select_nda`; this function does not re-implement it, does
 * not check the NDA itself, and does not decide. It asks, and reports what
 * Postgres said.
 */
export async function loadListing(listingId: string): Promise<ListingDetailView | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: listingRow, error } = await supabase
    .from('listings')
    .select(`${TEASER_COLUMNS}, seller_id, firm_id`)
    .eq('id', listingId)
    .maybeSingle();

  // Indistinguishable from "does not exist", on purpose. A 404 that means
  // "exists but you cannot see it" confirms a business is for sale.
  if (error || !listingRow) return null;

  const row = listingRow as Row;

  const [savedRow, ndaRow, profile, history] = await Promise.all([
    supabase.from('listing_saves').select('listing_id').eq('listing_id', listingId).maybeSingle(),
    user
      ? supabase
          .from('listing_ndas')
          .select('id, status, requested_at, sent_at, signed_at, expires_at, revoked_at')
          .eq('listing_id', listingId)
          .eq('buyer_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadFullProfile(listingId),
    loadStatusHistory(listingId),
  ]);

  // Asked of the shared permission model rather than re-derived here, so the
  // page and the database agree on what "controls" means. This drives which
  // *controls* are rendered, never which data is returned — the data was
  // already decided by RLS above.
  const actor = await getActor();
  const controls =
    actor !== null &&
    controlsListing(actor, {
      id: row.id,
      ownerUserId: row.seller_id,
      firmId: row.firm_id ?? null,
      status: row.status as ListingStatus,
    });

  return {
    teaser: toTeaser(row, savedRow.data !== null),
    profile,
    nda: ndaRow.data ? toNda(ndaRow.data as Row) : null,
    controls,
    history,
  };
}

function toNda(row: Row): ListingNda {
  return {
    id: row.id,
    status: row.status as NdaStatus,
    requestedAt: row.requested_at,
    sentAt: row.sent_at ?? null,
    signedAt: row.signed_at ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
  };
}

/**
 * The confidential half.
 *
 * Returns null when the policy refused, which is the same shape as "this
 * listing has no profile yet". The caller cannot tell the two apart and should
 * not need to — in both cases there is nothing to show.
 */
async function loadFullProfile(listingId: string): Promise<ListingFullProfile | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_details')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Row;
  const financials = await loadFinancials(listingId);

  return {
    legalName: row.legal_name,
    tradingName: row.trading_name ?? null,
    addressLine1: row.address_line1 ?? null,
    addressLine2: row.address_line2 ?? null,
    city: row.city ?? null,
    postalCode: row.postal_code ?? null,
    website: row.website ?? null,
    revenueCents: row.revenue_cents ?? null,
    earningsCents: row.earnings_cents ?? null,
    askingPriceCents: row.asking_price_cents ?? null,
    customerConcentration:
      row.customer_concentration === null ? null : Number(row.customer_concentration),
    recurringRevenueShare:
      row.recurring_revenue_share === null ? null : Number(row.recurring_revenue_share),
    keyCustomers: row.key_customers ?? null,
    competitivePosition: row.competitive_position ?? null,
    growthOpportunities: row.growth_opportunities ?? null,
    knownRisks: row.known_risks ?? null,
    financials,
  };
}

async function loadFinancials(listingId: string): Promise<ListingFinancialYear[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_financials')
    .select('id, fiscal_year, revenue_cents, ebitda_cents, sde_cents, addbacks_cents')
    .eq('listing_id', listingId)
    .order('fiscal_year', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: (row as Row).id,
    fiscalYear: (row as Row).fiscal_year,
    revenueCents: (row as Row).revenue_cents,
    ebitdaCents: (row as Row).ebitda_cents ?? null,
    sdeCents: (row as Row).sde_cents ?? null,
    addbacksCents: (row as Row).addbacks_cents ?? null,
  }));
}

async function loadStatusHistory(listingId: string): Promise<ListingStatusEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    // The view, not the table. Since 0022 the table carries a reviewer's reason
    // for sending a listing back, which is written for the seller and not for
    // the market — and a column is not something RLS can hide, so the timeline
    // everyone sees is a view with no reason column at all.
    .from('listing_status_timeline')
    .select('id, from_status, to_status, changed_at')
    .eq('listing_id', listingId)
    // `id` breaks the tie. Every row written in one transaction shares `now()`,
    // so two transitions made together sort arbitrarily against each other on
    // the timestamp alone — and a timeline that shows a listing going live
    // before it was submitted reads as a bug in the record.
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: String((row as Row).id),
    fromStatus: ((row as Row).from_status ?? null) as ListingStatus | null,
    toStatus: (row as Row).to_status as ListingStatus,
    changedAt: (row as Row).changed_at,
  }));
}

/**
 * NDAs on a listing, for the seller's queue.
 *
 * The policy admits the seller to every NDA on their own listing and a buyer to
 * their own, so a buyer calling this gets one row rather than an error. The
 * page that uses it is seller-only, but the query does not need to be — the
 * database already decided.
 */
export async function listNdaRequests(listingId: string): Promise<ListingNdaRequest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_ndas')
    .select('id, buyer_id, status, requested_at, sent_at, signed_at, expires_at, revoked_at')
    .eq('listing_id', listingId)
    .order('requested_at', { ascending: false });

  if (error || !data) return [];

  // Fetched separately rather than embedded, because `listing_ndas.buyer_id`
  // and `profiles.id` both point at `auth.users` without pointing at each
  // other — there is no foreign key between them for PostgREST to follow.
  //
  // `profiles_select_nda_counterparty` admits the seller to the profile of any
  // buyer with a live request on their listing, which is the whole point: a
  // seller deciding whether to release their financials has to know who is
  // asking. The entity and funding source come from `buyer_profiles` for the
  // same reason — "SBA-funded operator, two prior deals" is what the decision
  // actually turns on.
  const buyerIds = [...new Set(data.map((row) => (row as Row).buyer_id as string))];
  const names = new Map<string, string>();
  const entities = new Map<string, { entityName: string | null; fundingSource: string | null }>();

  if (buyerIds.length > 0) {
    const [profiles, buyerProfiles] = await Promise.all([
      supabase.from('profiles').select('id, full_name').in('id', buyerIds),
      supabase
        .from('buyer_profiles')
        .select('user_id, entity_name, funding_source')
        .in('user_id', buyerIds),
    ]);

    for (const profile of profiles.data ?? []) {
      const p = profile as Row;
      if (p.full_name) names.set(p.id as string, p.full_name as string);
    }

    for (const buyerProfile of buyerProfiles.data ?? []) {
      const b = buyerProfile as Row;
      entities.set(b.user_id as string, {
        entityName: b.entity_name ?? null,
        fundingSource: b.funding_source ?? null,
      });
    }
  }

  return data.map((row) => {
    const r = row as Row;
    const entity = entities.get(r.buyer_id as string);
    return {
      ...toNda(r),
      buyerId: r.buyer_id,
      buyerName: names.get(r.buyer_id as string) ?? null,
      buyerEntity: entity?.entityName ?? null,
      buyerFundingSource: entity?.fundingSource ?? null,
    };
  });
}

/** Active jurisdictions, for the listing form and the browse filter. */
export async function listJurisdictions(): Promise<JurisdictionOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('jurisdictions')
    .select('code, name')
    .eq('is_active', true)
    .order('name');

  if (error || !data) return [];
  return data.map((row) => ({ code: (row as Row).code, name: (row as Row).name }));
}
