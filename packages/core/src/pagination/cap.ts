/**
 * Saying so when a list did not fit.
 *
 * Every list query in this product ends in `.limit(n)`, and until now every one
 * of them lied by omission: a broker with six hundred contacts saw five hundred
 * and nothing on the page suggested the other hundred existed. That is the worst
 * shape a bug can take, because it looks exactly like the truth — the page
 * renders, the rows are real, and the missing ones are missing quietly.
 *
 * The fix is not a page-number bar everywhere. It is asking for one row more
 * than you intend to show: if it comes back, there is more, and the list can say
 * so. That is one extra row of cost, and it turns a silent truncation into a
 * visible one.
 *
 * Real pagination still belongs on the lists people browse rather than scan.
 * This is the floor, not the ceiling — but a floor that tells the truth beats a
 * ceiling nobody built.
 */

export interface Capped<T> {
  /** At most `limit` rows, in the order they arrived. */
  rows: T[];
  /** Whether the query had more to give. */
  truncated: boolean;
  /** What was asked for, so a message can quote it without a second constant. */
  limit: number;
}

/**
 * Trims an over-fetched result and reports whether it was over-fetched.
 *
 * Pass the rows from a query that asked for `limit + 1`. Anything else and
 * `truncated` is a guess: a query that asked for exactly `limit` and got
 * `limit` rows cannot tell a full page from a partial one, which is the
 * ambiguity this whole module exists to remove.
 */
export function capped<T>(rows: readonly T[], limit: number): Capped<T> {
  if (limit < 0) throw new RangeError('A page limit cannot be negative.');

  return {
    rows: rows.slice(0, limit),
    truncated: rows.length > limit,
    limit,
  };
}

/** How many to ask the database for, given how many you mean to show. */
export function overFetch(limit: number): number {
  return limit + 1;
}

/**
 * What to tell somebody whose list did not fit.
 *
 * Names the thing being counted, because "showing the first 500" on a page with
 * three lists on it does not say which one. Returns null when nothing was cut,
 * so a caller can render it unconditionally.
 */
export function truncationNotice(result: Capped<unknown>, noun: string): string | null {
  if (!result.truncated) return null;

  return `Showing the first ${result.limit} ${noun}. Narrow your filters to see the rest.`;
}
