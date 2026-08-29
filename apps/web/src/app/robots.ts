import type { MetadataRoute } from 'next';
import { brand } from '@ib/core';

/**
 * What crawlers are told.
 *
 * The `robots` field in the root layout's metadata sets a per-page meta tag,
 * which is not the same thing: a crawler reads `/robots.txt` first and may never
 * fetch the page whose tag would have told it to stay away. Both are needed, and
 * only this one covers a URL nobody links to.
 *
 * ## The disallow list is not conditional
 *
 * Everything behind sign-in is disallowed whether or not the site is indexable,
 * and that is the important line. A deal room URL in a Google index is a
 * disclosure that no amount of RLS undoes — the policy stops the crawler reading
 * the contents, but the *URL itself* names a deal, and the snippet cache may
 * hold whatever a misconfigured page once rendered.
 *
 * `NEXT_PUBLIC_ALLOW_INDEXING` only decides whether the public half is crawled.
 * Left unset, the whole site is closed, which is the correct default for a
 * staging deploy — the one that gets indexed by accident and then has to be
 * removed from a search engine one URL at a time.
 */
export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true';

  /** Everything that needs a session. Never crawlable, on any deployment. */
  const privatePaths = [
    '/admin/',
    '/api/',
    '/auth/',
    '/buyer-profile',
    '/commissions',
    '/crm',
    '/dashboard',
    '/deals/',
    '/matches',
    '/onboarding',
    '/questionnaire/',
    '/settings/',
    '/watchlist',
    /*
     * The tools, one at a time rather than a blanket `/tools/`.
     *
     * `/tools/valuation` is the single most valuable public page this site has —
     * "what is my business worth" is a search owners already make — and a
     * blanket rule blocked it while the sitemap advertised it. The other two
     * need a session and hold somebody's own draft work.
     */
    '/tools/legal-documents',
    '/tools/buyer-criteria',
    /*
     * The application's listing pages, which need a session and carry the
     * seller's own view of their listing. The *public* market is a different
     * route — `/businesses-for-sale/` — reading a view with no seller id on it,
     * and it is deliberately absent from this list.
     */
    '/listings/',
  ];

  if (!indexable) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: privatePaths,
      },
    ],
    sitemap: `${brand.url}/sitemap.xml`,
  };
}
