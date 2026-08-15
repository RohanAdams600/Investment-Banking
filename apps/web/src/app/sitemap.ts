import type { MetadataRoute } from 'next';
import { brand } from '@ib/core';

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
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (process.env.NEXT_PUBLIC_ALLOW_INDEXING !== 'true') return [];

  const now = new Date();

  return [
    { url: brand.url, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${brand.url}/listings`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${brand.url}/sign-up`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${brand.url}/sign-in`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
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
