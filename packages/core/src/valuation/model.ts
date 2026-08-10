import type { Cents } from '../format/money';
import { industryProfile, type EarningsBasis, type IndustryKey } from './industries';

/**
 * Valuation model.
 *
 * A transparent multiple-of-earnings calculation, deliberately **not** an AI
 * output. Every number below is arithmetic a person can reproduce on paper from
 * the inputs and the adjustment table, and every adjustment states what moved
 * the multiple and by how much.
 *
 * That is a design decision worth being explicit about. A language model can
 * produce a plausible-looking valuation, but it cannot tell you why it landed
 * there, cannot be tested, and will give different answers to the same business
 * on different days. On a platform where someone may anchor the sale of their
 * life's work to this figure, a reproducible model whose assumptions the user
 * can edit is worth more than a fluent one.
 *
 * The AI layer's job sits around this, not inside it: explaining the factors in
 * prose, assembling market context, and flagging what is missing. The number
 * comes from here.
 *
 * ## What this is not
 *
 * Not an appraisal, not a fairness opinion, and not a recommendation to
 * transact at any price. It ignores everything diligence would find: quality of
 * earnings, working capital, deferred maintenance, litigation, customer
 * contracts that do not survive a change of control. Every consumer of this
 * output must render `<AIDisclaimer variant="valuation" />` alongside it.
 */

export interface ValuationInputs {
  industry: IndustryKey;

  /** Trailing twelve months revenue, integer cents. */
  revenue: Cents;
  /**
   * Seller's discretionary earnings, integer cents. Used when the industry
   * profile is quoted on SDE.
   */
  sde?: Cents;
  /** EBITDA, integer cents. Used when the industry profile is quoted on EBITDA. */
  ebitda?: Cents;

  /** Share of revenue from the single largest customer, 0–1. */
  customerConcentration?: number;
  /** Share of revenue that is contracted or subscription, 0–1. */
  recurringRevenueShare?: number;
  /** Year-over-year revenue growth, as a decimal. -0.1 is a 10% decline. */
  revenueGrowth?: number;
  yearsInBusiness?: number;
  /**
   * How dependent the business is on the current owner.
   * `absentee` — runs without them. `critical` — they are the business.
   */
  ownerDependence?: 'absentee' | 'moderate' | 'critical';
  /** Number of full-time equivalent employees. */
  employeeCount?: number;
}

/** One factor that moved the multiple, and by how much. */
export interface ValuationFactor {
  label: string;
  /** Added to the base multiple. Negative lowers the valuation. */
  multipleDelta: number;
  /** Plain-language reason, shown to the user. */
  explanation: string;
  /** `positive` and `negative` describe the effect on value. */
  direction: 'positive' | 'negative' | 'neutral';
}

export interface ValuationRange {
  low: Cents;
  high: Cents;
}

export interface ValuationResult {
  /**
   * The estimate. A range, always — there is deliberately no headline single
   * number anywhere in this type, because the moment one exists it becomes the
   * number people quote.
   */
  range: ValuationRange;
  basis: EarningsBasis;
  /** The earnings figure the multiple was applied to. */
  earnings: Cents;
  effectiveMultipleLow: number;
  effectiveMultipleHigh: number;
  baseMultipleLow: number;
  baseMultipleHigh: number;
  /** Every adjustment applied, in the order applied. This is the reasoning. */
  factors: ValuationFactor[];
  confidence: ConfidenceLevel;
  /** What would most improve the estimate, most valuable first. */
  missingInputs: string[];
  industryRationale: string;
}

export type ConfidenceLevel = 'low' | 'moderate' | 'indicative';

export class ValuationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValuationInputError';
  }
}

/**
 * Bounds on how far adjustments may move the base multiple.
 *
 * Without a floor, a business with several negative factors can compute to a
 * near-zero or negative multiple, which is not an estimate — it is the model
 * leaving the range where its heuristics mean anything. The clamp is a
 * statement that this model has a domain, not a correction to the arithmetic.
 */
const MIN_MULTIPLE = 0.75;
const MAX_ADJUSTMENT = 2.5;

export function estimateValuation(inputs: ValuationInputs): ValuationResult {
  const profile = industryProfile(inputs.industry);
  const earnings = selectEarnings(inputs, profile.basis);

  if (!Number.isInteger(inputs.revenue) || inputs.revenue < 0) {
    throw new ValuationInputError('Revenue must be a non-negative integer number of cents.');
  }

  if (earnings <= 0) {
    // A loss-making business is valued on assets, revenue multiples, or
    // strategic value to a specific buyer — none of which this model does.
    // Returning a number anyway would be worse than declining.
    throw new ValuationInputError(
      'This model values profitable businesses on an earnings multiple. ' +
        'A business at or below break-even needs an asset-based or revenue-based approach, ' +
        'and a conversation with an advisor.',
    );
  }

  const factors: ValuationFactor[] = [];

  // --- customer concentration --------------------------------------------
  //
  // The single largest driver of deal failure in this market. A business where
  // one customer is 40% of revenue is one phone call from being a different
  // business, and buyers price that heavily.
  if (inputs.customerConcentration !== undefined) {
    const share = clamp01(inputs.customerConcentration);
    if (share >= 0.5) {
      factors.push({
        label: 'Customer concentration',
        multipleDelta: -1.0,
        direction: 'negative',
        explanation:
          `The largest customer is ${pct(share)} of revenue. Buyers treat this as ` +
          'existential risk and will often require an earnout or escrow against it.',
      });
    } else if (share >= 0.3) {
      factors.push({
        label: 'Customer concentration',
        multipleDelta: -0.5,
        direction: 'negative',
        explanation:
          `The largest customer is ${pct(share)} of revenue, above the level most ` +
          'buyers are comfortable with.',
      });
    } else if (share <= 0.1) {
      factors.push({
        label: 'Diversified customer base',
        multipleDelta: 0.3,
        direction: 'positive',
        explanation:
          `No customer exceeds ${pct(share)} of revenue, so no single loss changes ` +
          'the business.',
      });
    }
  }

  // --- recurring revenue --------------------------------------------------
  if (inputs.recurringRevenueShare !== undefined) {
    const share = clamp01(inputs.recurringRevenueShare);
    if (share >= 0.6) {
      factors.push({
        label: 'Recurring revenue',
        multipleDelta: 0.8,
        direction: 'positive',
        explanation:
          `${pct(share)} of revenue is contracted or recurring, which buyers value ` +
          'well above the same revenue won transaction by transaction.',
      });
    } else if (share >= 0.3) {
      factors.push({
        label: 'Recurring revenue',
        multipleDelta: 0.4,
        direction: 'positive',
        explanation: `${pct(share)} of revenue is contracted or recurring.`,
      });
    }
  }

  // --- growth -------------------------------------------------------------
  if (inputs.revenueGrowth !== undefined) {
    const growth = inputs.revenueGrowth;
    if (growth >= 0.2) {
      factors.push({
        label: 'Revenue growth',
        multipleDelta: 0.6,
        direction: 'positive',
        explanation:
          `Revenue grew ${pct(growth)} year over year. Sustained growth is the ` +
          'clearest argument for the top of a range.',
      });
    } else if (growth >= 0.05) {
      factors.push({
        label: 'Revenue growth',
        multipleDelta: 0.25,
        direction: 'positive',
        explanation: `Revenue grew ${pct(growth)} year over year.`,
      });
    } else if (growth <= -0.1) {
      factors.push({
        label: 'Revenue decline',
        multipleDelta: -0.8,
        direction: 'negative',
        explanation:
          `Revenue declined ${pct(Math.abs(growth))} year over year. Buyers will ` +
          'want to understand whether this is a trend before agreeing a multiple.',
      });
    } else if (growth < 0) {
      factors.push({
        label: 'Revenue decline',
        multipleDelta: -0.4,
        direction: 'negative',
        explanation: `Revenue declined ${pct(Math.abs(growth))} year over year.`,
      });
    }
  }

  // --- owner dependence ---------------------------------------------------
  //
  // What is actually being sold is the business without its owner. The more of
  // it walks out of the door with them, the less there is to buy.
  if (inputs.ownerDependence !== undefined) {
    if (inputs.ownerDependence === 'absentee') {
      factors.push({
        label: 'Runs without the owner',
        multipleDelta: 0.7,
        direction: 'positive',
        explanation:
          'A management team already runs the business, so what a buyer acquires is what ' +
          'they keep.',
      });
    } else if (inputs.ownerDependence === 'critical') {
      factors.push({
        label: 'Owner dependence',
        multipleDelta: -0.8,
        direction: 'negative',
        explanation:
          'The business depends heavily on the current owner. Buyers price this down and ' +
          'commonly require a transition period or earnout.',
      });
    }
  }

  // --- durability ---------------------------------------------------------
  if (inputs.yearsInBusiness !== undefined) {
    if (inputs.yearsInBusiness >= 15) {
      factors.push({
        label: 'Long operating history',
        multipleDelta: 0.3,
        direction: 'positive',
        explanation: `${inputs.yearsInBusiness} years of trading through at least one downturn.`,
      });
    } else if (inputs.yearsInBusiness < 3) {
      factors.push({
        label: 'Short operating history',
        multipleDelta: -0.5,
        direction: 'negative',
        explanation:
          `${inputs.yearsInBusiness} years of trading is too short for a buyer to ` +
          'judge how earnings behave across a cycle.',
      });
    }
  }

  // --- scale --------------------------------------------------------------
  //
  // Larger businesses trade at higher multiples than otherwise identical
  // smaller ones — more buyers can finance them, and each has more competition.
  const earningsDollars = earnings / 100;
  if (earningsDollars >= 3_000_000) {
    factors.push({
      label: 'Scale',
      multipleDelta: 0.8,
      direction: 'positive',
      explanation:
        'At this earnings level private equity and strategic acquirers compete for the asset, ' +
        'which lifts multiples relative to smaller businesses in the same sector.',
    });
  } else if (earningsDollars >= 1_000_000) {
    factors.push({
      label: 'Scale',
      multipleDelta: 0.4,
      direction: 'positive',
      explanation: 'Earnings above $1M widen the buyer pool beyond individual operators.',
    });
  } else if (earningsDollars < 250_000) {
    factors.push({
      label: 'Scale',
      multipleDelta: -0.4,
      direction: 'negative',
      explanation:
        'Below $250K of earnings the buyer pool is mostly individuals, and financing is harder.',
    });
  }

  const rawAdjustment = factors.reduce((sum, factor) => sum + factor.multipleDelta, 0);
  const adjustment = clamp(rawAdjustment, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);

  const effectiveLow = Math.max(MIN_MULTIPLE, profile.multipleLow + adjustment);
  const effectiveHigh = Math.max(effectiveLow + 0.5, profile.multipleHigh + adjustment);

  const missingInputs = describeMissingInputs(inputs);

  return {
    range: {
      low: Math.round(earnings * effectiveLow),
      high: Math.round(earnings * effectiveHigh),
    },
    basis: profile.basis,
    earnings,
    effectiveMultipleLow: round2(effectiveLow),
    effectiveMultipleHigh: round2(effectiveHigh),
    baseMultipleLow: profile.multipleLow,
    baseMultipleHigh: profile.multipleHigh,
    factors,
    confidence: assessConfidence(inputs, missingInputs.length),
    missingInputs,
    industryRationale: profile.rationale,
  };
}

function selectEarnings(inputs: ValuationInputs, basis: EarningsBasis): Cents {
  const value = basis === 'sde' ? inputs.sde : inputs.ebitda;

  if (value === undefined) {
    throw new ValuationInputError(
      basis === 'sde'
        ? 'This industry is valued on SDE (seller’s discretionary earnings). Provide an SDE figure.'
        : 'This industry is valued on EBITDA. Provide an EBITDA figure.',
    );
  }

  if (!Number.isInteger(value)) {
    throw new ValuationInputError('Earnings must be an integer number of cents.');
  }

  return value;
}

/**
 * Confidence describes how much of the picture the inputs cover — not how
 * accurate the answer is. No amount of input makes this an appraisal, which is
 * why the top level is called `indicative` rather than `high`.
 */
function assessConfidence(inputs: ValuationInputs, missingCount: number): ConfidenceLevel {
  if (missingCount >= 4) return 'low';
  if (missingCount >= 2) return 'moderate';
  if (inputs.industry === 'other') return 'moderate';
  return 'indicative';
}

function describeMissingInputs(inputs: ValuationInputs): string[] {
  const missing: string[] = [];

  // Ordered by how much each one moves the range.
  if (inputs.customerConcentration === undefined) {
    missing.push('Share of revenue from your largest customer — the single biggest driver here');
  }
  if (inputs.ownerDependence === undefined) {
    missing.push('How much the business depends on you day to day');
  }
  if (inputs.revenueGrowth === undefined) {
    missing.push('Year-over-year revenue growth');
  }
  if (inputs.recurringRevenueShare === undefined) {
    missing.push('Share of revenue that is contracted or recurring');
  }
  if (inputs.yearsInBusiness === undefined) {
    missing.push('Years in business');
  }

  return missing;
}

const clamp01 = (value: number): number => clamp(value, 0, 1);
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;
const pct = (value: number): string => `${Math.round(value * 100)}%`;
