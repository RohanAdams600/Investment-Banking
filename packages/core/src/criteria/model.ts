import type { Cents } from '../format/money';
import type { IndustryKey } from '../valuation/industries';

/**
 * Buyer acquisition criteria, and how a listing scores against them.
 *
 * This is the object the specification calls for as shared ground between the
 * search fund, private equity and family office portals. They differ in the
 * fields their intake collects and their privacy defaults, not in what a match
 * means — so the criteria live here once, and the portals are views over them.
 *
 * The scoring below is deterministic and explainable by construction: it
 * returns the reasons alongside the number. That is a requirement, not a
 * nicety. A buyer being told a business is an 82% fit and not why is being
 * asked to trust a black box about the largest purchase of their career, and
 * the spec is explicit that the top contributing factors are always shown.
 *
 * Semantic similarity over free-text theses is a later addition. It belongs
 * *alongside* this, not instead of it — an embedding can tell you two
 * descriptions are alike but cannot tell you the deal is out of the buyer's
 * price range.
 */

export type DealStructurePreference = 'asset' | 'stock' | 'either';
export type InvolvementPreference = 'owner_operator' | 'passive' | 'either';

export interface AcquisitionCriteria {
  /** Empty means no industry preference, which is different from all of them. */
  industries: IndustryKey[];
  /** US state codes, e.g. `US-TX`. Empty means anywhere. */
  jurisdictions: string[];

  revenueMin?: Cents;
  revenueMax?: Cents;
  earningsMin?: Cents;
  earningsMax?: Cents;
  /** What the buyer can actually deploy, including debt. */
  dealSizeMax?: Cents;

  dealStructure: DealStructurePreference;
  involvement: InvolvementPreference;

  /** Above this share of revenue from one customer, the buyer walks. 0–1. */
  maxCustomerConcentration?: number;
  /** Below this share of recurring revenue, the buyer is not interested. 0–1. */
  minRecurringRevenueShare?: number;

  /** Free text. Feeds the AI layer; never the arithmetic below. */
  thesis?: string;
}

/** The subset of a listing that criteria are scored against. */
export interface ListingProfile {
  industry: IndustryKey;
  jurisdiction: string;
  revenue: Cents;
  earnings: Cents;
  askingPrice?: Cents;
  dealStructure: 'asset' | 'stock';
  customerConcentration?: number;
  recurringRevenueShare?: number;
  ownerDependence?: 'absentee' | 'moderate' | 'critical';
}

export interface FitReason {
  label: string;
  detail: string;
  /** How much this contributed, in score points. Negative for misses. */
  points: number;
}

export interface FitResult {
  /** 0–100. */
  score: number;
  /** True when the listing violates something the buyer said was a hard limit. */
  excluded: boolean;
  /** Why it was excluded — empty unless `excluded`. */
  exclusionReasons: string[];
  /** The three largest contributors, best first. Shown with every score. */
  topReasons: FitReason[];
  /** Everything considered, for the detail view. */
  allReasons: FitReason[];
}

/**
 * Weights, stated in one place so the model can be reasoned about rather than
 * reverse-engineered from the code below.
 *
 * Size and industry dominate because they are what actually disqualifies a deal
 * in this market. A buyer will stretch on geography far more readily than on
 * whether they can afford it.
 */
const WEIGHTS = {
  industry: 30,
  size: 30,
  geography: 15,
  structure: 10,
  quality: 15,
} as const;

export function scoreFit(criteria: AcquisitionCriteria, listing: ListingProfile): FitResult {
  const reasons: FitReason[] = [];
  const exclusionReasons: string[] = [];

  // --- hard limits --------------------------------------------------------
  //
  // Checked first and separately from scoring. A buyer who says "never above
  // 40% customer concentration" has stated a constraint, not a preference, and
  // surfacing such a listing at 71% fit teaches them to distrust the score.
  if (
    criteria.maxCustomerConcentration !== undefined &&
    listing.customerConcentration !== undefined &&
    listing.customerConcentration > criteria.maxCustomerConcentration
  ) {
    exclusionReasons.push(
      `Largest customer is ${pct(listing.customerConcentration)} of revenue, above your ` +
        `${pct(criteria.maxCustomerConcentration)} limit.`,
    );
  }

  if (criteria.dealSizeMax !== undefined && listing.askingPrice !== undefined) {
    if (listing.askingPrice > criteria.dealSizeMax) {
      exclusionReasons.push('Asking price is above the maximum deal size you set.');
    }
  }

  if (
    criteria.minRecurringRevenueShare !== undefined &&
    listing.recurringRevenueShare !== undefined &&
    listing.recurringRevenueShare < criteria.minRecurringRevenueShare
  ) {
    exclusionReasons.push(
      `Recurring revenue is ${pct(listing.recurringRevenueShare)}, below your ` +
        `${pct(criteria.minRecurringRevenueShare)} minimum.`,
    );
  }

  // --- industry -----------------------------------------------------------
  if (criteria.industries.length === 0) {
    reasons.push({
      label: 'Industry',
      detail: 'You have not narrowed by industry, so this does not count for or against.',
      points: WEIGHTS.industry * 0.5,
    });
  } else if (criteria.industries.includes(listing.industry)) {
    reasons.push({
      label: 'Industry match',
      detail: 'This sector is on your list.',
      points: WEIGHTS.industry,
    });
  } else {
    reasons.push({
      label: 'Industry mismatch',
      detail: 'This sector is not among those you named.',
      points: 0,
    });
  }

  // --- size ---------------------------------------------------------------
  const revenueFit = bandFit(listing.revenue, criteria.revenueMin, criteria.revenueMax);
  const earningsFit = bandFit(listing.earnings, criteria.earningsMin, criteria.earningsMax);
  const sizeFit = (revenueFit + earningsFit) / 2;

  reasons.push({
    label:
      sizeFit >= 0.9
        ? 'Size fits your range'
        : sizeFit >= 0.5
          ? 'Size is near your range'
          : 'Size is outside your range',
    detail: describeSizeFit(sizeFit),
    points: WEIGHTS.size * sizeFit,
  });

  // --- geography ----------------------------------------------------------
  if (criteria.jurisdictions.length === 0) {
    reasons.push({
      label: 'Geography',
      detail: 'You have not restricted by location.',
      points: WEIGHTS.geography * 0.5,
    });
  } else if (criteria.jurisdictions.includes(listing.jurisdiction)) {
    reasons.push({
      label: 'Location match',
      detail: 'This business is in a state you named.',
      points: WEIGHTS.geography,
    });
  } else {
    reasons.push({
      label: 'Outside your geography',
      detail: 'This business is not in a state you named.',
      points: 0,
    });
  }

  // --- structure ----------------------------------------------------------
  if (criteria.dealStructure === 'either' || criteria.dealStructure === listing.dealStructure) {
    reasons.push({
      label: 'Deal structure',
      detail:
        criteria.dealStructure === 'either'
          ? 'You are open on structure.'
          : `Offered as a ${listing.dealStructure} sale, which is what you prefer.`,
      points: WEIGHTS.structure,
    });
  } else {
    reasons.push({
      label: 'Structure mismatch',
      detail:
        `Offered as a ${listing.dealStructure} sale; you prefer ${criteria.dealStructure}. ` +
        'Structure is often negotiable, so this is a discussion rather than a barrier.',
      points: WEIGHTS.structure * 0.25,
    });
  }

  // --- quality signals ----------------------------------------------------
  let qualityFraction = 0.5;
  const qualityNotes: string[] = [];

  if (listing.customerConcentration !== undefined) {
    if (listing.customerConcentration <= 0.15) {
      qualityFraction += 0.25;
      qualityNotes.push('customer base is well diversified');
    } else if (listing.customerConcentration >= 0.4) {
      qualityFraction -= 0.25;
      qualityNotes.push(`largest customer is ${pct(listing.customerConcentration)} of revenue`);
    }
  }

  if (criteria.involvement !== 'either' && listing.ownerDependence !== undefined) {
    const wantsPassive = criteria.involvement === 'passive';
    const runsWithoutOwner = listing.ownerDependence === 'absentee';

    if (wantsPassive && runsWithoutOwner) {
      qualityFraction += 0.25;
      qualityNotes.push('already runs without the owner, which suits a passive holder');
    } else if (wantsPassive && listing.ownerDependence === 'critical') {
      qualityFraction -= 0.25;
      qualityNotes.push(
        'depends heavily on the current owner, which a passive buyer cannot absorb',
      );
    }
  }

  qualityFraction = clamp(qualityFraction, 0, 1);
  reasons.push({
    label: 'Business quality',
    detail:
      qualityNotes.length > 0
        ? capitalise(qualityNotes.join('; ')) + '.'
        : 'Not enough detail published yet to judge quality signals.',
    points: WEIGHTS.quality * qualityFraction,
  });

  const total = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const score = Math.round(clamp(total, 0, 100));

  const ranked = [...reasons].sort((a, b) => b.points - a.points);

  return {
    score: exclusionReasons.length > 0 ? 0 : score,
    excluded: exclusionReasons.length > 0,
    exclusionReasons,
    topReasons: ranked.slice(0, 3),
    allReasons: reasons,
  };
}

/**
 * How well a value sits inside a band, 0–1.
 *
 * Deliberately not a step function. A business 5% above a buyer's stated
 * ceiling is very nearly what they asked for, and a hard cutoff would hide it
 * entirely — buyers state round numbers, not precise thresholds. Hard limits
 * are handled separately above, where the buyer has actually said "never".
 */
function bandFit(value: Cents, min?: Cents, max?: Cents): number {
  if (min === undefined && max === undefined) return 0.5;

  if (min !== undefined && value < min) {
    const shortfall = (min - value) / min;
    return clamp(1 - shortfall * 2, 0, 1);
  }

  if (max !== undefined && value > max) {
    const excess = (value - max) / max;
    return clamp(1 - excess * 2, 0, 1);
  }

  return 1;
}

function describeSizeFit(fit: number): string {
  if (fit >= 0.9) return 'Revenue and earnings both sit inside the range you set.';
  if (fit >= 0.5) return 'Revenue or earnings sits a little outside the range you set.';
  return 'Revenue and earnings are well outside the range you set.';
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const pct = (value: number): string => `${Math.round(value * 100)}%`;
const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
