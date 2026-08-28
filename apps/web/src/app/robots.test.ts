import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import robots from './robots';
import sitemap from './sitemap';

/**
 * The file that decides whether a staging deploy ends up in Google.
 *
 * Worth testing because it is one line of configuration away from being wrong in
 * a way nobody notices until a customer searches for their own business and
 * finds the URL of the deal room where it is being sold.
 */
describe('robots', () => {
  const original = process.env.NEXT_PUBLIC_ALLOW_INDEXING;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    else process.env.NEXT_PUBLIC_ALLOW_INDEXING = original;
  });

  it('closes the whole site when indexing is not explicitly allowed', () => {
    // Defaults closed rather than open. The deploy that gets indexed by accident
    // is always the one where somebody forgot to set something.
    const rules = robots().rules;
    expect(rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('closes it for any value that is not exactly "true"', () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      process.env.NEXT_PUBLIC_ALLOW_INDEXING = value;
      expect(robots().rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    }
  });

  it('still disallows everything behind sign-in when indexing is on', () => {
    // The important line. A deal room URL in a search index is a disclosure that
    // no amount of RLS undoes — the policy stops the crawler reading the
    // contents, but the URL itself names a deal.
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';

    const [rule] = robots().rules as Array<{ disallow?: string[] }>;
    const disallowed = rule?.disallow ?? [];

    for (const path of ['/admin/', '/api/', '/deals/', '/crm', '/dashboard', '/settings/']) {
      expect(disallowed, `${path} must never be crawlable`).toContain(path);
    }
  });

  it('keeps individual listings out of the index', () => {
    // The browse page is the front door. A stable indexed URL per business is a
    // trail back to a seller who was promised anonymity.
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';
    const [rule] = robots().rules as Array<{ disallow?: string[] }>;
    expect(rule?.disallow ?? []).toContain('/listings/');
  });

  it('advertises a sitemap only when the site is indexable', () => {
    expect(robots().sitemap).toBeUndefined();

    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe('sitemap', () => {
  const original = process.env.NEXT_PUBLIC_ALLOW_INDEXING;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    else process.env.NEXT_PUBLIC_ALLOW_INDEXING = original;
  });

  it('is empty when the site is not indexable', async () => {
    delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    // So a staging deploy does not hand a crawler a list of URLs to try.
    expect(await sitemap()).toEqual([]);
  });

  it('never advertises a page that will turn a crawler away', async () => {
    /*
     * This test used to assert that `/listings` *should* be here, and that was
     * the bug: `/listings` is `robots: noindex` and redirects an
     * unauthenticated caller to sign-in, as do `/sign-up` and `/sign-in`. The
     * sitemap was inviting a crawler to three pages that then refused it, which
     * is worse than omitting them — it spends crawl budget and teaches Google
     * that URLs from this file are not worth following.
     *
     * The test hard-coded the wrong answer, which is why the contradiction
     * survived. It now asserts the property rather than the list.
     */
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    for (const behindALogin of ['/listings', '/sign-up', '/sign-in', '/dashboard', '/deals']) {
      expect(paths, `${behindALogin} is noindex and must not be advertised`).not.toContain(
        behindALogin,
      );
    }
  });

  it('advertises the public market', async () => {
    // The only content this business produces, and the whole reason the public
    // route exists. Without it a crawler can reach exactly one page.
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    expect(paths).toContain('/');
    expect(paths).toContain('/businesses-for-sale');
    expect(paths).toContain('/legal/terms');
  });

  it('lists nothing outside the known public surface', async () => {
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    for (const path of paths) {
      const allowed =
        [
          '/',
          '/businesses-for-sale',
          '/tools/valuation',
          '/legal/terms',
          '/legal/privacy',
        ].includes(path) || path.startsWith('/businesses-for-sale/');

      expect(allowed, `${path} is in the sitemap and should not be`).toBe(true);
    }
  });
});
