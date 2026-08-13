import type { Cents } from '../format/money';

/**
 * Success fees, calculated.
 *
 * Deterministic arithmetic, like the valuation model and for the same reason:
 * this number appears on an invoice and gets disputed. A fee somebody cannot
 * reproduce on paper from the agreement they signed is a fee they will argue
 * about, and they will be right to.
 *
 * ## The formulas
 *
 * **Lehman** and **Double Lehman** are the conventions in this market. Lehman
 * is 5/4/3/2/1% on each successive million; Double Lehman is 10/8/6/4/2%. Both
 * are *marginal* — the rate applies to the slice of the price in that band, not
 * to the whole price — which is the part people get wrong, and getting it wrong
 * on a $4M deal is a difference of about $90,000.
 *
 * **Flat** is a single percentage of the whole price, common under about $2M.
 *
 * **Tiered** is a custom marginal schedule for firms that negotiate their own.
 *
 * ## The minimum fee
 *
 * The most commercially important line in this file. A $300,000 business at 10%
 * is $30,000, and running that deal properly costs more than that in time. The
 * minimum is what stops small deals losing money, and it is applied *after* the
 * schedule, so a deal below it pays the minimum rather than the calculated fee.
 *
 * ## What this is not
 *
 * Not a payment. Nothing here moves money — v1 records what is owed and to
 * whom. `CommissionResult` is deliberately shaped so a payment processor could
 * consume it later without the calculation changing.
 */

export type FeeStructure = 'lehman' | 'double_lehman' | 'flat' | 'tiered';

export interface FeeTier {
  /** The slice of the price this rate applies to, in cents. */
  upToCents: Cents | null;
  /** 0.05 is 5%. */
  rate: number;
}

export interface FeeAgreement {
  structure: FeeStructure;
  /** For `flat`. 0.10 is 10%. */
  flatRate?: number;
  /** For `tiered`. Ordered, ascending, last may be open-ended. */
  tiers?: FeeTier[];
  /** Applied after the schedule. The floor under any success fee. */
  minimumFeeCents?: Cents;
  /**
   * Split with a co-broker representing the other side. 0.5 is an even split.
   * Applied to the whole fee, which is the market convention.
   */
  coBrokerShare?: number;
}

export interface FeeBand {
  fromCents: Cents;
  /** Null on the open-ended top band. */
  toCents: Cents | null;
  rate: number;
  /** Price falling in this band. */
  amountCents: Cents;
  feeCents: Cents;
}

export interface CommissionResult {
  /** What the schedule produced, before the minimum. */
  calculatedFeeCents: Cents;
  /** What is actually owed. */
  totalFeeCents: Cents;
  /** True when the minimum fee raised it. */
  minimumApplied: boolean;
  /** The band-by-band working. This is the explanation shown on a statement. */
  bands: FeeBand[];
  /** What this firm keeps after any co-broker split. */
  netFeeCents: Cents;
  coBrokerFeeCents: Cents;
  /** Effective rate against the whole price, for comparison. */
  effectiveRate: number;
}

const MILLION: Cents = 100_000_000;

/** 5/4/3/2/1% on each successive million, then 1% on the remainder. */
const LEHMAN: FeeTier[] = [
  { upToCents: MILLION, rate: 0.05 },
  { upToCents: 2 * MILLION, rate: 0.04 },
  { upToCents: 3 * MILLION, rate: 0.03 },
  { upToCents: 4 * MILLION, rate: 0.02 },
  { upToCents: null, rate: 0.01 },
];

/** The lower-middle-market convention: 10/8/6/4/2%. */
const DOUBLE_LEHMAN: FeeTier[] = [
  { upToCents: MILLION, rate: 0.1 },
  { upToCents: 2 * MILLION, rate: 0.08 },
  { upToCents: 3 * MILLION, rate: 0.06 },
  { upToCents: 4 * MILLION, rate: 0.04 },
  { upToCents: null, rate: 0.02 },
];

export class CommissionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommissionInputError';
  }
}

export function calculateCommission(
  agreement: FeeAgreement,
  salePriceCents: Cents,
): CommissionResult {
  if (!Number.isInteger(salePriceCents) || salePriceCents < 0) {
    throw new CommissionInputError(
      'The sale price must be a whole number of cents, at least zero.',
    );
  }

  const tiers = tiersFor(agreement);
  const bands = computeBands(tiers, salePriceCents);

  const calculatedFeeCents = bands.reduce((sum, band) => sum + band.feeCents, 0);

  const minimum = agreement.minimumFeeCents ?? 0;
  // Applied only to a sale that happened. A zero-price deal owes nothing, and
  // charging a minimum on one would be charging for a transaction that did not
  // occur.
  const minimumApplied = salePriceCents > 0 && calculatedFeeCents < minimum;
  const totalFeeCents = minimumApplied ? minimum : calculatedFeeCents;

  const share = agreement.coBrokerShare ?? 0;
  if (share < 0 || share > 1) {
    throw new CommissionInputError('A co-broker share must be between 0 and 1.');
  }

  // Rounded once, at the end. Rounding each band would let the parts disagree
  // with the total by a few cents, which is exactly the kind of discrepancy
  // that makes somebody distrust the whole statement.
  const coBrokerFeeCents = Math.round(totalFeeCents * share);

  return {
    calculatedFeeCents,
    totalFeeCents,
    minimumApplied,
    bands,
    coBrokerFeeCents,
    netFeeCents: totalFeeCents - coBrokerFeeCents,
    effectiveRate: salePriceCents === 0 ? 0 : totalFeeCents / salePriceCents,
  };
}

function tiersFor(agreement: FeeAgreement): FeeTier[] {
  switch (agreement.structure) {
    case 'lehman':
      return LEHMAN;
    case 'double_lehman':
      return DOUBLE_LEHMAN;
    case 'flat': {
      const rate = agreement.flatRate;
      if (rate === undefined || rate < 0 || rate > 1) {
        throw new CommissionInputError('A flat fee needs a rate between 0 and 1.');
      }
      return [{ upToCents: null, rate }];
    }
    case 'tiered': {
      const tiers = agreement.tiers;
      if (!tiers || tiers.length === 0) {
        throw new CommissionInputError('A tiered fee needs at least one tier.');
      }
      assertTiersOrdered(tiers);
      return tiers;
    }
  }
}

/**
 * A malformed schedule is caught rather than silently producing a wrong fee.
 *
 * Out-of-order tiers do not throw anywhere else — they quietly compute
 * something plausible, and nobody notices until the invoice is disputed.
 */
function assertTiersOrdered(tiers: FeeTier[]): void {
  let previous = 0;

  for (const [index, tier] of tiers.entries()) {
    if (tier.rate < 0 || tier.rate > 1) {
      throw new CommissionInputError('Every tier rate must be between 0 and 1.');
    }

    if (tier.upToCents === null) {
      if (index !== tiers.length - 1) {
        throw new CommissionInputError('Only the last tier may be open-ended.');
      }
      continue;
    }

    if (!Number.isInteger(tier.upToCents) || tier.upToCents <= previous) {
      throw new CommissionInputError('Tier thresholds must ascend.');
    }
    previous = tier.upToCents;
  }
}

/**
 * Splits the price across the tiers.
 *
 * Marginal, not cliff-edge: each rate applies only to the slice of the price in
 * its band. This is the part of a Lehman schedule people implement wrong, and
 * on a $4M sale the difference between marginal and whole-price is around
 * $90,000 — so the bands are returned as working rather than just a total.
 */
function computeBands(tiers: FeeTier[], salePriceCents: Cents): FeeBand[] {
  const bands: FeeBand[] = [];
  let floor = 0;

  for (const tier of tiers) {
    if (floor >= salePriceCents) break;

    const ceiling = tier.upToCents ?? salePriceCents;
    const amountCents = Math.max(0, Math.min(salePriceCents, ceiling) - floor);

    if (amountCents > 0) {
      bands.push({
        fromCents: floor,
        toCents: tier.upToCents,
        rate: tier.rate,
        amountCents,
        feeCents: Math.round(amountCents * tier.rate),
      });
    }

    if (tier.upToCents === null) break;
    floor = tier.upToCents;
  }

  return bands;
}

/**
 * The named schedules, for a picker.
 *
 * Descriptions say what the structure does rather than which is better — the
 * platform is not a party to the engagement and should not be steering the rate
 * either side agrees to.
 */
export const FEE_STRUCTURES: Array<{
  value: FeeStructure;
  label: string;
  description: string;
}> = [
  {
    value: 'double_lehman',
    label: 'Double Lehman',
    description:
      '10% on the first million, then 8%, 6%, 4%, and 2% above four million. Each rate applies only to that slice of the price.',
  },
  {
    value: 'lehman',
    label: 'Lehman',
    description:
      '5% on the first million, then 4%, 3%, 2%, and 1% above four million. Marginal, as above.',
  },
  {
    value: 'flat',
    label: 'Flat percentage',
    description: 'One rate on the whole price. Common on smaller transactions.',
  },
  {
    value: 'tiered',
    label: 'Custom tiers',
    description: 'Your own marginal schedule, for an engagement that negotiated one.',
  },
];
