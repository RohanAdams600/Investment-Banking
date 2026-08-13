import type { FitReason, FitResult } from '../criteria/model';

/**
 * Making a match score safe to show before an NDA is signed.
 *
 * The matcher has a problem the rest of the product does not. To score a
 * listing properly it needs the seller's **exact** revenue, earnings and
 * customer concentration — the confidential half. But the buyer being scored
 * has not signed anything and may never. So the score is computed against the
 * real figures server-side, and only this redacted form is ever stored or
 * shown.
 *
 * That is a real advantage rather than a compromise: the buyer gets an accurate
 * ranking without the seller disclosing anything. What they must not get is the
 * inputs back out. "Largest customer is 45% of revenue, above your 40% limit"
 * is a perfectly good explanation and an outright disclosure of a number the
 * seller is holding back until they choose otherwise.
 *
 * Two defences, deliberately overlapping:
 *
 *   1. Reasons that carry figures are replaced wholesale with qualitative text.
 *   2. Whatever survives is scrubbed of digits anyway.
 *
 * The second exists because the first depends on recognising which reasons leak,
 * and that judgement will eventually be wrong — a new reason gets added to the
 * scoring model and nobody updates the list here. The scrub does not need to
 * know what the reason means. A test asserts the combined output contains no
 * digit at all, for every shape of input, so a future leak fails the build
 * rather than reaching a buyer.
 */

/**
 * Reason labels whose detail text is built from confidential figures.
 *
 * Kept as an explicit list so replacing them produces *useful* wording rather
 * than a sentence full of holes. The scrub below is the safety net; this is the
 * part that keeps the output readable.
 */
const REPLACEMENTS: Record<string, string> = {
  'Business quality':
    'Quality signals were considered, including customer concentration and how much ' +
    'the business depends on its owner. The figures are in the full profile.',
};

/** Any digit run, with an optional percent or currency marker around it. */
const FIGURE = /\$?\d[\d,.]*\s*%?/g;

export function redactReason(reason: FitReason): FitReason {
  const replacement = REPLACEMENTS[reason.label];

  return {
    label: scrub(reason.label),
    detail: scrub(replacement ?? reason.detail),
    points: reason.points,
  };
}

/**
 * Exclusion reasons are replaced entirely rather than edited.
 *
 * Every one of them is a sentence of the form "this figure is beyond that limit",
 * so there is no version with the number removed that still reads as English.
 * The buyer keeps the one fact that is theirs to know — that the listing failed
 * a limit *they* set, and which one.
 */
export function redactExclusionReason(reason: string): string {
  const lower = reason.toLowerCase();

  if (lower.includes('customer')) {
    return 'Customer concentration is above the limit you set.';
  }
  if (lower.includes('recurring')) {
    return 'Recurring revenue is below the minimum you set.';
  }
  if (lower.includes('deal size') || lower.includes('asking price')) {
    return 'The asking price is above the maximum deal size you set.';
  }

  // An exclusion this function does not recognise is a new rule somebody added
  // to the scoring model. Say nothing specific rather than guess, and let the
  // digit test catch it if the wording carried a figure.
  return 'This listing falls outside a limit you set.';
}

/**
 * The whole result, safe to persist and to render to a buyer who has signed
 * nothing.
 *
 * The score itself is not redacted. A number between 0 and 100 derived from
 * five weighted factors does not reconstruct any input, and withholding it
 * would leave nothing to show.
 */
export function redactFitResult(result: FitResult): FitResult {
  return {
    score: result.score,
    excluded: result.excluded,
    exclusionReasons: result.exclusionReasons.map(redactExclusionReason),
    topReasons: result.topReasons.map(redactReason),
    allReasons: result.allReasons.map(redactReason),
  };
}

/**
 * Removes anything that looks like a figure.
 *
 * Runs over text that has usually already been replaced, and is expected to
 * find nothing. It earns its place on the day somebody adds a reason like
 * "3 of your 5 named industries match" without thinking about who reads it.
 */
function scrub(text: string): string {
  return text.replace(FIGURE, 'a figure').replace(/\s+/g, ' ').trim();
}
