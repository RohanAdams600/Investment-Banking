import type { FitReason } from '@ib/core';

import type { ListingTeaser } from '@/features/listings/types';

/**
 * Shapes for the matching feature. Separate from any `'use server'` module,
 * which may only export async functions.
 */

export interface MatchedListing {
  /** The anonymised teaser. Never the confidential profile — see recompute.ts. */
  teaser: ListingTeaser;
  score: number;
  excluded: boolean;
  /** Already redacted when it was written. Safe to render. */
  reasons: FitReason[];
  exclusionReasons: string[];
  computedAt: string;
  /**
   * The model's read of the buyer's written thesis, kept apart from `score`.
   * Null when there is no thesis, no API key, or no usable answer — the
   * deterministic score stands on its own and this only ever adds.
   */
  aiScore: number | null;
  aiRationale: string | null;
}

/** Headline demand figures for a listing. */
export interface MatchSummary {
  totalBuyers: number;
  strongMatches: number;
  /** Rounded down to the nearest ten, so it cannot be watched for changes. */
  bestScore: number | null;
}

/**
 * A buyer, as the seller sees them.
 *
 * Named, deliberately. A seller deciding whether to release their financials
 * has to know who is asking — "identity withheld" makes that decision
 * unmakeable, and a seller who cannot tell a competitor from a search fund will
 * approve everyone or no one. Buyers appear here only if they left
 * `is_discoverable` on.
 */
export interface MatchedBuyer {
  buyerId: string;
  fullName: string | null;
  entityName: string | null;
  headline: string | null;
  fundingSource: string | null;
  priorAcquisitions: number | null;
  capitalLowCents: number | null;
  capitalHighCents: number | null;
  score: number;
  aiScore: number | null;
  aiRationale: string | null;
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  hasNda: boolean;
}

/** Who is representing a listing. Shown to any buyer browsing it. */
export interface ListingRepresentative {
  userId: string;
  fullName: string | null;
  firmName: string | null;
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
}

/** The AI half of a match, kept apart from the arithmetic. */
export interface ThesisAssessment {
  score: number;
  rationale: string;
  model: string | null;
}

export interface OutreachDraft {
  id: string;
  recipientId: string;
  recipientName: string | null;
  channel: 'email' | 'sms' | 'in_app';
  status: 'draft' | 'approved' | 'sent' | 'discarded';
  subject: string | null;
  body: string;
  matchScore: number | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface OutreachActionState {
  error: string | null;
  message?: string | null;
}

export const emptyOutreachState: OutreachActionState = { error: null, message: null };
