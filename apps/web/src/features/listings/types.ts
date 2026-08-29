import type { ListingStatus, NdaStatus, VerificationBadge } from '@ib/core';

/**
 * Shapes for the listings feature. Separate from `actions.ts` because a
 * `'use server'` module may only export async functions.
 */

export interface ListingActionState {
  error: string | null;
  /** Set on a successful action that stays on the page, for the live region. */
  message?: string | null;
}

export const emptyListingState: ListingActionState = { error: null, message: null };

/**
 * The anonymised teaser, as everything outside the NDA gate sees it.
 *
 * There is deliberately no company name, address, or exact figure on this type.
 * Keeping the teaser and the full profile as *different types* rather than one
 * type with optional fields means a component that renders a teaser cannot
 * accidentally be handed a full profile and print the legal name — the compiler
 * refuses. The schema draws the same line with two tables.
 */
export interface ListingTeaser {
  id: string;
  /**
   * The public, stable identifier — the same one `/businesses-for-sale/[slug]`
   * uses. Present on the teaser because it is public by construction: it is
   * generated from the headline, which is already the anonymised half.
   *
   * Null on a listing published before slugs existed, and on a draft, so every
   * reader has to handle its absence rather than assume it.
   */
  slug: string | null;
  status: ListingStatus;
  headline: string;
  summary: string | null;
  /**
   * How the business got here, written so it does not identify which business
   * it is. Distinct from `summary`, which is the pitch. A buyer choosing
   * between two firms with identical earnings is choosing on this.
   */
  background: string | null;
  industry: string;
  jurisdictionCode: string;
  jurisdictionName: string | null;
  revenueBand: { lowCents: number | null; highCents: number | null };
  earningsBand: { lowCents: number | null; highCents: number | null };
  askingBand: { lowCents: number | null; highCents: number | null };
  dealStructure: 'asset' | 'stock';
  employeeCount: number | null;
  yearsInBusiness: number | null;
  growthTrend: 'declining' | 'flat' | 'growing' | 'rapid' | null;
  realEstateIncluded: boolean;
  ownerDependence: 'absentee' | 'moderate' | 'critical' | null;
  reasonForSale: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Whether the caller has saved this to their watchlist. */
  saved: boolean;
  /**
   * Whether the seller paid for this position.
   *
   * On the teaser type rather than fetched separately, because a label that can
   * be lost by forgetting a join is not a disclosure. Every surface that renders
   * a teaser therefore has the fact in hand and a test asserts it is shown.
   */
  promoted: boolean;
}

/** The confidential half. Only ever populated when the gate opened. */
export interface ListingFullProfile {
  legalName: string;
  tradingName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  website: string | null;
  revenueCents: number | null;
  earningsCents: number | null;
  askingPriceCents: number | null;
  customerConcentration: number | null;
  recurringRevenueShare: number | null;
  keyCustomers: string | null;
  competitivePosition: string | null;
  growthOpportunities: string | null;
  knownRisks: string | null;
  /** Founders, ownership changes, prior sale processes. */
  ownershipHistory: string | null;
  /** Sale attempts that did not close, and why. */
  priorTransactions: string | null;
  financials: ListingFinancialYear[];
}

export interface ListingFinancialYear {
  id: string;
  fiscalYear: number;
  revenueCents: number;
  ebitdaCents: number | null;
  sdeCents: number | null;
  addbacksCents: number | null;
}

export interface ListingNda {
  id: string;
  status: NdaStatus;
  requestedAt: string;
  sentAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * An NDA as the seller sees it in their inbound queue.
 *
 * Named, with enough context to decide. A seller shown "identity withheld"
 * cannot judge whether to release their financials, and will end up approving
 * everyone or no one — both of which defeat the gate the NDA exists to be.
 */
export interface ListingNdaRequest extends ListingNda {
  buyerId: string;
  buyerName: string | null;
  buyerEntity: string | null;
  buyerFundingSource: string | null;
  /*
   * A reviewed capacity band, or null when the buyer has not submitted one —
   * which is not the same as having failed, and the badge component says so.
   *
   * Never carries the evidence, the reviewer's note or an exact figure: the
   * database function this comes from returns five columns and none of those
   * is among them.
   */
  verification: VerificationBadge | null;
}

export interface ListingStatusEntry {
  id: string;
  fromStatus: ListingStatus | null;
  toStatus: ListingStatus;
  changedAt: string;
}

/** Everything the detail page needs, assembled by one server query. */
export interface ListingDetailView {
  teaser: ListingTeaser;
  /** Null whenever the caller has not passed the gate. */
  profile: ListingFullProfile | null;
  /** The caller's own NDA on this listing, if they have one. */
  nda: ListingNda | null;
  /** True when the caller is the seller or their broker. */
  controls: boolean;
  history: ListingStatusEntry[];
}

export interface BrowseFilters {
  /** Free-text keywords, ranked in Postgres. See `browseListings`. */
  q?: string;
  industry?: string;
  jurisdiction?: string;
  minEarningsCents?: number;
  maxAskingCents?: number;
}

export interface JurisdictionOption {
  code: string;
  name: string;
}
