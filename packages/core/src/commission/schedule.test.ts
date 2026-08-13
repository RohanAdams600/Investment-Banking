import { describe, expect, it } from 'vitest';

import { CommissionInputError, calculateCommission, type FeeAgreement } from './schedule';

const M = 100_000_000; // one million dollars, in cents

describe('double Lehman', () => {
  const agreement: FeeAgreement = { structure: 'double_lehman' };

  it('charges 10% on a deal inside the first million', () => {
    // $500K × 10% = $50K
    expect(calculateCommission(agreement, 50_000_000).totalFeeCents).toBe(5_000_000);
  });

  it('is marginal, not whole-price', () => {
    // The mistake that matters. $4M whole-price at the top rate would be very
    // different from 10/8/6/4 on each successive million.
    //
    // 1M×10% + 1M×8% + 1M×6% + 1M×4% = 100K + 80K + 60K + 40K = $280K
    expect(calculateCommission(agreement, 4 * M).totalFeeCents).toBe(28_000_000);
  });

  it('applies 2% above four million', () => {
    // $280K on the first 4M, plus 1M × 2% = $20K
    expect(calculateCommission(agreement, 5 * M).totalFeeCents).toBe(30_000_000);
  });

  it('shows the working band by band', () => {
    const result = calculateCommission(agreement, 2_500_000_00);

    expect(result.bands.map((b) => b.rate)).toEqual([0.1, 0.08, 0.06]);
    // The third band carries only the half-million above $2M, not a full one.
    expect(result.bands[2]!.amountCents).toBe(50_000_000);
  });

  it('bands sum to the total', () => {
    // Rounding happens once at the end, so the parts must agree with the whole.
    // A statement whose lines do not add up is one nobody trusts.
    for (const price of [1, 999_999, M, 3_300_000_00, 12 * M]) {
      const result = calculateCommission(agreement, price);
      const summed = result.bands.reduce((total, band) => total + band.feeCents, 0);
      expect(summed, `at ${price}`).toBe(result.calculatedFeeCents);
    }
  });
});

describe('Lehman', () => {
  it('charges half the double rates', () => {
    // 1M×5% + 1M×4% + 1M×3% + 1M×2% = $140K
    expect(calculateCommission({ structure: 'lehman' }, 4 * M).totalFeeCents).toBe(14_000_000);
  });
});

describe('flat', () => {
  it('applies one rate to the whole price', () => {
    const agreement: FeeAgreement = { structure: 'flat', flatRate: 0.08 };
    expect(calculateCommission(agreement, 2 * M).totalFeeCents).toBe(16_000_000);
  });

  it('refuses a missing or impossible rate', () => {
    expect(() => calculateCommission({ structure: 'flat' }, M)).toThrow(CommissionInputError);
    expect(() => calculateCommission({ structure: 'flat', flatRate: 1.5 }, M)).toThrow(
      CommissionInputError,
    );
  });
});

describe('minimum fee', () => {
  const agreement: FeeAgreement = {
    structure: 'double_lehman',
    minimumFeeCents: 5_000_000, // $50K
  };

  it('raises a fee below the floor', () => {
    // The line that stops small deals losing money. $300K at 10% is $30K, and
    // running that deal properly costs more than that in time.
    const result = calculateCommission(agreement, 30_000_000);

    expect(result.calculatedFeeCents).toBe(3_000_000);
    expect(result.totalFeeCents).toBe(5_000_000);
    expect(result.minimumApplied).toBe(true);
  });

  it('leaves a fee above the floor alone', () => {
    const result = calculateCommission(agreement, 2 * M);
    expect(result.minimumApplied).toBe(false);
  });

  it('charges nothing on a zero-price deal', () => {
    // A minimum on a sale that did not happen is a charge for nothing.
    const result = calculateCommission(agreement, 0);

    expect(result.totalFeeCents).toBe(0);
    expect(result.minimumApplied).toBe(false);
  });
});

describe('co-broker split', () => {
  const agreement: FeeAgreement = {
    structure: 'flat',
    flatRate: 0.1,
    coBrokerShare: 0.5,
  };

  it('splits the whole fee', () => {
    const result = calculateCommission(agreement, M);

    expect(result.totalFeeCents).toBe(10_000_000);
    expect(result.coBrokerFeeCents).toBe(5_000_000);
    expect(result.netFeeCents).toBe(5_000_000);
  });

  it('never loses a cent to rounding', () => {
    // The two shares must reconstitute the total exactly. An odd cent that
    // vanishes is the sort of thing that surfaces in an audit years later.
    for (const share of [0.25, 1 / 3, 0.5, 0.6667, 0.75]) {
      for (const price of [999_999, 1_000_001, 3_333_333]) {
        const result = calculateCommission(
          { structure: 'flat', flatRate: 0.1, coBrokerShare: share },
          price,
        );
        expect(result.coBrokerFeeCents + result.netFeeCents).toBe(result.totalFeeCents);
      }
    }
  });

  it('keeps everything with no co-broker', () => {
    const result = calculateCommission({ structure: 'flat', flatRate: 0.1 }, M);
    expect(result.coBrokerFeeCents).toBe(0);
    expect(result.netFeeCents).toBe(result.totalFeeCents);
  });

  it('refuses a share outside 0 to 1', () => {
    expect(() =>
      calculateCommission({ structure: 'flat', flatRate: 0.1, coBrokerShare: 1.2 }, M),
    ).toThrow(CommissionInputError);
  });
});

describe('custom tiers', () => {
  it('applies a negotiated schedule', () => {
    const agreement: FeeAgreement = {
      structure: 'tiered',
      tiers: [
        { upToCents: 2 * M, rate: 0.12 },
        { upToCents: null, rate: 0.03 },
      ],
    };

    // 2M×12% + 1M×3% = 240K + 30K = $270K
    expect(calculateCommission(agreement, 3 * M).totalFeeCents).toBe(27_000_000);
  });

  it('refuses tiers that do not ascend', () => {
    // Out-of-order tiers do not fail anywhere else — they quietly compute
    // something plausible, and nobody notices until the invoice is disputed.
    expect(() =>
      calculateCommission(
        {
          structure: 'tiered',
          tiers: [
            { upToCents: 2 * M, rate: 0.1 },
            { upToCents: M, rate: 0.05 },
          ],
        },
        3 * M,
      ),
    ).toThrow(/ascend/i);
  });

  it('refuses an open-ended tier that is not last', () => {
    expect(() =>
      calculateCommission(
        {
          structure: 'tiered',
          tiers: [
            { upToCents: null, rate: 0.1 },
            { upToCents: 2 * M, rate: 0.05 },
          ],
        },
        3 * M,
      ),
    ).toThrow(/last tier/i);
  });

  it('refuses an empty schedule', () => {
    expect(() => calculateCommission({ structure: 'tiered', tiers: [] }, M)).toThrow(
      CommissionInputError,
    );
  });
});

describe('input validation', () => {
  it('refuses a fractional price', () => {
    // Money moves as integer cents everywhere in this codebase.
    expect(() => calculateCommission({ structure: 'lehman' }, 100.5)).toThrow(CommissionInputError);
  });

  it('refuses a negative price', () => {
    expect(() => calculateCommission({ structure: 'lehman' }, -1)).toThrow(CommissionInputError);
  });
});

describe('effective rate', () => {
  it('falls as the price rises under a marginal schedule', () => {
    // The property that makes Lehman what it is, and the number a client
    // actually compares between brokers.
    const agreement: FeeAgreement = { structure: 'double_lehman' };

    const small = calculateCommission(agreement, M).effectiveRate;
    const large = calculateCommission(agreement, 10 * M).effectiveRate;

    expect(small).toBeCloseTo(0.1, 5);
    expect(large).toBeLessThan(small);
  });

  it('is zero on a zero-price deal rather than NaN', () => {
    expect(calculateCommission({ structure: 'lehman' }, 0).effectiveRate).toBe(0);
  });
});
