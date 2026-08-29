import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The boundary this feature is built around.
 *
 * "Let buyers see trending businesses" has an obvious implementation — rank the
 * listings by view count — and it is the one thing this must never do. How many
 * people looked at a business is readable by its seller and nobody else,
 * enforced by a policy written specifically to prevent it, because a buyer who
 * knows a listing has been sitting quietly negotiates with that.
 *
 * A prose comment saying so is worth very little; the next person to add a
 * "popular this week" section will not read it. So the source is asserted.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/**
 * The file with its comments removed.
 *
 * Necessary, and the reason is instructive: the first version of this test
 * failed against the very file it was protecting, because that file's header
 * *explains* why it never reads `listing_view_days` and the substring search
 * could not tell an explanation from a query. A test that cannot distinguish a
 * comment from code is a test that punishes documenting the rule it enforces.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the buyer-facing market view', () => {
  it('never reads the view tally', () => {
    for (const file of ['./market.ts', '../../app/(app)/market-pulse/page.tsx']) {
      const source = code(file);
      expect(source, `${file} touches listing_view_days`).not.toContain('listing_view_days');
      expect(source, `${file} touches the view summary`).not.toContain('listing_view_summary');
      expect(source, `${file} touches record_listing_view`).not.toContain('record_listing_view');
    }
  });

  it('holds no privileged client', () => {
    /*
     * Every figure is aggregated from teasers RLS already returned, so a
     * buyer's picture of the market is exactly the market they may browse. A
     * service-role client here would make this file, rather than the database,
     * the thing deciding what a buyer sees.
     */
    for (const file of ['./market.ts', '../../app/(app)/market-pulse/page.tsx']) {
      expect(code(file)).not.toMatch(/createServiceRoleClient|SERVICE_ROLE|service_role/);
    }
  });

  it('says out loud why there is no popularity ranking', () => {
    // A buyer who cannot find a "most viewed" list should learn that it is a
    // deliberate protection rather than a missing feature — partly because it
    // is the same protection they get when they come to sell.
    const page = read('../../app/(app)/market-pulse/page.tsx');
    expect(page).toContain('Why there is no popularity ranking');
  });
});

describe('the seller-facing analytics', () => {
  it('does not identify a viewer', () => {
    /*
     * The tally table has three columns and none of them is a person. A seller
     * asking "who looked" is asking something this platform deliberately cannot
     * answer, and any of these words appearing here would mean that changed.
     */
    const source = code('./queries.ts');
    for (const forbidden of ['viewer_id', 'ip_address', 'user_agent', 'unique_visitors']) {
      expect(source, `analytics reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('tells the seller what is not being collected', () => {
    // Rather than leaving them to assume the number is merely missing.
    const panel = read('./listing-analytics.tsx');
    expect(panel).toContain('No visitor is identified');
  });
});
