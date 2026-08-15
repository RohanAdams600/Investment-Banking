/**
 * What a match score means, in one place.
 *
 * The numbers were living in two places that had no idea about each other: the
 * badge colour on a match card, and the bar a score has to clear before the
 * platform is willing to interrupt somebody about it. Both said 70. Nothing
 * connected them, so the day one moved the other would have quietly stayed put
 * and the product would have started emailing about matches it renders in grey.
 *
 * The bands are deliberately coarse. A score is a ranking aid, not a
 * measurement, and three buckets is about as much precision as the underlying
 * model honestly supports.
 */

export type MatchStrength = 'strong' | 'possible' | 'weak';

/** The floor of each band. */
export const MATCH_STRENGTH_THRESHOLDS = {
  strong: 70,
  possible: 40,
} as const;

export function matchStrength(score: number): MatchStrength {
  if (score >= MATCH_STRENGTH_THRESHOLDS.strong) return 'strong';
  if (score >= MATCH_STRENGTH_THRESHOLDS.possible) return 'possible';
  return 'weak';
}

/**
 * Whether a score is worth telling somebody about, unprompted.
 *
 * A higher bar than "show it in the list", and that gap is the point. A buyer
 * scrolling their matches has asked to see everything; a buyer receiving a
 * notification has not asked for anything, and the cost of being wrong is that
 * they turn notifications off — after which the one that mattered never
 * arrives either.
 */
export function worthNotifying(score: number, excluded: boolean): boolean {
  return !excluded && matchStrength(score) === 'strong';
}
