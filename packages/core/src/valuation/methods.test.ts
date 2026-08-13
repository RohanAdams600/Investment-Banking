import { describe, expect, it } from 'vitest';

import { describeAskingPrice, valueAllMethods, type MultiMethodInputs } from './methods';

const profitable: MultiMethodInputs = {
  industry: 'home_services',
  revenue: 420_000_000, // $4.2M
  sde: 95_000_000, // $950K
  customerConcentration: 0.18,
  recurringRevenueShare: 0.45,
  revenueGrowth: 0.08,
  yearsInBusiness: 12,
  employeeCount: 14,
  ownerDependence: 'moderate',
  tangibleAssets: 30_000_000,
  inventory: 5_000_000,
  liabilities: 8_000_000,
};

describe('valueAllMethods', () => {
  it('returns every method, applicable or not', () => {
    const result = valueAllMethods(profitable);
    expect(result.methods.map((m) => m.key)).toEqual([
      'earnings_multiple',
      'revenue_multiple',
      'asset_based',
    ]);
  });

  it('explains a method even when it does not apply', () => {
    // A blank where a number should be reads as a bug. Saying why the method
    // is absent is more useful than hiding it.
    const noAssets = valueAllMethods({
      ...profitable,
      tangibleAssets: undefined,
      inventory: undefined,
    });
    const asset = noAssets.methods.find((m) => m.key === 'asset_based')!;

    expect(asset.range).toBeNull();
    expect(asset.rationale).toMatch(/no asset figures/i);
  });

  it('weights the earnings method above the others for a profitable business', () => {
    const result = valueAllMethods(profitable);
    expect(result.applicable[0]!.key).toBe('earnings_multiple');
  });

  it('still values a business at break-even', () => {
    // The single-method engine throws here, which left a seller who most needs
    // a number with an error message. The revenue and asset methods still say
    // something a buyer would recognise.
    const breakEven = valueAllMethods({ ...profitable, sde: 0 });

    expect(breakEven.methods.find((m) => m.key === 'earnings_multiple')!.range).toBeNull();
    expect(breakEven.applicable.length).toBeGreaterThan(0);
    expect(breakEven.overall).not.toBeNull();
  });

  it('leans on revenue when there are no earnings', () => {
    const breakEven = valueAllMethods({ ...profitable, sde: 0 });
    expect(breakEven.applicable[0]!.key).toBe('revenue_multiple');
  });

  it('explains why the earnings method declined', () => {
    const loss = valueAllMethods({ ...profitable, sde: -5_000_000 });
    const earnings = loss.methods.find((m) => m.key === 'earnings_multiple')!;

    expect(earnings.rationale).toMatch(/break-even/i);
  });

  it('scales the revenue multiple by margin', () => {
    // A business keeping 30% of revenue is worth more per dollar of revenue
    // than one keeping 5%. A flat revenue multiple would say otherwise.
    const fat = valueAllMethods({ ...profitable, sde: 126_000_000 }); // 30%
    const thin = valueAllMethods({ ...profitable, sde: 21_000_000 }); // 5%

    const fatRange = fat.methods.find((m) => m.key === 'revenue_multiple')!.range!;
    const thinRange = thin.methods.find((m) => m.key === 'revenue_multiple')!.range!;

    expect(fatRange.high).toBeGreaterThan(thinRange.high);
  });

  it('nets liabilities off the asset value', () => {
    const result = valueAllMethods(profitable);
    const asset = result.methods.find((m) => m.key === 'asset_based')!.range!;

    // 30M + 5M - 8M = 27M
    expect(asset.high).toBe(27_000_000);
    expect(asset.low).toBeLessThan(asset.high);
  });

  it('declines the asset method when debt exceeds assets', () => {
    const underwater = valueAllMethods({ ...profitable, liabilities: 100_000_000 });
    const asset = underwater.methods.find((m) => m.key === 'asset_based')!;

    expect(asset.range).toBeNull();
    expect(asset.rationale).toMatch(/liabilities exceed/i);
  });

  it('spans every applicable method in the overall range', () => {
    const result = valueAllMethods(profitable);
    const ranges = result.applicable.map((m) => m.range!);

    expect(result.overall!.low).toBe(Math.min(...ranges.map((r) => r.low)));
    expect(result.overall!.high).toBe(Math.max(...ranges.map((r) => r.high)));
  });

  it('notices when the methods do not overlap', () => {
    // An asset-heavy business earning very little is the classic case, and the
    // gap is information the seller should see rather than an average.
    const assetHeavy = valueAllMethods({
      ...profitable,
      revenue: 20_000_000,
      sde: 500_000,
      tangibleAssets: 400_000_000,
      inventory: 0,
      liabilities: 0,
    });

    expect(assetHeavy.methodsDisagree).toBe(true);
  });

  it('agrees with itself for an ordinary business', () => {
    expect(valueAllMethods(profitable).methodsDisagree).toBe(false);
  });

  it('produces no ranges at all when there is nothing to work with', () => {
    const nothing = valueAllMethods({ industry: 'home_services', revenue: 0, sde: 0 });
    expect(nothing.applicable).toHaveLength(0);
    expect(nothing.overall).toBeNull();
  });
});

describe('derived metrics', () => {
  it('reports margin with an interpretation', () => {
    const metrics = valueAllMethods(profitable).metrics;
    const margin = metrics.find((m) => m.label === 'Profit margin')!;

    expect(margin.value).toBe('22.6%');
    expect(margin.interpretation).toBeTruthy();
  });

  it('calls a negative margin what it is', () => {
    const metrics = valueAllMethods({ ...profitable, sde: -5_000_000 }).metrics;
    const margin = metrics.find((m) => m.label === 'Profit margin')!;

    expect(margin.interpretation).toMatch(/negative/i);
  });

  it('reports revenue per employee', () => {
    const metrics = valueAllMethods(profitable).metrics;
    expect(metrics.find((m) => m.label === 'Revenue per employee')!.value).toBe('$300K');
  });

  it('says a decline needs explaining rather than hiding it', () => {
    const metrics = valueAllMethods({ ...profitable, revenueGrowth: -0.15 }).metrics;
    const growth = metrics.find((m) => m.label === 'Revenue growth')!;

    expect(growth.value).toBe('-15.0%');
    expect(growth.interpretation).toMatch(/explanation/i);
  });

  it('lists what would most improve the estimate', () => {
    const sparse = valueAllMethods({
      industry: 'home_services',
      revenue: 100_000_000,
      sde: 10_000_000,
    });
    expect(sparse.missingInputs.length).toBeGreaterThan(2);
  });
});

describe('describeAskingPrice', () => {
  const range = { low: 300_000_000, high: 450_000_000 };

  it('recognises a price inside the range', () => {
    expect(describeAskingPrice(400_000_000, range).position).toBe('within');
  });

  it('recognises a price above it without objecting to it', () => {
    // The seller may know something the model does not. The platform's job is
    // to make sure they are choosing rather than guessing — never to refuse.
    const result = describeAskingPrice(600_000_000, range);

    expect(result.position).toBe('above');
    expect(result.message).toMatch(/good reasons/i);
    expect(result.message).not.toMatch(/too high|should not|cannot|reduce/i);
  });

  it('recognises a price below it', () => {
    const result = describeAskingPrice(100_000_000, range);
    expect(result.position).toBe('below');
    expect(result.message).toMatch(/deliberate/i);
  });

  it('says so when there is no estimate to compare against', () => {
    expect(describeAskingPrice(400_000_000, null).position).toBe('unknown');
  });

  it('never tells the seller what to charge', () => {
    // The whole point. A platform that directs pricing is giving advice it is
    // not qualified or licensed to give.
    for (const asking of [1, 100_000_000, 375_000_000, 900_000_000, 99_000_000_000]) {
      const { message } = describeAskingPrice(asking, range);
      expect(message).not.toMatch(/you should|we recommend|must be|price it at/i);
    }
  });
});
