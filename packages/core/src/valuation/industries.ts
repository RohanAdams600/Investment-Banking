/**
 * Base earnings multiples by industry.
 *
 * These are the starting point for a valuation range, before any adjustment for
 * the specific business. They are **heuristics for discussion**, not market
 * data: they encode the broad ranges lower-middle-market businesses have
 * historically traded in, and they are wrong for any individual company by an
 * amount no model can tell you.
 *
 * Kept in one table, with a `basis` on each entry, because the single most
 * common way to be badly wrong here is to apply an EBITDA multiple to an SDE
 * figure or the reverse. Smaller owner-operated businesses are quoted on SDE
 * (seller's discretionary earnings, which adds back one owner's compensation);
 * larger ones on EBITDA. Mixing them silently produces a number that is off by
 * roughly one owner's salary times the multiple.
 *
 * Every range must be reviewed against real transaction data before this is
 * presented to anyone as anything other than an illustration. See
 * docs/valuation.md.
 */

export type EarningsBasis = 'sde' | 'ebitda';

export interface IndustryProfile {
  key: string;
  label: string;
  /** Which earnings figure the multiples below apply to. */
  basis: EarningsBasis;
  /** Multiple applied to the earnings figure. */
  multipleLow: number;
  multipleHigh: number;
  /** Why this sector sits where it does — shown to the user as reasoning. */
  rationale: string;
}

export const INDUSTRY_PROFILES = {
  home_services: {
    key: 'home_services',
    label: 'Home services (HVAC, plumbing, electrical)',
    basis: 'sde',
    multipleLow: 2.5,
    multipleHigh: 4.5,
    rationale:
      'Recurring service contracts and licensed technicians support value; heavy owner ' +
      'involvement and technician scarcity limit it.',
  },
  professional_services: {
    key: 'professional_services',
    label: 'Professional services (accounting, consulting, agencies)',
    basis: 'sde',
    multipleLow: 2.0,
    multipleHigh: 4.0,
    rationale:
      'Client relationships often follow the owner, which is the main constraint on ' +
      'transferable value.',
  },
  manufacturing: {
    key: 'manufacturing',
    label: 'Manufacturing',
    basis: 'ebitda',
    multipleLow: 4.0,
    multipleHigh: 6.5,
    rationale:
      'Tangible assets and contracted volume support value; capital intensity and cyclicality ' +
      'weigh against it.',
  },
  distribution: {
    key: 'distribution',
    label: 'Wholesale and distribution',
    basis: 'ebitda',
    multipleLow: 3.5,
    multipleHigh: 6.0,
    rationale:
      'Supplier agreements and route density support value; thin margins and working-capital ' +
      'demands constrain it.',
  },
  saas: {
    key: 'saas',
    label: 'Software and SaaS',
    basis: 'ebitda',
    multipleLow: 5.0,
    multipleHigh: 10.0,
    rationale:
      'Recurring revenue and gross margin drive the range; churn and customer acquisition cost ' +
      'move a business within it.',
  },
  healthcare_services: {
    key: 'healthcare_services',
    label: 'Healthcare services',
    basis: 'ebitda',
    multipleLow: 4.0,
    multipleHigh: 7.5,
    rationale:
      'Payer contracts and licensure create durability; reimbursement risk and regulatory ' +
      'exposure widen the range.',
  },
  restaurants_retail: {
    key: 'restaurants_retail',
    label: 'Restaurants and retail',
    basis: 'sde',
    multipleLow: 1.5,
    multipleHigh: 3.0,
    rationale:
      'Location and brand carry value; lease dependence, labour costs and consumer cyclicality ' +
      'hold multiples low.',
  },
  construction: {
    key: 'construction',
    label: 'Construction and contracting',
    basis: 'ebitda',
    multipleLow: 3.0,
    multipleHigh: 5.5,
    rationale:
      'Backlog and bonding capacity support value; project concentration and cyclicality are ' +
      'the main risks.',
  },
  transportation: {
    key: 'transportation',
    label: 'Transportation and logistics',
    basis: 'ebitda',
    multipleLow: 3.5,
    multipleHigh: 6.0,
    rationale:
      'Contracted lanes and owned fleet support value; driver availability and fuel exposure ' +
      'constrain it.',
  },
  other: {
    key: 'other',
    label: 'Other',
    basis: 'sde',
    multipleLow: 2.0,
    multipleHigh: 4.0,
    rationale:
      'A deliberately wide, generic range. A specific sector should be selected wherever one ' +
      'applies — this one is broad enough to be of limited use.',
  },
} as const satisfies Record<string, IndustryProfile>;

export type IndustryKey = keyof typeof INDUSTRY_PROFILES;

export const INDUSTRY_KEYS = Object.keys(INDUSTRY_PROFILES) as IndustryKey[];

export function industryProfile(key: IndustryKey): IndustryProfile {
  return INDUSTRY_PROFILES[key];
}
