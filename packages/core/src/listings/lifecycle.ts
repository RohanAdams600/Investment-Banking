import type { ListingStatus } from '../access/can';

/**
 * The listing lifecycle.
 *
 * This map exists twice — here, and as a `case` in
 * `app.enforce_listing_status_transition()`. The duplication is deliberate for
 * the same reason `deal:create` is duplicated: the database cannot import
 * TypeScript, and the UI must not offer a move the database will refuse. A test
 * in `supabase/tests/listings-rls.test.ts` drives every pair through real
 * Postgres and asserts the two agree, so drift fails the build rather than
 * showing a user a button that errors.
 *
 * `closed` and `withdrawn` are terminal. A listing that reached either is
 * history: commission records and the audit trail point at it, and reopening
 * one would rewrite what the parties actually did. Relisting is a new listing.
 */
export const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['pending_review', 'withdrawn'],
  pending_review: ['live', 'draft', 'withdrawn'],
  live: ['under_loi', 'withdrawn'],
  under_loi: ['under_contract', 'live', 'withdrawn'],
  under_contract: ['closed', 'under_loi', 'withdrawn'],
  closed: [],
  withdrawn: [],
};

export const LISTING_STATUSES = Object.keys(LISTING_TRANSITIONS) as ListingStatus[];

/** Statuses at which the anonymised teaser is discoverable in the market. */
export const MARKET_STATUSES: readonly ListingStatus[] = ['live', 'under_loi', 'under_contract'];

export function isDiscoverable(status: ListingStatus): boolean {
  return MARKET_STATUSES.includes(status);
}

export function canTransition(from: ListingStatus, to: ListingStatus): boolean {
  return LISTING_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ListingStatus): boolean {
  return LISTING_TRANSITIONS[status].length === 0;
}

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  live: 'On the market',
  under_loi: 'Under LOI',
  under_contract: 'Under contract',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
};

/**
 * What each move means, in the seller's language rather than the schema's.
 * Shown on the button that makes it, because "under_loi" is a state name and
 * "Accept a letter of intent" is a decision.
 */
export const LISTING_TRANSITION_LABELS: Record<ListingStatus, string> = {
  draft: 'Return to draft',
  pending_review: 'Submit for review',
  live: 'Publish to the market',
  under_loi: 'Mark under LOI',
  under_contract: 'Mark under contract',
  closed: 'Mark closed',
  withdrawn: 'Withdraw from the market',
};
