import type { Cents } from '../format/money';

/**
 * Step one of the pipeline: what is actually wrong with this listing.
 *
 * The specification's workflow starts "analyse the business details and
 * financials submitted by the seller", and the obvious way to build that is to
 * hand everything to a model and print what it says back. This does not do
 * that, for two reasons.
 *
 * **The confidential figures may not leave.** A proper analysis needs the exact
 * revenue, the customer concentration, the owner's role — the NDA-gated half.
 * Sending those to a provider is a disclosure to a subprocessor the seller never
 * agreed to, and no retention setting undoes it. So the arithmetic runs here,
 * inside our own process.
 *
 * **A finding has to be checkable.** "Your customer concentration is a concern"
 * from a model is an opinion the seller cannot argue with. "Your top customer is
 * 60% of revenue, and buyers usually treat anything over 30% as a risk that
 * needs explaining" is a fact plus a stated convention, and the seller can
 * disagree with the convention out loud.
 *
 * So every finding here is deterministic, carries the number that produced it,
 * and says which threshold it crossed. The model's job — if one is configured
 * at all — is to write the covering paragraph, not to decide what is true.
 */

/**
 * Named `ReadinessSeverity` rather than `FindingSeverity` because
 * `packages/core/src/legal` already exports the latter for clause review. Two
 * different scales called the same thing in one barrel export is a collision
 * the compiler catches once and a reader misreads forever.
 */
export type ReadinessSeverity =
  /** The listing cannot go to market like this. */
  | 'blocking'
  /** It can, and it will get fewer and worse offers. */
  | 'important'
  /** Worth knowing. Not worth delaying for. */
  | 'note';

export interface ReadinessFinding {
  code: string;
  severity: ReadinessSeverity;
  /** What is true, in one sentence. */
  title: string;
  /** The number or absence that produced it. Never a judgement on its own. */
  evidence: string;
  /** What to do about it. Always actionable, never "consider improving". */
  action: string;
}

export interface ListingSnapshot {
  headline: string | null;
  industry: string | null;
  jurisdictionCode: string | null;
  askingPriceCents: Cents | null;

  /** The confidential half, if the seller has filled it in. */
  hasProfile: boolean;
  legalName: string | null;
  revenueCents: Cents | null;
  sdeCents: Cents | null;
  ebitdaCents: Cents | null;

  /** Fraction, 0–1. The share of revenue from the largest customer. */
  customerConcentration: number | null;
  /** How much the business depends on the current owner, 1–5. */
  ownerDependence: number | null;

  employeeCount: number | null;
  yearsInBusiness: number | null;

  /** How many fiscal years of figures have been entered. */
  financialYears: number;
  /** Whether the most recent year is within the last 18 months. */
  financialsAreRecent: boolean;
}

/**
 * The thresholds, in one place and named.
 *
 * These are market conventions rather than laws, and a broker with twenty years
 * in home services will disagree with some of them. That is exactly why they are
 * constants with names instead of numbers buried in conditionals: disagreeing
 * with a threshold should be a one-line change somebody can review, not an
 * archaeology exercise.
 */
export const READINESS_THRESHOLDS = {
  /** Above this share of revenue from one customer, buyers start discounting. */
  customerConcentration: 0.3,
  /** And above this, many walk. */
  severeConcentration: 0.5,
  /** Owner dependence, 1–5, at which a buyer needs a transition plan. */
  ownerDependence: 4,
  /** Years of figures a buyer expects before taking a listing seriously. */
  expectedFinancialYears: 3,
  /** Below this, the earnings multiple methods stop being meaningful. */
  minimumMeaningfulSde: 5_000_000,
} as const;

/**
 * Words that carry no identity, because almost every company name contains one.
 *
 * Without this list, "Anchor Route Services LLC" and the headline "established
 * home services business" share the word "services" and every anonymous
 * headline in the industry gets flagged.
 */
const GENERIC_NAME_WORDS = new Set([
  'llc',
  'inc',
  'ltd',
  'corp',
  'corporation',
  'company',
  'the',
  'and',
  'for',
  'of',
  'group',
  'holdings',
  'enterprises',
  'industries',
  'international',
  'national',
  'global',
  'service',
  'services',
  'solutions',
  'systems',
  'partners',
  'associates',
  'brothers',
  'sons',
  'works',
  'supply',
  'management',
]);

function distinctiveWords(name: string): string[] {
  return [
    ...new Set(
      name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !GENERIC_NAME_WORDS.has(word)),
    ),
  ];
}

/**
 * Whether the headline appears to name the business.
 *
 * The single most common way a confidential listing stops being confidential is
 * the seller putting the company name in the headline. It is not malice: the
 * headline is the first field, and naming the thing is the natural way to
 * describe it.
 *
 * The rule is **two distinctive words, or the only one there is**. A single
 * shared word is a coincidence — a route business is described as route-based
 * whether or not the company is called Anchor Route Services — and flagging on
 * one would put a warning on correctly-written headlines, which is how a
 * warning becomes something people click past.
 *
 * Matching is on whole tokens rather than substrings, so "Anchor's" counts and
 * "rerouted" does not.
 */
export function headlineNamesBusiness(headline: string | null, legalName: string | null): boolean {
  if (!headline || !legalName) return false;

  const distinctive = distinctiveWords(legalName);
  if (distinctive.length === 0) return false;

  const tokens = new Set(headline.toLowerCase().split(/[^a-z0-9]+/));
  const matches = distinctive.filter((word) => tokens.has(word)).length;

  return matches >= Math.min(2, distinctive.length);
}

/**
 * Everything wrong with this listing, worst first.
 *
 * Returns an empty array for a listing that is ready, which is a real and
 * common outcome — a checker that always finds something is a checker people
 * learn to ignore.
 */
export function analyseReadiness(listing: ListingSnapshot): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];

  // --- blocking ------------------------------------------------------------

  if (!listing.hasProfile) {
    findings.push({
      code: 'no_profile',
      severity: 'blocking',
      title: 'The confidential profile is empty',
      evidence: 'No legal name, address or exact figures have been entered.',
      action:
        'Fill in the confidential half. Buyers see none of it until you issue an NDA, and without it there is nothing to release.',
    });
  }

  if (listing.financialYears === 0) {
    findings.push({
      code: 'no_financials',
      severity: 'blocking',
      title: 'No financial years have been entered',
      evidence: 'Zero years of revenue or earnings on record.',
      action: 'Add at least one full year. A listing with no numbers cannot be valued or matched.',
    });
  }

  if (headlineNamesBusiness(listing.headline, listing.legalName)) {
    findings.push({
      code: 'headline_names_business',
      severity: 'blocking',
      title: 'The headline appears to name the business',
      evidence: `The headline contains a word from "${listing.legalName}".`,
      action:
        'Rewrite it to describe the business without identifying it — what it does, roughly where, and how big.',
    });
  }

  if (!listing.jurisdictionCode) {
    findings.push({
      code: 'no_jurisdiction',
      severity: 'blocking',
      title: 'No state is set',
      evidence: 'The listing has no jurisdiction.',
      action: 'Set the state. Buyers filter on it, and disclosure rules depend on it.',
    });
  }

  // --- important -----------------------------------------------------------

  if (
    listing.financialYears > 0 &&
    listing.financialYears < READINESS_THRESHOLDS.expectedFinancialYears
  ) {
    findings.push({
      code: 'thin_financials',
      severity: 'important',
      title: 'Fewer years of figures than buyers expect',
      evidence: `${listing.financialYears} ${listing.financialYears === 1 ? 'year' : 'years'} entered; buyers generally ask for ${READINESS_THRESHOLDS.expectedFinancialYears}.`,
      action:
        'Add the earlier years. A trend a buyer can see is worth more than a single strong year they have to take on trust.',
    });
  }

  if (listing.financialYears > 0 && !listing.financialsAreRecent) {
    findings.push({
      code: 'stale_financials',
      severity: 'important',
      title: 'The most recent figures are over 18 months old',
      evidence: 'The latest fiscal year on record ended more than 18 months ago.',
      action:
        'Add the current year, even unaudited. Stale numbers read as a business that has got worse.',
    });
  }

  if (
    listing.customerConcentration !== null &&
    listing.customerConcentration >= READINESS_THRESHOLDS.severeConcentration
  ) {
    findings.push({
      code: 'severe_concentration',
      severity: 'important',
      title: 'One customer is most of the revenue',
      evidence: `Largest customer is ${Math.round(listing.customerConcentration * 100)}% of revenue.`,
      action:
        'Have the contract terms and the relationship history ready. At this level most buyers will ask before anything else, and an answer prepared in advance is worth more than a good one improvised.',
    });
  } else if (
    listing.customerConcentration !== null &&
    listing.customerConcentration >= READINESS_THRESHOLDS.customerConcentration
  ) {
    findings.push({
      code: 'customer_concentration',
      severity: 'important',
      title: 'Revenue is concentrated in one customer',
      evidence: `Largest customer is ${Math.round(listing.customerConcentration * 100)}% of revenue; buyers usually start discounting above ${Math.round(READINESS_THRESHOLDS.customerConcentration * 100)}%.`,
      action: 'Be ready to explain the contract length and how long the relationship has run.',
    });
  }

  if (
    listing.ownerDependence !== null &&
    listing.ownerDependence >= READINESS_THRESHOLDS.ownerDependence
  ) {
    findings.push({
      code: 'owner_dependence',
      severity: 'important',
      title: 'The business depends heavily on you',
      evidence: `Owner dependence rated ${listing.ownerDependence} of 5.`,
      action:
        'Write down what only you do, and who could do it. A transition plan on paper is what turns this from a discount into a negotiation.',
    });
  }

  if (listing.askingPriceCents === null) {
    findings.push({
      code: 'no_asking_price',
      severity: 'important',
      title: 'No asking price',
      evidence: 'The listing carries no price.',
      action:
        'Set one. Listings without a price get fewer serious inquiries — you can change it at any time.',
    });
  }

  // --- notes ---------------------------------------------------------------

  if (
    listing.sdeCents !== null &&
    listing.sdeCents > 0 &&
    listing.sdeCents < READINESS_THRESHOLDS.minimumMeaningfulSde
  ) {
    findings.push({
      code: 'small_earnings',
      severity: 'note',
      title: 'Earnings are small enough that multiples vary widely',
      evidence: 'Seller discretionary earnings under $50,000.',
      action:
        'Expect a wide range of offers. At this size buyers price on what the business does for them specifically rather than on a market multiple.',
    });
  }

  if (listing.employeeCount === null) {
    findings.push({
      code: 'no_employee_count',
      severity: 'note',
      title: 'No employee count',
      evidence: 'The teaser does not say how many people work there.',
      action: 'Add it. It is one of the first things a buyer filters on.',
    });
  }

  if (listing.yearsInBusiness === null) {
    findings.push({
      code: 'no_years_in_business',
      severity: 'note',
      title: 'No trading history given',
      evidence: 'The teaser does not say how long the business has run.',
      action: 'Add it. Longevity is the cheapest credibility a listing has.',
    });
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(severity: ReadinessSeverity): number {
  return severity === 'blocking' ? 0 : severity === 'important' ? 1 : 2;
}

export interface ReadinessSummary {
  findings: ReadinessFinding[];
  blocking: number;
  important: number;
  notes: number;
  /** Whether anything found would stop this reaching the market. */
  readyForReview: boolean;
}

export function summariseReadiness(listing: ListingSnapshot): ReadinessSummary {
  const findings = analyseReadiness(listing);

  const blocking = findings.filter((f) => f.severity === 'blocking').length;

  return {
    findings,
    blocking,
    important: findings.filter((f) => f.severity === 'important').length,
    notes: findings.filter((f) => f.severity === 'note').length,
    // Deliberately not a score out of 100. A number invites "get it to 80" and
    // hides which of the two remaining problems is the one that matters, and
    // this codebase has a rule about metrics that cannot be argued with.
    readyForReview: blocking === 0,
  };
}
