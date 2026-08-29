import { describe, expect, it } from 'vitest';

import {
  CAPACITY_BAND_LABELS,
  CAPACITY_BAND_ORDER,
  FUNDING_EVIDENCE_LABELS,
  VERIFICATION_DISCLAIMER,
  describeBadge,
  type VerificationBadge,
} from './index';

const base: VerificationBadge = {
  status: 'verified',
  capacityBand: 'from_1m_to_5m',
  verifiedAt: '2026-01-01T00:00:00Z',
  expiresAt: '2026-07-01T00:00:00Z',
  isCurrent: true,
};

describe('verification badges', () => {
  it('never promises that funds are guaranteed', () => {
    /*
     * The claim the operator would be making if this wording slipped. Every
     * badge a seller can see is checked, not only the happy one — a warning
     * state that overstates the review is the same liability with a yellow
     * background.
     */
    const badges: Array<VerificationBadge | null> = [
      null,
      base,
      { ...base, isCurrent: false },
      { ...base, status: 'pending' },
      { ...base, status: 'rejected' },
      { ...base, status: 'withdrawn' },
    ];

    for (const badge of badges) {
      const text = `${describeBadge(badge).label} ${describeBadge(badge).detail}`.toLowerCase();
      expect(text).not.toMatch(/guarantee[sd]?\b(?! that)/);
      expect(text).not.toContain('proof of funds confirmed');
      expect(text).not.toContain('funds available');
      expect(text).not.toContain('certified');
    }
  });

  it('distinguishes a buyer who never submitted from one who was rejected', () => {
    // A seller reading "no badge" as "failed" harms the buyer, and it is the
    // one error in this feature that hurts the side that did nothing wrong.
    const missing = describeBadge(null);
    const rejected = describeBadge({ ...base, status: 'rejected' });

    expect(missing.label).not.toBe(rejected.label);
    expect(missing.detail).toContain('not a judgement');
  });

  it('does not present a lapsed review as current', () => {
    const lapsed = describeBadge({ ...base, isCurrent: false });
    expect(lapsed.tone).not.toBe('success');
    expect(lapsed.label.toLowerCase()).toContain('lapsed');
  });

  it('only shows success for a current, verified review', () => {
    expect(describeBadge(base).tone).toBe('success');

    for (const status of ['pending', 'rejected', 'withdrawn'] as const) {
      expect(describeBadge({ ...base, status }).tone, status).not.toBe('success');
    }
    expect(describeBadge({ ...base, isCurrent: false }).tone).not.toBe('success');
  });

  it('states a band and never an exact figure', () => {
    // The database stores a band for this reason; the labels must not quietly
    // reintroduce precision the schema deliberately removed.
    for (const label of Object.values(CAPACITY_BAND_LABELS)) {
      expect(label).not.toMatch(/\$\d{3,}(?![km])/i);
    }
    expect(CAPACITY_BAND_ORDER).toHaveLength(Object.keys(CAPACITY_BAND_LABELS).length);
  });

  it('labels every evidence kind the database accepts', () => {
    // A kind with no label renders as a raw enum value in front of a customer.
    expect(Object.keys(FUNDING_EVIDENCE_LABELS)).toEqual([
      'cash',
      'sba_preapproval',
      'lender_commitment',
      'committed_fund',
      'search_fund',
      'seller_financing_sought',
      'other',
    ]);
  });

  it('keeps the disclaimer explicit about what was not done', () => {
    const text = VERIFICATION_DISCLAIMER.toLowerCase();
    expect(text).toContain('not a credit check');
    expect(text).toContain('source-of-funds');
    // Phrased as one negation over a list — "not a credit check, a
    // source-of-funds investigation, or a guarantee" — so the assertion has to
    // match the clause rather than the words "not a guarantee".
    expect(text).toMatch(/\bit is not\b[^.]*\bor a guarantee\b/);
  });
});
