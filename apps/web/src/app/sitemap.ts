import type { MetadataRoute } from 'next';
import { brand } from '@ib/core';

import { publicListingIndex } from '@/features/market/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * The public pages, and only those.
 *
 * Deliberately hand-written rather than generated from the route tree. A
 * generated sitemap picks up every new page by default, which is the wrong
 * default here — the next route somebody adds is far more likely to be behind
 * sign-in than in front of it, and a sitemap that quietly starts advertising
 * `/deals` is a sitemap that has to be caught in review rather than by the
 * build.
 *
 * Empty when the site is not indexable, so a staging deploy does not hand a
 * crawler a list of URLs to try.
 *
 * ## Two entries were actively wrong
 *
 * It advertised `/listings`, `/sign-up` and `/sign-in`, and all three are marked
 * `noindex` — `/listings` also redirects an unauthenticated caller to sign-in.
 * So the sitemap invited a crawler to three pages that then turned it away,
 * which is worse than omitting them: it spends crawl budget and teaches Google
 * that URLs from this file are not worth following.
 *
 * The listings live at `/businesses-for-sale` now, which is public by design.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.NEXT_PUBLIC_ALLOW_INDEXING !== 'true') return [];

  const now = new Date();

  /*
   * One entry per live listing, read from the same view the public pages use.
   * Failing to reach the database yields the static pages rather than nothing —
   * a sitemap missing its listings is a bad day, an empty one is a signal to
   * Google that the site went away.
   */
  const listings = isSupabaseConfigured() ? await publicListingIndex().catch(() => []) : [];

  return [
    { url: brand.url, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    {
      url: `${brand.url}/businesses-for-sale`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...listings.map((listing) => ({
      url: `${brand.url}/businesses-for-sale/${listing.slug}`,
      lastModified: listing.publishedAt ? new Date(listing.publishedAt) : now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    {
      url: `${brand.url}/tools/valuation`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${brand.url}/legal/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${brand.url}/legal/privacy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];
}
