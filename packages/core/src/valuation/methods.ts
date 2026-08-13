import type { Cents } from '../format/money';
import { industryProfile } from './industries';
import {
  estimateValuation,
  ValuationInputError,
  type ValuationInputs,
  type ValuationRange,
} from './model';

/**
 * Valuing a business several ways at once.
 *
 * `estimateValuation()` applies one earnings multiple and is the primary
 * method. It is also, on its own, misleading — a single range invites the
 * reader to treat it as *the* answer, and businesses are not valued that way.
 * A buyer will look at earnings multiple, revenue multiple, and what the assets
 * are worth, and the spread between those numbers is itself information.
 *
 * So this returns several methods with their assumptions, marks which apply,
 * and says plainly when they disagree. Where the earnings method refuses — a
 * business at or below break-even — the others still say something useful,
 * which is exactly the case where the seller most needs a number and currently
 * gets an error.
 *
 * ## The asking price is not gated by any of this
 *
 * A seller may list at any price they like. These figures inform that decision
 * and never constrain it: sellers know things the model does not, and a
 * platform that refused a price above its own estimate would be substituting
 * its judgement for the owner's on the sale of their own business.
 *
 * What the platform does do is show a buyer the same methods, so both sides are
 * arguing about the same arithmetic.
 */

export type ValuationMethodKey = 'earnings_multiple' | 'revenue_multiple' | 'asset_based';

export interface MethodResult {
  key: ValuationMethodKey;
  label: string;
  /** Null when the method does not apply to this business. */
  range: ValuationRange | null;
  /** Why it applies, or why it does not. Always populated. */
  rationale: string;
  /** What the multiple was applied to, for the methods that use one. */
  basisLabel?: string;
  multipleLow?: number;
  multipleHigh?: number;
  /**
   * How much weight this method deserves for this business. 0 when it does not
   * apply. Used to order them, never to blend them into one number.
   */
  weight: number;
}

export interface AssetInputs {
  /** Equipment, vehicles, fixtures — what a buyer would replace. */
  tangibleAssets?: Cents;
  /** Stock on hand at cost. */
  inventory?: Cents;
  /** Debt that transfers with the business. */
  liabilities?: Cents;
}

export interface MultiMethodInputs extends ValuationInputs, AssetInputs {}

export interface DerivedMetric {
  label: string;
  value: string;
  /** What a buyer reads into it. Empty for purely descriptive metrics. */
  interpretation?: string;
}

export interface MultiMethodValuation {
  methods: MethodResult[];
  /** The methods that produced a range, best-supported first. */
  applicable: MethodResult[];
  /** Widest low and highest high across applicable methods. */
  overall: ValuationRange | null;
  /** True when the methods disagree enough to be worth saying so. */
  methodsDisagree: boolean;
  metrics: DerivedMetric[];
  /** Ordered by how much each would improve the picture. */
  missingInputs: string[];
}

/**
 * Revenue multiples by industry basis.
 *
 * Deliberately crude and labelled as such. A revenue multiple ignores whether
 * the business makes money, which is why it is the fallback rather than the
 * primary method — but for a business at break-even it is often the only thing
 * a buyer will anchor on, and saying nothing is worse than saying "this is
 * rough".
 */
const REVENUE_MULTIPLE_BY_MARGIN: Array<{ minMargin: number; low: number; high: number }> = [
  { minMargin: 0.3, low: 1.2, high: 2.2 },
  { minMargin: 0.2, low: 0.9, high: 1.6 },
  { minMargin: 0.1, low: 0.6, high: 1.1 },
  { minMargin: 0.05, low: 0.4, high: 0.8 },
  { minMargin: -Infinity, low: 0.2, high: 0.5 },
];

export function valueAllMethods(inputs: MultiMethodInputs): MultiMethodValuation {
  const methods: MethodResult[] = [
    earningsMethod(inputs),
    revenueMethod(inputs),
    assetMethod(inputs),
  ];

  const applicable = methods
    .filter((method) => method.range !== null)
    .sort((a, b) => b.weight - a.weight);

  const overall = combineRanges(applicable);

  return {
    methods,
    applicable,
    overall,
    methodsDisagree: rangesDisagree(applicable),
    metrics: deriveMetrics(inputs),
    missingInputs: missingFor(inputs),
  };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

function earningsMethod(inputs: MultiMethodInputs): MethodResult {
  const profile = industryProfile(inputs.industry);
  const basisLabel = profile.basis === 'sde' ? "Seller's discretionary earnings" : 'EBITDA';

  try {
    const result = estimateValuation(inputs);

    return {
      key: 'earnings_multiple',
      label: 'Multiple of earnings',
      range: result.range,
      basisLabel,
      multipleLow: result.effectiveMultipleLow,
      multipleHigh: result.effectiveMultipleHigh,
      rationale:
        'How buyers of profitable small businesses price them, and the method that carries ' +
        'the most weight when it applies. Every adjustment to the multiple is itemised.',
      // Highest weight by a distance. The others are cross-checks.
      weight: 1,
    };
  } catch (error) {
    if (!(error instanceof ValuationInputError)) throw error;

    return {
      key: 'earnings_multiple',
      label: 'Multiple of earnings',
      range: null,
      basisLabel,
      rationale:
        'Does not apply: this method values profitable businesses, and the earnings figure ' +
        'given is at or below break-even. The methods below are what a buyer would use instead.',
      weight: 0,
    };
  }
}

function revenueMethod(inputs: MultiMethodInputs): MethodResult {
  if (inputs.revenue <= 0) {
    return {
      key: 'revenue_multiple',
      label: 'Multiple of revenue',
      range: null,
      rationale: 'Does not apply: no revenue figure.',
      weight: 0,
    };
  }

  const earnings = inputs.sde ?? inputs.ebitda ?? 0;
  const margin = earnings / inputs.revenue;
  const band =
    REVENUE_MULTIPLE_BY_MARGIN.find((entry) => margin >= entry.minMargin) ??
    REVENUE_MULTIPLE_BY_MARGIN[REVENUE_MULTIPLE_BY_MARGIN.length - 1]!;

  return {
    key: 'revenue_multiple',
    label: 'Multiple of revenue',
    range: {
      low: Math.round(inputs.revenue * band.low),
      high: Math.round(inputs.revenue * band.high),
    },
    basisLabel: 'Trailing twelve months revenue',
    multipleLow: band.low,
    multipleHigh: band.high,
    rationale:
      'A rough cross-check. It ignores whether the business actually makes money, so the ' +
      'range is set by your margin — but it is the method a buyer falls back on when ' +
      'earnings are thin or hard to verify.',
    // A cross-check when earnings work, the main event when they do not.
    weight: earnings > 0 ? 0.4 : 0.8,
  };
}

function assetMethod(inputs: MultiMethodInputs): MethodResult {
  const tangible = inputs.tangibleAssets ?? 0;
  const inventory = inputs.inventory ?? 0;
  const liabilities = inputs.liabilities ?? 0;

  if (tangible === 0 && inventory === 0) {
    return {
      key: 'asset_based',
      label: 'Asset value',
      range: null,
      rationale:
        'Not calculated: no asset figures given. Worth filling in if the business owns ' +
        'equipment, vehicles or stock — it sets a floor under the other methods.',
      weight: 0,
    };
  }

  const net = tangible + inventory - liabilities;
  if (net <= 0) {
    return {
      key: 'asset_based',
      label: 'Asset value',
      range: null,
      rationale:
        'Does not apply: liabilities exceed the assets given, so this method sets no floor.',
      weight: 0,
    };
  }

  return {
    key: 'asset_based',
    label: 'Asset value',
    // A range rather than a point: liquidation and going-concern values differ,
    // and quoting one number implies a precision that book values do not carry.
    range: { low: Math.round(net * 0.7), high: net },
    rationale:
      'What the tangible assets are worth, less debt that transfers. This is a floor rather ' +
      'than a valuation — a profitable business should be worth more than its equipment. ' +
      'The lower end assumes a quick sale.',
    weight: 0.3,
  };
}

// ---------------------------------------------------------------------------

function combineRanges(methods: MethodResult[]): ValuationRange | null {
  const ranges = methods.map((m) => m.range).filter((r): r is ValuationRange => r !== null);
  if (ranges.length === 0) return null;

  return {
    low: Math.min(...ranges.map((r) => r.low)),
    high: Math.max(...ranges.map((r) => r.high)),
  };
}

/**
 * Whether the methods are far enough apart to be worth flagging.
 *
 * Compares the two best-supported methods. Overlapping ranges agree; ranges
 * that do not touch are telling the seller something — usually that the
 * business is asset-heavy relative to what it earns, or the reverse.
 */
function rangesDisagree(methods: MethodResult[]): boolean {
  const [first, second] = methods;
  if (!first?.range || !second?.range) return false;

  return first.range.high < second.range.low || second.range.high < first.range.low;
}

function deriveMetrics(inputs: MultiMethodInputs): DerivedMetric[] {
  const metrics: DerivedMetric[] = [];
  const earnings = inputs.sde ?? inputs.ebitda ?? 0;

  if (inputs.revenue > 0 && earnings !== 0) {
    const margin = earnings / inputs.revenue;
    metrics.push({
      label: 'Profit margin',
      value: `${(margin * 100).toFixed(1)}%`,
      interpretation:
        margin >= 0.2
          ? 'Strong. Buyers will look for what is keeping it there.'
          : margin >= 0.1
            ? 'Typical for most service businesses.'
            : margin > 0
              ? 'Thin. Leaves little room for a buyer servicing debt.'
              : 'Negative. The earnings method does not apply.',
    });
  }

  if (inputs.employeeCount && inputs.employeeCount > 0 && inputs.revenue > 0) {
    metrics.push({
      label: 'Revenue per employee',
      value: formatCompact(Math.round(inputs.revenue / inputs.employeeCount)),
      interpretation: 'A rough read on how labour-intensive the business is.',
    });
  }

  if (inputs.recurringRevenueShare !== undefined) {
    metrics.push({
      label: 'Recurring revenue',
      value: `${Math.round(inputs.recurringRevenueShare * 100)}%`,
      interpretation:
        inputs.recurringRevenueShare >= 0.5
          ? 'High. This is the single biggest lever on the multiple.'
          : 'Buyers pay more for contracted revenue than for repeat goodwill.',
    });
  }

  if (inputs.customerConcentration !== undefined) {
    metrics.push({
      label: 'Largest customer',
      value: `${Math.round(inputs.customerConcentration * 100)}% of revenue`,
      interpretation:
        inputs.customerConcentration >= 0.3
          ? 'A buyer will price the risk that this customer leaves after the sale.'
          : 'Well spread, which lowers perceived risk.',
    });
  }

  if (inputs.revenueGrowth !== undefined) {
    metrics.push({
      label: 'Revenue growth',
      value: `${(inputs.revenueGrowth * 100).toFixed(1)}%`,
      interpretation:
        inputs.revenueGrowth < 0
          ? 'A decline needs an explanation a buyer can verify.'
          : 'Growth supports the upper end of the range.',
    });
  }

  return metrics;
}

function missingFor(inputs: MultiMethodInputs): string[] {
  const missing: string[] = [];

  if (inputs.sde === undefined && inputs.ebitda === undefined) {
    missing.push('Earnings — SDE or EBITDA. Without it only the revenue method applies.');
  }
  if (inputs.recurringRevenueShare === undefined) {
    missing.push('Share of revenue that is contracted or repeat. The largest single lever.');
  }
  if (inputs.customerConcentration === undefined) {
    missing.push('Share of revenue from your largest customer. Buyers ask first.');
  }
  if (inputs.tangibleAssets === undefined && inputs.inventory === undefined) {
    missing.push('Equipment and inventory values. These set a floor under the estimate.');
  }
  if (inputs.revenueGrowth === undefined) {
    missing.push('How revenue moved last year.');
  }

  return missing;
}

/** `$4.2M`. Local to avoid importing the money formatter's stricter checks here. */
function formatCompact(cents: Cents): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return `$${Math.round(dollars)}`;
}

/**
 * How an asking price sits against the estimate.
 *
 * Returns a description, never a verdict. A seller who prices above the range
 * may know something the model does not — a strategic buyer already circling,
 * a contract about to be signed, a piece of land under the building. The
 * platform's job is to make sure they are choosing rather than guessing.
 */
export function describeAskingPrice(
  asking: Cents,
  overall: ValuationRange | null,
): { position: 'below' | 'within' | 'above' | 'unknown'; message: string } {
  if (!overall) {
    return {
      position: 'unknown',
      message: 'Not enough information yet to compare this with an estimate.',
    };
  }

  if (asking < overall.low) {
    return {
      position: 'below',
      message:
        'Below the estimated range. That may be deliberate — a quick, clean sale is worth ' +
        'something — but it is worth being sure you meant to.',
    };
  }

  if (asking > overall.high) {
    return {
      position: 'above',
      message:
        'Above the estimated range. Sellers price above an estimate for good reasons all the ' +
        'time; expect buyers to ask what they are, and have the answer ready.',
    };
  }

  return {
    position: 'within',
    message: 'Within the estimated range.',
  };
}
