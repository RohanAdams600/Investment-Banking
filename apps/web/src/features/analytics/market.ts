import 'server-only';

import { INDUSTRY_PROFILES, type IndustryKey } from '@ib/core';
import type { ChartPoint } from '@ib/ui';

import type { ListingTeaser } from '@/features/listings/types';

import { weeklyBuckets } from './queries';

/**
 * What a buyer is shown about the market, and what they are not.
 *
 * ## Per-listing view counts do not appear here, on purpose
 *
 * The obvious reading of "let a buyer see trending businesses" is a popularity
 * number on each listing. This does not do that, and the reason is in the
 * schema: `listing_view_days` is readable only by whoever controls the listing,
 * because a buyer who can see how many people looked at a business negotiates
 * with it — a low count is an opening bid, and a seller who chose this platform
 * for its confidentiality did not agree to hand that over.
 *
 * Breaking that would mean changing an RLS policy written specifically to
 * prevent it. So what a buyer gets instead is the market in aggregate: how much
 * is coming to market, in which sectors, and how it is priced. That answers the
 * question actually behind "what is trending" — where is the activity — without
 * turning every seller's traffic into a bargaining chip.
 *
 * ## Computed from what the caller could already read
 *
 * Everything here is derived from teasers RLS already returned. No aggregate
 * spans rows the caller cannot see, so a buyer's picture of the market is
 * exactly the market they are permitted to browse, and there is no privileged
 * query to get wrong.
 */

export interface MarketTrends {
  newByWeek: ChartPoint[];
  bySector: ChartPoint[];
  liveTotal: number;
  newThisWeek: number;
  newPreviousWeek: number;
  /** Median asking price in cents, across listings that state one. */
  medianAskingCents: number | null;
}

export function marketTrends(listings: ListingTeaser[]): MarketTrends {
  const published = listings
    .map((listing) => listing.publishedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value));

  const newByWeek = weeklyBuckets(published, 12);

  const perSector = new Map<string, number>();
  for (const listing of listings) {
    perSector.set(listing.industry, (perSector.get(listing.industry) ?? 0) + 1);
  }

  const bySector: ChartPoint[] = [...perSector.entries()]
    .map(([key, value]) => ({
      label: INDUSTRY_PROFILES[key as IndustryKey]?.label ?? key,
      value,
    }))
    /*
     * Sectors with nothing in them are omitted rather than drawn at zero. A row
     * of empty bars is a list of what this marketplace does not have, which is
     * not what a buyer opened the page to find out.
     */
    .filter((point) => point.value > 0);

  return {
    newByWeek,
    bySector,
    liveTotal: listings.length,
    newThisWeek: newByWeek[newByWeek.length - 1]?.value ?? 0,
    newPreviousWeek: newByWeek[newByWeek.length - 2]?.value ?? 0,
    medianAskingCents: median(
      listings
        .map((listing) => midpoint(listing.askingBand.lowCents, listing.askingBand.highCents))
        .filter((value): value is number => value !== null),
    ),
  };
}

/**
 * The middle of a band, or whichever end exists.
 *
 * Listings state a range rather than a price, so there is no single figure to
 * take a median of. The midpoint is the honest summary of a range; an open-
 * ended band contributes the end it does state rather than being dropped, which
 * would quietly bias the median toward whoever was most specific.
 */
function midpoint(low: number | null, high: number | null): number | null {
  if (low !== null && high !== null) return (low + high) / 2;
  return low ?? high;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  // Even counts average the two middles; odd counts take the middle. Both
  // guarded so an index can never come back undefined under strict settings.
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower !== undefined && upper !== undefined ? (lower + upper) / 2 : null;
}
