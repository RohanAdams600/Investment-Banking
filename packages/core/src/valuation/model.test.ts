import { describe, expect, it } from 'vitest';

import { estimateValuation, ValuationInputError, type ValuationInputs } from './model';
import { INDUSTRY_KEYS, industryProfile } from './industries';

/**
 * The valuation model.
 *
 * Two things are being tested. The arithmetic, which is ordinary. And the
 * *shape* of the output — that it is always a range, that every adjustment is
 * accounted for in the reasoning, and that the model refuses rather than
 * guesses when it is out of its depth. Those are the properties that keep this
 * an estimate for discussion rather than a number someone anchors a life's work
 * to.
 */

const baseInputs: ValuationInputs = {
  industry: 'home_services',
  revenue: 250_000_000, // $2.5M
  sde: 50_000_000, // $500K
};

describe('output shape', () => {
  it('always returns a range, never a single figure', () => {
    const result = estimateValuation(baseInputs);

    expect(result.range.high).toBeGreaterThan(result.range.low);
    // The type carries no headline midpoint on purpose: the moment one exists,
    // it becomes the number people quote and the range stops doing its job.
    expect(result).not.toHaveProperty('estimate');
    expect(result).not.toHaveProperty('value');
    expect(result).not.toHaveProperty('midpoint');
  });

  it('keeps the range at least half a turn wide', () => {
    // A range so narrow it reads as a point estimate would misrepresent how
    // much this model actually knows.
    const result = estimateValuation({ ...baseInputs, customerConcentration: 0.55 });

    expect(result.effectiveMultipleHigh - result.effectiveMultipleLow).toBeGreaterThanOrEqual(0.5);
  });

  it('reports every adjustment it applied', () => {
    const result = estimateValuation({
      ...baseInputs,
      customerConcentration: 0.05,
      recurringRevenueShare: 0.7,
      revenueGrowth: 0.25,
      ownerDependence: 'absentee',
      yearsInBusiness: 20,
    });

    // A conclusion with no visible basis does not ship. Each factor must name
    // itself, say which way it moved value, and explain why.
    expect(result.factors.length).toBeGreaterThan(0);
    for (const factor of result.factors) {
      expect(factor.label).not.toBe('');
      expect(factor.explanation.length).toBeGreaterThan(20);
      expect(['positive', 'negative', 'neutral']).toContain(factor.direction);
    }
  });

  it('produces reasoning that reconciles with the arithmetic', () => {
    const result = estimateValuation({
      ...baseInputs,
      customerConcentration: 0.35,
      revenueGrowth: 0.1,
    });

    const stated = result.factors.reduce((sum, f) => sum + f.multipleDelta, 0);
    const actual = result.effectiveMultipleLow - result.baseMultipleLow;

    // If these ever disagree, the explanation shown to the user is not the
    // calculation that produced the number.
    expect(actual).toBeCloseTo(stated, 2);
  });
});

describe('earnings basis', () => {
  it('applies SDE multiples to SDE and EBITDA multiples to EBITDA', () => {
    const sdeResult = estimateValuation(baseInputs);
    expect(sdeResult.basis).toBe('sde');
    expect(sdeResult.earnings).toBe(baseInputs.sde);

    const ebitdaResult = estimateValuation({
      industry: 'manufacturing',
      revenue: 800_000_000,
      ebitda: 120_000_000,
    });
    expect(ebitdaResult.basis).toBe('ebitda');
    expect(ebitdaResult.earnings).toBe(120_000_000);
  });

  it('refuses SDE-quoted industries given only EBITDA', () => {
    // Silently applying an SDE multiple to EBITDA overstates value by roughly
    // one owner's salary times the multiple — a large, invisible error.
    expect(() =>
      estimateValuation({ industry: 'home_services', revenue: 250_000_000, ebitda: 50_000_000 }),
    ).toThrow(ValuationInputError);
  });

  it('refuses EBITDA-quoted industries given only SDE', () => {
    expect(() =>
      estimateValuation({ industry: 'manufacturing', revenue: 800_000_000, sde: 120_000_000 }),
    ).toThrow(ValuationInputError);
  });
});

describe('refusing rather than guessing', () => {
  it('declines a break-even business instead of returning a number', () => {
    // Loss-making businesses are valued on assets or strategic fit. Returning
    // an earnings multiple anyway would be worse than declining.
    expect(() => estimateValuation({ ...baseInputs, sde: 0 })).toThrow(/asset-based/);
    expect(() => estimateValuation({ ...baseInputs, sde: -1_000_000 })).toThrow(/asset-based/);
  });

  it('rejects non-integer money, rather than rounding it', () => {
    expect(() => estimateValuation({ ...baseInputs, sde: 50_000_000.5 })).toThrow(
      /integer number of cents/,
    );
  });

  it('rejects negative revenue', () => {
    expect(() => estimateValuation({ ...baseInputs, revenue: -1 })).toThrow(ValuationInputError);
  });
});

describe('factor direction', () => {
  it('lowers the range for heavy customer concentration', () => {
    const diversified = estimateValuation({ ...baseInputs, customerConcentration: 0.05 });
    const concentrated = estimateValuation({ ...baseInputs, customerConcentration: 0.6 });

    expect(concentrated.range.high).toBeLessThan(diversified.range.high);
    expect(concentrated.factors.some((f) => f.direction === 'negative')).toBe(true);
  });

  it('lowers the range when the business depends on its owner', () => {
    const absentee = estimateValuation({ ...baseInputs, ownerDependence: 'absentee' });
    const critical = estimateValuation({ ...baseInputs, ownerDependence: 'critical' });

    expect(critical.range.low).toBeLessThan(absentee.range.low);
  });

  it('raises the range for recurring revenue and growth', () => {
    const plain = estimateValuation(baseInputs);
    const strong = estimateValuation({
      ...baseInputs,
      recurringRevenueShare: 0.8,
      revenueGrowth: 0.3,
    });

    expect(strong.range.low).toBeGreaterThan(plain.range.low);
  });

  it('does not let stacked negatives drive the multiple to nonsense', () => {
    // Every negative factor at once. The clamp is a statement that the model
    // has a domain, not a patch on the arithmetic — a near-zero multiple is not
    // an estimate, it is the model off the end of its heuristics.
    const worst = estimateValuation({
      ...baseInputs,
      sde: 10_000_000,
      customerConcentration: 0.9,
      revenueGrowth: -0.4,
      ownerDependence: 'critical',
      yearsInBusiness: 1,
    });

    expect(worst.effectiveMultipleLow).toBeGreaterThanOrEqual(0.75);
    expect(worst.range.low).toBeGreaterThan(0);
    expect(worst.range.high).toBeGreaterThan(worst.range.low);
  });
});

describe('confidence and gaps', () => {
  it('reports low confidence and names the gaps on sparse input', () => {
    const result = estimateValuation(baseInputs);

    expect(result.confidence).toBe('low');
    expect(result.missingInputs.length).toBeGreaterThanOrEqual(4);
    // The most valuable missing input is named first, so the prompt to the user
    // is actionable rather than a checklist.
    expect(result.missingInputs[0]).toMatch(/largest customer/i);
  });

  it('never claims better than indicative confidence, however complete the input', () => {
    const result = estimateValuation({
      ...baseInputs,
      customerConcentration: 0.05,
      recurringRevenueShare: 0.7,
      revenueGrowth: 0.15,
      ownerDependence: 'absentee',
      yearsInBusiness: 22,
      employeeCount: 40,
    });

    // There is no 'high'. No quantity of form fields turns this into an
    // appraisal, and the vocabulary should not suggest otherwise.
    expect(result.confidence).toBe('indicative');
    expect(result.missingInputs).toHaveLength(0);
  });

  it('holds confidence down for the generic industry', () => {
    const result = estimateValuation({
      industry: 'other',
      revenue: 250_000_000,
      sde: 50_000_000,
      customerConcentration: 0.05,
      recurringRevenueShare: 0.7,
      revenueGrowth: 0.15,
      ownerDependence: 'absentee',
      yearsInBusiness: 22,
    });

    expect(result.confidence).toBe('moderate');
  });
});

describe('industry table', () => {
  it('gives every industry a valid, ordered range and a rationale', () => {
    for (const key of INDUSTRY_KEYS) {
      const profile = industryProfile(key);
      expect(profile.multipleHigh, key).toBeGreaterThan(profile.multipleLow);
      expect(profile.multipleLow, key).toBeGreaterThan(0);
      expect(['sde', 'ebitda']).toContain(profile.basis);
      // Shown to the user as part of the reasoning, so it has to say something.
      expect(profile.rationale.length, key).toBeGreaterThan(40);
    }
  });

  it('values every industry without throwing, given a matching earnings figure', () => {
    for (const key of INDUSTRY_KEYS) {
      const profile = industryProfile(key);
      const result = estimateValuation({
        industry: key,
        revenue: 500_000_000,
        ...(profile.basis === 'sde' ? { sde: 80_000_000 } : { ebitda: 80_000_000 }),
      });

      expect(result.range.low, key).toBeGreaterThan(0);
    }
  });
});
