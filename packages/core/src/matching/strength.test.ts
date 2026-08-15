import { describe, expect, it } from 'vitest';

import { MATCH_STRENGTH_THRESHOLDS, matchStrength, worthNotifying } from './strength';

describe('matchStrength', () => {
  it('puts the boundary score in the higher band', () => {
    // Off-by-one on a boundary is the whole reason this is a function rather
    // than two comparisons written out again at each call site.
    expect(matchStrength(MATCH_STRENGTH_THRESHOLDS.strong)).toBe('strong');
    expect(matchStrength(MATCH_STRENGTH_THRESHOLDS.strong - 1)).toBe('possible');
    expect(matchStrength(MATCH_STRENGTH_THRESHOLDS.possible)).toBe('possible');
    expect(matchStrength(MATCH_STRENGTH_THRESHOLDS.possible - 1)).toBe('weak');
  });

  it('handles the ends of the range', () => {
    expect(matchStrength(0)).toBe('weak');
    expect(matchStrength(100)).toBe('strong');
  });
});

describe('worthNotifying', () => {
  it('interrupts only for a strong match', () => {
    expect(worthNotifying(95, false)).toBe(true);
    expect(worthNotifying(69, false)).toBe(false);
  });

  it('never interrupts about an excluded match', () => {
    // An exclusion means the buyer said no to something about this business —
    // wrong industry, too big, wrong structure. A high score alongside an
    // exclusion is the scorer noting the parts that did fit, and it is not an
    // invitation.
    expect(worthNotifying(100, true)).toBe(false);
  });
});
