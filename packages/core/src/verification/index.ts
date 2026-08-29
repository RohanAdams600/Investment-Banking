/**
 * Buyer funding verification, as the rest of the product talks about it.
 *
 * Framework-free on purpose: the wording a seller reads is the whole feature,
 * and it is the kind of thing that drifts if each surface writes its own. A
 * badge that says "Verified" on one page and "Funds confirmed" on another is
 * two different promises about the same review.
 *
 * ## The wording is a claim, so it is conservative
 *
 * The platform does not certify that anybody has money. A person read evidence
 * a buyer offered and formed a view, and the labels say that much and no more —
 * "Capacity reviewed", not "Funds guaranteed". Overstating it would make the
 * operator the one vouching, which is a liability nobody here has priced.
 */

export type FundingVerificationStatus = 'pending' | 'verified' | 'rejected' | 'withdrawn';

export type FundingEvidenceKind =
  | 'cash'
  | 'sba_preapproval'
  | 'lender_commitment'
  | 'committed_fund'
  | 'search_fund'
  | 'seller_financing_sought'
  | 'other';

export type CapacityBand =
  | 'under_250k'
  | 'from_250k_to_1m'
  | 'from_1m_to_5m'
  | 'from_5m_to_25m'
  | 'over_25m';

/** What the buyer says they can bring. Shown to them, and to the reviewer. */
export const FUNDING_EVIDENCE_LABELS: Record<FundingEvidenceKind, string> = {
  cash: 'Cash on hand',
  sba_preapproval: 'SBA lender pre-approval',
  lender_commitment: 'Commitment letter from a bank',
  committed_fund: 'A fund with committed capital',
  search_fund: 'Search fund with investor backing',
  seller_financing_sought: 'Seeking seller financing',
  other: 'Other',
};

/**
 * Bands, never an amount.
 *
 * An exact figure shown to a seller before a price is agreed is negotiating
 * leverage moved from one side to the other by the platform. The database
 * stores a band for the same reason; these are its labels.
 */
export const CAPACITY_BAND_LABELS: Record<CapacityBand, string> = {
  under_250k: 'Up to $250k',
  from_250k_to_1m: '$250k – $1m',
  from_1m_to_5m: '$1m – $5m',
  from_5m_to_25m: '$5m – $25m',
  over_25m: 'Over $25m',
};

export const CAPACITY_BAND_ORDER: CapacityBand[] = [
  'under_250k',
  'from_250k_to_1m',
  'from_1m_to_5m',
  'from_5m_to_25m',
  'over_25m',
];

export interface VerificationBadge {
  status: FundingVerificationStatus;
  capacityBand: CapacityBand;
  verifiedAt: string | null;
  expiresAt: string | null;
  /** Verified *and* not lapsed. Derived at read time by the database. */
  isCurrent: boolean;
}

export type BadgeTone = 'success' | 'warning' | 'neutral';

export interface BadgeDisplay {
  label: string;
  tone: BadgeTone;
  /** The sentence under the badge. Always says who checked and how recently. */
  detail: string;
}

/**
 * How a badge reads to a seller.
 *
 * `null` means the buyer has never submitted anything, which is different from
 * having been rejected and must not be shown as though it were the same. A
 * seller drawing the wrong conclusion from a missing badge is the one failure
 * mode here that harms the buyer rather than the seller.
 */
export function describeBadge(badge: VerificationBadge | null): BadgeDisplay {
  if (!badge) {
    return {
      label: 'Not submitted',
      tone: 'neutral',
      detail:
        'This buyer has not submitted evidence of funding. That is not a judgement about them — ' +
        'many buyers approach a seller before doing it.',
    };
  }

  switch (badge.status) {
    case 'verified':
      return badge.isCurrent
        ? {
            label: 'Capacity reviewed',
            tone: 'success',
            detail:
              `Evidence of funding in the ${CAPACITY_BAND_LABELS[badge.capacityBand]} range was ` +
              'reviewed by a person on this platform. It is a review of documents the buyer ' +
              'provided, not a guarantee that funds are available for your transaction.',
          }
        : {
            label: 'Review has lapsed',
            tone: 'warning',
            detail:
              'This buyer was reviewed, but the review is out of date and has not been renewed. ' +
              'Treat it as unreviewed until they submit again.',
          };
    case 'pending':
      return {
        label: 'Review in progress',
        tone: 'warning',
        detail:
          'This buyer has submitted evidence of funding and it has not been reviewed yet. ' +
          'Nobody on this platform has checked it.',
      };
    case 'rejected':
      return {
        label: 'Not reviewed successfully',
        tone: 'warning',
        detail:
          'This buyer submitted evidence and the review did not confirm it. That may mean the ' +
          'documents were incomplete rather than that the buyer cannot transact.',
      };
    case 'withdrawn':
      return {
        label: 'Not submitted',
        tone: 'neutral',
        detail: 'This buyer withdrew their submission and has not replaced it.',
      };
  }
}

/**
 * The line that must appear wherever a badge does.
 *
 * Exported as a constant rather than written into each component so it cannot
 * be dropped from one surface during a redesign and survive on the others.
 */
export const VERIFICATION_DISCLAIMER =
  'Verification is a person reviewing documents a buyer chose to provide. It is not a credit ' +
  'check, a source-of-funds investigation, or a guarantee that any buyer will complete a ' +
  'purchase. Decide who to release your information to on your own judgement.';

/** How long a review stands before it has to be done again. */
export const VERIFICATION_VALID_DAYS = 180;
