/**
 * Form shapes for buyer acquisition criteria.
 *
 * Separate from `actions.ts` because a `'use server'` module may only export
 * async functions.
 *
 * Every numeric field is a string here rather than a number. Form inputs are
 * text, and coercing early means a half-typed "1,0" becomes 10 and the range
 * silently shifts under the user. Parsing happens once, at the boundary, where
 * a bad value can be reported rather than absorbed.
 */

export interface CriteriaFormState {
  industries: string[];
  jurisdictions: string[];
  revenueMin: string;
  revenueMax: string;
  earningsMin: string;
  earningsMax: string;
  dealSizeMax: string;
  dealStructure: 'asset' | 'stock' | 'either';
  involvement: 'owner_operator' | 'passive' | 'either';
  maxCustomerConcentration: string;
  minRecurringRevenueShare: string;
  thesis: string;
}

export const emptyCriteriaState: CriteriaFormState = {
  industries: [],
  jurisdictions: [],
  revenueMin: '',
  revenueMax: '',
  earningsMin: '',
  earningsMax: '',
  dealSizeMax: '',
  dealStructure: 'either',
  involvement: 'either',
  maxCustomerConcentration: '',
  minRecurringRevenueShare: '',
  thesis: '',
};

export interface CriteriaSaveResult {
  error: string | null;
  notice: string | null;
}

export const US_STATES: Array<{ code: string; abbr: string }> = [
  { code: 'US-AL', abbr: 'AL' },
  { code: 'US-AK', abbr: 'AK' },
  { code: 'US-AZ', abbr: 'AZ' },
  { code: 'US-AR', abbr: 'AR' },
  { code: 'US-CA', abbr: 'CA' },
  { code: 'US-CO', abbr: 'CO' },
  { code: 'US-CT', abbr: 'CT' },
  { code: 'US-DE', abbr: 'DE' },
  { code: 'US-DC', abbr: 'DC' },
  { code: 'US-FL', abbr: 'FL' },
  { code: 'US-GA', abbr: 'GA' },
  { code: 'US-HI', abbr: 'HI' },
  { code: 'US-ID', abbr: 'ID' },
  { code: 'US-IL', abbr: 'IL' },
  { code: 'US-IN', abbr: 'IN' },
  { code: 'US-IA', abbr: 'IA' },
  { code: 'US-KS', abbr: 'KS' },
  { code: 'US-KY', abbr: 'KY' },
  { code: 'US-LA', abbr: 'LA' },
  { code: 'US-ME', abbr: 'ME' },
  { code: 'US-MD', abbr: 'MD' },
  { code: 'US-MA', abbr: 'MA' },
  { code: 'US-MI', abbr: 'MI' },
  { code: 'US-MN', abbr: 'MN' },
  { code: 'US-MS', abbr: 'MS' },
  { code: 'US-MO', abbr: 'MO' },
  { code: 'US-MT', abbr: 'MT' },
  { code: 'US-NE', abbr: 'NE' },
  { code: 'US-NV', abbr: 'NV' },
  { code: 'US-NH', abbr: 'NH' },
  { code: 'US-NJ', abbr: 'NJ' },
  { code: 'US-NM', abbr: 'NM' },
  { code: 'US-NY', abbr: 'NY' },
  { code: 'US-NC', abbr: 'NC' },
  { code: 'US-ND', abbr: 'ND' },
  { code: 'US-OH', abbr: 'OH' },
  { code: 'US-OK', abbr: 'OK' },
  { code: 'US-OR', abbr: 'OR' },
  { code: 'US-PA', abbr: 'PA' },
  { code: 'US-RI', abbr: 'RI' },
  { code: 'US-SC', abbr: 'SC' },
  { code: 'US-SD', abbr: 'SD' },
  { code: 'US-TN', abbr: 'TN' },
  { code: 'US-TX', abbr: 'TX' },
  { code: 'US-UT', abbr: 'UT' },
  { code: 'US-VT', abbr: 'VT' },
  { code: 'US-VA', abbr: 'VA' },
  { code: 'US-WA', abbr: 'WA' },
  { code: 'US-WV', abbr: 'WV' },
  { code: 'US-WI', abbr: 'WI' },
  { code: 'US-WY', abbr: 'WY' },
];
