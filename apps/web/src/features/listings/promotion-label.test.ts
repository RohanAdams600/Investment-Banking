import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The paid-placement disclosure, asserted at the source.
 *
 * Ranking listings by payment without saying so is deceptive advertising, and
 * the obligation sits on whoever runs the ranking. That makes the label a
 * different kind of thing from ordinary UI: it is not a design decision a later
 * redesign gets to simplify away.
 *
 * A rendering test would be better and there is no DOM environment configured
 * here, so this reads the file instead. That is a weaker check than mounting the
 * component — it proves the reference exists, not that a human sees it — and it
 * is still worth having, because the realistic way this disclosure disappears is
 * somebody deleting the block while tidying a card, not a subtle CSS bug.
 *
 * Nothing in this file claims the wording or placement satisfies any particular
 * regulator. That is a question for counsel. This only makes losing the label a
 * deliberate act with a failing test attached.
 */

const CARD = new URL('./listing-card.tsx', import.meta.url).pathname;
const TYPES = new URL('./types.ts', import.meta.url).pathname;

describe('paid placement disclosure', () => {
  it('is rendered from the teaser the card was handed', () => {
    const source = readFileSync(CARD, 'utf8');

    expect(source).toContain('listing.promoted');
    expect(source).toMatch(/Promoted/);
  });

  it('reads "paid placement" in words, not just a badge', () => {
    // "Promoted" alone is a term of art. Somebody buying a business for the
    // first time should not have to know it means somebody paid for the slot.
    const source = readFileSync(CARD, 'utf8');
    expect(source.toLowerCase()).toContain('paid placement');
  });

  it('carries the flag on the teaser type rather than fetching it separately', () => {
    /*
     * The structural half of the guarantee. Because `promoted` is required on
     * `ListingTeaser`, every surface that renders a teaser has the fact in hand
     * and the compiler refuses a caller that forgot it — which is how the
     * matcher was caught when this was added.
     */
    const source = readFileSync(TYPES, 'utf8');
    expect(source).toMatch(/promoted:\s*boolean;/);
    expect(source).not.toMatch(/promoted\?:\s*boolean/);
  });

  it('leaves matches ranked by fit alone', () => {
    /*
     * Paid placement moves a listing up browse. It must not touch the matcher:
     * a buyer who recorded criteria is being told "these fit you", and a bought
     * position inside that answer is a materially worse claim than a labelled
     * slot at the top of a search page.
     */
    const matcher = new URL('../matching/queries.ts', import.meta.url).pathname;
    const source = readFileSync(matcher, 'utf8');
    expect(source).toMatch(/promoted:\s*false/);
  });

  it('is not silently disabled by a feature flag', () => {
    // A disclosure behind an env check is a disclosure that is off in some
    // environment nobody is looking at.
    const source = readFileSync(CARD, 'utf8');
    expect(source).not.toMatch(/process\.env/);
  });

  it('has no unreviewed component holding a teaser', () => {
    /*
     * Catches the next listing surface.
     *
     * Every component below was looked at once and either shows the label or has
     * a reason not to. A new file failing this test is not a defect — it is the
     * prompt to make that decision explicitly, and then add the file here with
     * the reason.
     */
    const REVIEWED: Record<string, string> = {
      'apps/web/src/features/listings/listing-card.tsx':
        'Renders the label. This is the browse surface paid placement reorders.',
      'apps/web/src/features/listings/listing-form.tsx':
        'A seller editing their own listing. Nobody is being ranked, so there is nothing to disclose.',
      'apps/web/src/features/listings/pricing-panel.tsx':
        'A seller setting their own price. Same reason.',
      'apps/web/src/app/(app)/listings/[listingId]/opengraph-image.tsx':
        'A share card. Deliberately unlabelled: the disclosure obligation attaches to a ranked result, and this is a link somebody chose to share rather than a position sold to them. It renders bands only and never touches the confidential half — asserted in og-image.test.ts.',
    };

    let files: string[] = [];
    try {
      files = execFileSync('git', ['grep', '-l', 'ListingTeaser', '--', 'apps/web/src/**/*.tsx'], {
        cwd: new URL('../../../../../', import.meta.url).pathname,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      if (failure.status !== 1 || failure.stdout) throw error;
    }

    const unreviewed = files.filter((path) => !(path in REVIEWED));

    expect(
      unreviewed,
      `New component holding a ListingTeaser. Decide whether it shows the paid-placement label, then add it to REVIEWED with the reason:\n${unreviewed.join('\n')}`,
    ).toEqual([]);

    // And the reverse: a reviewed file that no longer exists means the list is
    // stale and quietly excusing nothing.
    const missing = Object.keys(REVIEWED).filter((path) => !files.includes(path));
    expect(missing, `Stale entries in REVIEWED:\n${missing.join('\n')}`).toEqual([]);
  });
});
