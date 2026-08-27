import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { palette } from '@ib/ui';

/**
 * Share cards, and the two things that can go wrong with them.
 *
 * ## A card leaves the site
 *
 * This is the only surface in the product rendered for people who have signed
 * nothing, fetched by LinkedIn and cached by Slack, and seen by anyone the link
 * reaches. Putting a legal name or an exact figure on one would defeat the whole
 * confidentiality model in the single place nobody would think to check — the
 * gate is enforced by RLS everywhere else, and a card is generated server-side
 * with no session at all.
 *
 * ## The colours cannot come from tokens
 *
 * `ImageResponse` renders in an isolated Satori context with no stylesheet and
 * no CSS variables, so a token resolves to nothing and produces a black
 * rectangle. The hex values are therefore duplicated by necessity — and a
 * duplicated palette is a palette that drifts, so it is checked here instead.
 */

const SITE_CARD = readFileSync(new URL('./opengraph-image.tsx', import.meta.url).pathname, 'utf8');
const LISTING_CARD = readFileSync(
  new URL('./(app)/listings/[listingId]/opengraph-image.tsx', import.meta.url).pathname,
  'utf8',
);

describe('the listing share card', () => {
  it('never reads the confidential profile', () => {
    /*
     * `loadListing` returns both halves. The card destructures the teaser and
     * discards the rest; touching `profile` here would be the bug.
     */
    expect(LISTING_CARD).not.toMatch(/\.profile\b/);
    expect(LISTING_CARD).not.toMatch(/legalName|legal_name/);
    expect(LISTING_CARD).not.toMatch(/revenueCents|earningsCents|askingPriceCents/);
    expect(LISTING_CARD).not.toMatch(/customerConcentration|keyCustomers|ownershipHistory/);
  });

  it('shows bands rather than figures', () => {
    // `formatBand` renders the published range. There is no code path here that
    // can print an exact number.
    expect(LISTING_CARD).toMatch(/formatBand/);
    expect(LISTING_CARD).toMatch(/teaser\.revenueBand/);
  });

  it('survives a listing it cannot see', () => {
    // A card is rendered with no session, so an unlisted or draft business must
    // produce a generic card rather than an error page in somebody's Slack.
    expect(LISTING_CARD).toMatch(/catch\(\(\) => null\)/);
    expect(LISTING_CARD).toMatch(/'A business for sale'/);
  });
});

describe('both cards', () => {
  it.each([
    ['site', SITE_CARD],
    ['listing', LISTING_CARD],
  ])('%s card uses the real palette values', (_name, source) => {
    // Drift here is invisible: nobody opens their own link previews, which is
    // how the missing image went unnoticed for as long as it did.
    const hexes = [...source.matchAll(/'(#[0-9A-F]{6})'/g)].map((m) => m[1]!);
    expect(hexes.length).toBeGreaterThan(0);

    const known = new Set(
      [palette.slate, palette.stone, palette.copper].flatMap((family) =>
        Object.values(family).map((hex) => hex.toUpperCase()),
      ),
    );

    for (const hex of hexes) {
      expect(known, `${hex} is not in the palette`).toContain(hex);
    }
  });

  it.each([
    ['site', SITE_CARD],
    ['listing', LISTING_CARD],
  ])('%s card is the size every platform expects', (_name, source) => {
    // 1200x630. Get this wrong and the card is cropped differently on every
    // service, which reads as carelessness on the one asset everyone sees.
    expect(source).toMatch(/width:\s*1200,\s*height:\s*630/);
  });

  it.each([
    ['site', SITE_CARD],
    ['listing', LISTING_CARD],
  ])('%s card takes the brand name from configuration', (_name, source) => {
    // This project has renamed once already. A card with the old name on it
    // would keep being served from every cache that ever fetched it.
    expect(source).toMatch(/brand\.name/);
    expect(source).not.toMatch(/\bAshlar\b|\bCairn\b/);
  });
});
