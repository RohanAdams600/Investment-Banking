import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * The public, crawlable market.
 *
 * Everything here reads `market_listings`, a view that exposes live listings and
 * teaser columns only. The application's own browse page reads the `listings`
 * table through the caller's session; this reads a surface that has no session
 * at all, and the two are kept apart on purpose — a public page that queried the
 * table would be one policy change away from serving something it should not.
 *
 * The view deliberately has no `id` and no `seller_id`. A public listing is
 * identified by its slug and nothing else.
 */

export interface PublicListing {
  slug: string;
  headline: string;
  summary: string | null;
  background: string | null;
  industry: string;
  jurisdictionCode: string;
  jurisdictionName: string | null;
  revenueBand: { lowCents: number | null; highCents: number | null };
  earningsBand: { lowCents: number | null; highCents: number | null };
  askingBand: { lowCents: number | null; highCents: number | null };
  dealStructure: 'asset' | 'stock';
  employeeCount: number | null;
  yearsInBusiness: number | null;
  growthTrend: 'declining' | 'flat' | 'growing' | 'rapid' | null;
  realEstateIncluded: boolean;
  ownerDependence: 'absentee' | 'moderate' | 'critical' | null;
  reasonForSale: string | null;
  publishedAt: string | null;
}

/** Bounded because PostgREST caps any unbounded read at 1000 and says nothing. */
const PUBLIC_PAGE = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toPublic(row: Row): PublicListing {
  return {
    slug: row.slug,
    headline: row.headline,
    summary: row.summary ?? null,
    background: row.background ?? null,
    industry: row.industry,
    jurisdictionCode: row.jurisdiction_code,
    jurisdictionName: row.jurisdiction_name ?? null,
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
  };
}

/**
 * The slice of a PostgREST builder these filters need.
 *
 * Structural rather than imported: `PostgrestFilterBuilder` carries five type
 * parameters that differ between the two call sites, and naming them here would
 * couple this file to a client version for no benefit. All that matters is that
 * the three methods return the same builder back.
 */
interface FilterBuilder {
  eq(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
}

export interface PublicFilter {
  industry?: string;
  jurisdiction?: string;
  q?: string;
  /** Both in cents, both compared against the teaser's published bands. */
  minEarningsCents?: number;
  maxAskingCents?: number;
}

export async function publicListings(filter?: PublicFilter): Promise<PublicListing[]> {
  const supabase = await createClient();

  /*
   * A search term changes the shape of the query entirely: ranking cannot be
   * expressed through PostgREST, so `search_market` does it in SQL and returns
   * ordered slugs, which are then hydrated. Two round trips rather than one,
   * and the alternative is results in physical order, which reads as random.
   */
  /*
   * The structured filters, applied to whichever branch runs below.
   *
   * Band comparisons rather than point comparisons, and the same permissive
   * direction the saved-search function uses: "earning at least $500k" asks
   * whether the top of the published band reaches $500k, not whether the bottom
   * does. A buyer would rather see a listing whose band straddles their floor
   * and judge it themselves than never learn it existed — and the two surfaces
   * must agree, because a saved search built from these filters that then
   * matched a different set would be a bug nobody could explain.
   */
  /**
   * Applies the structured filters to whichever query shape is running below.
   *
   * Band comparisons rather than point comparisons, and the same permissive
   * direction the saved-search function uses: "earning at least $500k" asks
   * whether the top of the published band reaches $500k, not whether the bottom
   * does. A buyer would rather see a listing whose band straddles their floor
   * and judge it themselves than never learn it existed — and the two surfaces
   * have to agree, because a saved search built from these filters that then
   * matched a different set would be a bug nobody could explain.
   *
   * Generic over the builder so both branches share one definition. PostgREST's
   * filter methods return the same builder type, which is what makes the
   * constraint below expressible without casting.
   */
  function narrow<T extends FilterBuilder>(query: T): T {
    let q = query;
    if (filter?.industry) q = q.eq('industry', filter.industry);
    if (filter?.jurisdiction) q = q.eq('jurisdiction_code', filter.jurisdiction);
    if (filter?.minEarningsCents !== undefined) {
      q = q.gte('earnings_band_high_cents', filter.minEarningsCents);
    }
    if (filter?.maxAskingCents !== undefined) {
      q = q.lte('asking_price_band_low_cents', filter.maxAskingCents);
    }
    return q;
  }

  if (filter?.q?.trim()) {
    const { data: ranked, error: rankError } = await supabase.rpc('search_market', {
      term: filter.q.trim(),
      max_rows: PUBLIC_PAGE,
    });
    if (rankError || !ranked) return [];

    const slugs = (ranked as Row[]).map((row) => row.slug as string);
    if (slugs.length === 0) return [];

    /*
     * The structured filters are applied to the hydration rather than to the
     * ranking. `search_market` ranks by text relevance over the whole live
     * market; narrowing here means a filtered search returns fewer than
     * `PUBLIC_PAGE` results rather than reaching further down the ranking for
     * more — which is the honest behaviour, because the alternative shows a
     * buyer worse text matches for having named a state.
     */
    const { data, error } = await narrow(
      supabase.from('market_listings').select('*').in('slug', slugs),
    );
    if (error || !data) return [];

    // Re-imposed, because `in` returns rows in whatever order it likes and the
    // ranking is the entire value of having searched.
    const order = new Map(slugs.map((slug, index) => [slug, index]));
    return (data as Row[])
      .map(toPublic)
      .sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
  }

  const { data, error } = await narrow(
    supabase
      .from('market_listings')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(PUBLIC_PAGE),
  );

  if (error || !data) return [];
  return (data as Row[]).map(toPublic);
}

export async function publicListing(slug: string): Promise<PublicListing | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('market_listings')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;
  return toPublic(data as Row);
}

/** Slugs and dates, for the sitemap. */
export async function publicListingIndex(): Promise<
  { slug: string; publishedAt: string | null }[]
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('market_listings')
    .select('slug, published_at')
    .limit(PUBLIC_PAGE * 5);

  if (error || !data) return [];
  return (data as Row[]).map((row) => ({
    slug: row.slug as string,
    publishedAt: (row.published_at as string | null) ?? null,
  }));
}

/**
 * Notes that somebody looked.
 *
 * Records no viewer identity of any kind — the table has three columns and none
 * of them is a person. A page-view tally rather than unique visitors, which is
 * weaker and is the right trade: browsing a marketplace for confidential deals
 * should not create a record of who looked, and a hashed IP is still personal
 * data in several places this will operate.
 *
 * Swallows everything. A seller's view count is not worth a visitor seeing an
 * error page.
 */
export async function recordView(slug: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc('record_listing_view', { target_slug: slug });
  } catch {
    // Deliberately silent.
  }
}
