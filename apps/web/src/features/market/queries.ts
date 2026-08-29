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

export async function publicListings(filter?: {
  industry?: string;
  q?: string;
}): Promise<PublicListing[]> {
  const supabase = await createClient();

  /*
   * A search term changes the shape of the query entirely: ranking cannot be
   * expressed through PostgREST, so `search_market` does it in SQL and returns
   * ordered slugs, which are then hydrated. Two round trips rather than one,
   * and the alternative is results in physical order, which reads as random.
   */
  if (filter?.q?.trim()) {
    const { data: ranked, error: rankError } = await supabase.rpc('search_market', {
      term: filter.q.trim(),
      max_rows: PUBLIC_PAGE,
    });
    if (rankError || !ranked) return [];

    const slugs = (ranked as Row[]).map((row) => row.slug as string);
    if (slugs.length === 0) return [];

    const { data, error } = await supabase.from('market_listings').select('*').in('slug', slugs);
    if (error || !data) return [];

    // Re-imposed, because `in` returns rows in whatever order it likes and the
    // ranking is the entire value of having searched.
    const order = new Map(slugs.map((slug, index) => [slug, index]));
    return (data as Row[])
      .map(toPublic)
      .sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
  }

  let query = supabase
    .from('market_listings')
    .select('*')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(PUBLIC_PAGE);

  if (filter?.industry) query = query.eq('industry', filter.industry);

  const { data, error } = await query;
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
