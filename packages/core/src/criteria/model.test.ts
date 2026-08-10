import { describe, expect, it } from 'vitest';

import { scoreFit, type AcquisitionCriteria, type ListingProfile } from './model';

const criteria: AcquisitionCriteria = {
  industries: ['home_services'],
  jurisdictions: ['US-TX'],
  revenueMin: 100_000_000, // $1M
  revenueMax: 500_000_000, // $5M
  earningsMin: 20_000_000, // $200K
  earningsMax: 100_000_000, // $1M
  dealStructure: 'either',
  involvement: 'either',
};

const listing: ListingProfile = {
  industry: 'home_services',
  jurisdiction: 'US-TX',
  revenue: 250_000_000,
  earnings: 50_000_000,
  dealStructure: 'asset',
};

describe('explainability', () => {
  it('returns reasons with every score', () => {
    const result = scoreFit(criteria, listing);

    // The spec requires the top three contributing factors to be shown with any
    // score. A number with no visible basis does not ship.
    expect(result.topReasons).toHaveLength(3);
    for (const reason of result.topReasons) {
      expect(reason.label).not.toBe('');
      expect(reason.detail.length).toBeGreaterThan(10);
    }
  });

  it('orders the top reasons by contribution', () => {
    const result = scoreFit(criteria, listing);
    const points = result.topReasons.map((r) => r.points);

    expect([...points].sort((a, b) => b - a)).toEqual(points);
  });

  it('accounts for the whole score in the reasons', () => {
    const result = scoreFit(criteria, listing);
    const total = result.allReasons.reduce((sum, r) => sum + r.points, 0);

    // If these diverge, the explanation is not the calculation.
    expect(Math.round(total)).toBe(result.score);
  });
});

describe('scoring', () => {
  it('scores a well-matched listing highly', () => {
    expect(scoreFit(criteria, listing).score).toBeGreaterThanOrEqual(80);
  });

  it('scores an out-of-sector, out-of-state listing low', () => {
    const mismatch = scoreFit(criteria, {
      ...listing,
      industry: 'restaurants_retail',
      jurisdiction: 'US-ME',
    });

    expect(mismatch.score).toBeLessThan(60);
    expect(mismatch.excluded).toBe(false);
  });

  it('treats an unset preference as neutral, not as a match', () => {
    // "No industry preference" and "every industry is a perfect match" are
    // different claims, and conflating them inflates every score.
    const open = scoreFit({ ...criteria, industries: [] }, listing);
    const matched = scoreFit(criteria, listing);

    expect(open.score).toBeLessThan(matched.score);
  });

  it('degrades gradually just outside a stated band', () => {
    // Buyers state round numbers, not precise thresholds. A business 10% over a
    // ceiling is nearly what they asked for and should not vanish.
    const slightlyOver = scoreFit(criteria, { ...listing, revenue: 550_000_000 });
    const farOver = scoreFit(criteria, { ...listing, revenue: 2_000_000_000 });

    expect(slightlyOver.score).toBeGreaterThan(farOver.score);
    expect(slightlyOver.score).toBeGreaterThan(60);
  });

  it('treats a structure mismatch as a discussion, not a barrier', () => {
    const result = scoreFit({ ...criteria, dealStructure: 'stock' }, listing);

    expect(result.excluded).toBe(false);
    expect(result.allReasons.some((r) => /negotiable/i.test(r.detail))).toBe(true);
  });
});

describe('hard limits', () => {
  it('excludes a listing that breaches a stated maximum concentration', () => {
    const result = scoreFit(
      { ...criteria, maxCustomerConcentration: 0.4 },
      { ...listing, customerConcentration: 0.65 },
    );

    // A stated limit is a constraint, not a preference. Surfacing this at 71%
    // fit would teach the buyer to distrust the score.
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
    expect(result.exclusionReasons[0]).toMatch(/65%/);
  });

  it('excludes a listing priced above the buyer’s maximum deal size', () => {
    const result = scoreFit(
      { ...criteria, dealSizeMax: 300_000_000 },
      { ...listing, askingPrice: 900_000_000 },
    );

    expect(result.excluded).toBe(true);
    expect(result.exclusionReasons[0]).toMatch(/maximum deal size/i);
  });

  it('excludes a listing below a stated recurring revenue floor', () => {
    const result = scoreFit(
      { ...criteria, minRecurringRevenueShare: 0.5 },
      { ...listing, recurringRevenueShare: 0.1 },
    );

    expect(result.excluded).toBe(true);
  });

  it('says why it excluded, never just that it did', () => {
    const result = scoreFit(
      { ...criteria, maxCustomerConcentration: 0.2 },
      { ...listing, customerConcentration: 0.8 },
    );

    expect(result.exclusionReasons.length).toBeGreaterThan(0);
    expect(result.exclusionReasons[0]!.length).toBeGreaterThan(20);
  });

  it('does not exclude on a limit the listing has not disclosed', () => {
    // Absent data is not a breach. Excluding here would penalise sellers for
    // fields they have not filled in yet.
    const result = scoreFit(
      { ...criteria, maxCustomerConcentration: 0.2 },
      { ...listing, customerConcentration: undefined },
    );

    expect(result.excluded).toBe(false);
  });
});

describe('involvement preference', () => {
  it('rewards an owner-independent business for a passive buyer', () => {
    const passive: AcquisitionCriteria = { ...criteria, involvement: 'passive' };

    const absentee = scoreFit(passive, { ...listing, ownerDependence: 'absentee' });
    const critical = scoreFit(passive, { ...listing, ownerDependence: 'critical' });

    expect(absentee.score).toBeGreaterThan(critical.score);
  });
});
