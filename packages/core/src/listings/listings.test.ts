import { describe, expect, it } from 'vitest';

import {
  LISTING_STATUSES,
  LISTING_STATUS_LABELS,
  LISTING_TRANSITIONS,
  canTransition,
  isDiscoverable,
  isTerminal,
} from './lifecycle';
import { deriveBand, formatBand } from './teaser';

describe('listing lifecycle', () => {
  it('allows the normal path start to finish', () => {
    const path = [
      'draft',
      'pending_review',
      'live',
      'under_loi',
      'under_contract',
      'closed',
    ] as const;

    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
  });

  it('refuses a draft jumping straight to the market', () => {
    // Publishing skips the review step and the first status-history entry.
    expect(canTransition('draft', 'live')).toBe(false);
  });

  it('treats closed and withdrawn as terminal', () => {
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('withdrawn')).toBe(true);

    for (const status of LISTING_STATUSES) {
      expect(canTransition('closed', status), `closed → ${status}`).toBe(false);
      expect(canTransition('withdrawn', status), `withdrawn → ${status}`).toBe(false);
    }
  });

  it('lets anything not yet finished be withdrawn', () => {
    for (const status of LISTING_STATUSES) {
      if (isTerminal(status)) continue;
      expect(canTransition(status, 'withdrawn'), `${status} → withdrawn`).toBe(true);
    }
  });

  it('never offers a transition to itself', () => {
    // A no-op move would produce a status-history row recording nothing.
    for (const status of LISTING_STATUSES) {
      expect(LISTING_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('marks exactly the market statuses as discoverable', () => {
    expect(LISTING_STATUSES.filter(isDiscoverable)).toEqual([
      'live',
      'under_loi',
      'under_contract',
    ]);
  });

  it('labels every status', () => {
    for (const status of LISTING_STATUSES) {
      expect(LISTING_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe('formatBand', () => {
  it('renders a closed range', () => {
    expect(formatBand({ lowCents: 150_000_000, highCents: 250_000_000 })).toBe('$1.5M – $2.5M');
  });

  it('renders an open lower end as a ceiling', () => {
    expect(formatBand({ lowCents: null, highCents: 50_000_000 })).toBe('Under $500K');
  });

  it('renders an open upper end as a floor', () => {
    expect(formatBand({ lowCents: 500_000_000, highCents: null })).toBe('$5M+');
  });

  it('collapses a range with identical ends', () => {
    expect(formatBand({ lowCents: 100_000_000, highCents: 100_000_000 })).toBe('$1M');
  });

  it('says so explicitly when nothing is disclosed', () => {
    // Never an empty string: a blank cell reads as a bug, and withholding the
    // asking price is a deliberate choice worth surfacing as one.
    expect(formatBand({ lowCents: null, highCents: null })).toBe('Not disclosed');
  });

  it('takes a caller-supplied phrase for the undisclosed case', () => {
    expect(formatBand({ lowCents: null, highCents: null }, 'Ask the seller')).toBe(
      'Ask the seller',
    );
  });

  it('never emits an exact-looking figure for a range', () => {
    // The whole point of the teaser. If a band ever rendered as a single precise
    // number, the disclosure boundary would have moved without anyone noticing.
    const rendered = formatBand({ lowCents: 412_345_600, highCents: 587_654_300 });
    expect(rendered).toContain('–');
    expect(rendered).not.toContain('412');
  });
});

describe('deriveBand', () => {
  it('brackets the true figure', () => {
    const exact = 420_000_000; // $4.2M
    const band = deriveBand(exact);

    expect(band.lowCents).not.toBeNull();
    expect(band.highCents).not.toBeNull();
    expect(band.lowCents!).toBeLessThan(exact);
    expect(band.highCents!).toBeGreaterThan(exact);
  });

  it('rounds outwards, never inwards', () => {
    // Rounding inwards would produce a band narrower than the spread implies,
    // and a band tight enough to pin the figure is a disclosure.
    const exact = 420_000_000;
    const band = deriveBand(exact, 0.2);

    expect(band.lowCents!).toBeLessThanOrEqual(exact * 0.8);
    expect(band.highCents!).toBeGreaterThanOrEqual(exact * 1.2);
  });

  it('lands on a round number rather than a derived-looking one', () => {
    // $3.36M–$5.04M would tell a reader the midpoint was $4.2M.
    const band = deriveBand(420_000_000);

    expect(band.lowCents! % (250_000 * 100)).toBe(0);
    expect(band.highCents! % (250_000 * 100)).toBe(0);
  });

  it('widens the step as the figure grows', () => {
    const small = deriveBand(30_000_000); // $300K
    const large = deriveBand(8_000_000_000); // $80M

    const smallWidth = small.highCents! - small.lowCents!;
    const largeWidth = large.highCents! - large.lowCents!;
    expect(largeWidth).toBeGreaterThan(smallWidth);
  });

  it('returns nothing disclosable for a missing or non-positive figure', () => {
    expect(deriveBand(null)).toEqual({ lowCents: null, highCents: null });
    expect(deriveBand(0)).toEqual({ lowCents: null, highCents: null });
    expect(deriveBand(-1)).toEqual({ lowCents: null, highCents: null });
  });

  it('never produces a negative floor', () => {
    const band = deriveBand(1_000);
    expect(band.lowCents!).toBeGreaterThanOrEqual(0);
  });
});
