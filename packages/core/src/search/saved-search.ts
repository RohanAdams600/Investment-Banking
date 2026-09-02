/**
 * Saved searches: what a buyer is waiting for, described once.
 *
 * The database owns the matching (see `0042_saved_searches.sql`, whose function
 * reads the teaser view so it cannot filter on a confidential column). This file
 * owns the two things that are wrong to put in SQL: what counts as a valid
 * search, and how one reads back to the person who saved it.
 *
 * Both are here rather than in the app because both are decisions, not
 * plumbing — and a decision that lives in a component is a decision nobody
 * reviews.
 */

/** The axes a buyer may filter on. Every one is public on the listing card. */
export interface SearchFilters {
  /** Free text, matched against the teaser's headline, summary and background. */
  q?: string | null;
  industry?: string | null;
  jurisdictionCode?: string | null;
  minEarningsCents?: number | null;
  maxAskingCents?: number | null;
}

export type AlertFrequency = 'daily' | 'weekly' | 'off';

export interface SavedSearch extends SearchFilters {
  id: string;
  label: string;
  frequency: AlertFrequency;
  lastNotifiedAt: Date | null;
  createdAt: Date;
}

export const MAX_SAVED_SEARCHES = 20;

/** Longer than any real one, short enough that the list stays readable. */
export const MAX_LABEL_LENGTH = 80;
export const MAX_QUERY_LENGTH = 100;

export interface Invalid {
  field: keyof SearchFilters | 'label' | 'count';
  message: string;
}

/**
 * Everything wrong with a proposed search, in the order it should be shown.
 *
 * Returns all of the problems rather than the first, because a form that
 * reveals one fault per submission is how somebody gives up on the third
 * attempt.
 */
export function validateSavedSearch(
  input: { label: string; filters: SearchFilters },
  context: { existingCount: number; existingLabels: string[] },
): Invalid[] {
  const problems: Invalid[] = [];
  const label = input.label.trim();

  if (label.length === 0) {
    problems.push({ field: 'label', message: 'Give this search a name you will recognise later.' });
  } else if (label.length > MAX_LABEL_LENGTH) {
    problems.push({
      field: 'label',
      message: `Names are capped at ${MAX_LABEL_LENGTH} characters.`,
    });
  } else if (
    context.existingLabels.some((existing) => existing.trim().toLowerCase() === label.toLowerCase())
  ) {
    /*
     * Case-insensitive, where the database's unique constraint is not. The
     * constraint stops two rows with the identical string; this stops "Ohio
     * machine shops" and "ohio machine shops", which are the same search to
     * everybody except Postgres and would send two identical emails.
     */
    problems.push({ field: 'label', message: 'You already have a search with that name.' });
  }

  if (context.existingCount >= MAX_SAVED_SEARCHES) {
    problems.push({
      field: 'count',
      message: `You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one to add another.`,
    });
  }

  const { q, minEarningsCents, maxAskingCents } = input.filters;

  if (q !== null && q !== undefined && q.length > MAX_QUERY_LENGTH) {
    problems.push({
      field: 'q',
      message: `Search terms are capped at ${MAX_QUERY_LENGTH} characters.`,
    });
  }

  for (const [field, value] of [
    ['minEarningsCents', minEarningsCents],
    ['maxAskingCents', maxAskingCents],
  ] as const) {
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      problems.push({ field, message: 'Enter a whole number.' });
    } else if (value < 0) {
      problems.push({ field, message: 'Enter a positive amount.' });
    }
  }

  return problems;
}

/**
 * Whether this search will match the entire market.
 *
 * Worth its own function because the interface has to say so out loud. A buyer
 * who saves an empty search has not made a mistake — "tell me about anything"
 * is how an early buyer in a thin market behaves, and it is the correct
 * behaviour — but they should know that is what they did before the first email
 * arrives with nine listings in it.
 */
export function matchesEverything(filters: SearchFilters): boolean {
  return (
    isBlank(filters.q) &&
    isBlank(filters.industry) &&
    isBlank(filters.jurisdictionCode) &&
    filters.minEarningsCents == null &&
    filters.maxAskingCents == null
  );
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/**
 * The search, in a sentence.
 *
 * Shown under the label on the saved-search list and in the alert email, so a
 * buyer can tell at a glance which of their six searches produced a message.
 * Reading a filter set back in words is also the cheapest way to catch a
 * mis-set one: "under $20,000" is obviously wrong in a way that a form field
 * reading `2000000` is not.
 *
 * `formatMoney` is injected rather than imported so this stays free of currency
 * assumptions and testable without them.
 */
export function describeSearch(
  filters: SearchFilters,
  format: {
    money: (cents: number) => string;
    industry?: (key: string) => string;
    jurisdiction?: (code: string) => string;
  },
): string {
  if (matchesEverything(filters)) return 'Every new listing on the market.';

  const clauses: string[] = [];

  const industry = filters.industry?.trim();
  if (industry) {
    clauses.push(format.industry ? format.industry(industry) : industry);
  }

  const q = filters.q?.trim();
  if (q) clauses.push(`matching “${q}”`);

  const where = filters.jurisdictionCode?.trim();
  if (where) {
    clauses.push(`in ${format.jurisdiction ? format.jurisdiction(where) : where}`);
  }

  if (filters.minEarningsCents != null) {
    clauses.push(`earning ${format.money(filters.minEarningsCents)} or more`);
  }

  if (filters.maxAskingCents != null) {
    clauses.push(`asking ${format.money(filters.maxAskingCents)} or less`);
  }

  // Sentence case, one trailing stop, no Oxford-comma list — these read as a
  // filter set rather than as prose, and commas throughout are clearer than
  // an "and" that implies the last clause is special.
  return `${clauses.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
}

/**
 * Whether a search is due to send.
 *
 * Pure, and separate from the query that finds due rows, so the boundary
 * condition is testable without a clock or a database. A search that has never
 * sent is always due: that first email is the one that proves the feature
 * works, and delaying it by up to a week to fit a schedule is how a buyer
 * concludes it is broken.
 */
export function isDue(
  search: Pick<SavedSearch, 'frequency' | 'lastNotifiedAt'>,
  now: Date,
): boolean {
  if (search.frequency === 'off') return false;
  if (search.lastNotifiedAt === null) return true;

  const elapsedHours = (now.getTime() - search.lastNotifiedAt.getTime()) / 3_600_000;

  /*
   * 23 and 167 rather than 24 and 168.
   *
   * A daily run fired by a scheduler drifts by seconds, and a search that sent
   * at 09:00:04 yesterday is not due at 09:00:01 today under a strict 24-hour
   * test — so it silently slips to the next day and the buyer gets six emails
   * a week. An hour of slack costs nothing and removes the whole class of bug.
   */
  return search.frequency === 'daily' ? elapsedHours >= 23 : elapsedHours >= 167;
}
