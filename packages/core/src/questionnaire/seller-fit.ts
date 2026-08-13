import type { FitReason } from '../criteria/model';

/**
 * Ranking a buyer for the seller.
 *
 * The other direction, and the one marketplaces usually skip. `scoreFit()`
 * answers "does this business match what the buyer wants". This answers "does
 * this buyer match what the seller wants", which is a different question with a
 * different answer — the highest bidder is frequently the worst fit for an
 * owner who cares what happens to their staff.
 *
 * Both scores are shown. A buyer who scores 91 on the business and 40 on the
 * seller's wishes is worth talking to *and* worth knowing about in advance,
 * because that gap is where deals fall apart at week ten.
 *
 * Deterministic and explainable, like everything else that produces a number
 * here. The seller's priorities are self-reported on a 1–5 scale and used as
 * weights, so a seller who says staff continuity is not a factor does not get
 * buyers penalised for it.
 */

export type BuyerKind =
  'individual' | 'search_fund' | 'strategic' | 'private_equity' | 'family_office' | 'employees';

export interface SellerPreferences {
  /** Buyer kinds the seller said they would be happy with. Empty means any. */
  acceptableBuyerTypes: BuyerKind[];
  /** 1–5. How much staff keeping their jobs matters. */
  employeePriority: number;
  /** 1–5. How much the business continuing as itself matters. */
  legacyPriority: number;
  transition: 'none' | 'weeks' | 'months' | 'year' | 'ongoing';
  sellerFinancing: 'no' | 'small' | 'significant' | 'open';
  timeline: 'asap' | 'six_months' | 'year' | 'no_rush' | 'exploring';
}

export interface BuyerSnapshot {
  kind: BuyerKind;
  /** How the buyer said they would fund it. */
  fundingSource: 'cash' | 'sba' | 'conventional' | 'fund' | 'seller' | 'undecided';
  /** Whether they intend to operate it themselves. */
  involvement: 'owner_operator' | 'passive' | 'either';
  timeline: 'now' | 'six_months' | 'year' | 'exploring';
  priorAcquisitions?: number;
}

export interface SellerFitResult {
  /** 0–100. */
  score: number;
  reasons: FitReason[];
  /** Things worth raising early rather than discovering in week ten. */
  frictions: string[];
}

/**
 * Weights.
 *
 * Buyer type dominates because it is the thing sellers feel most strongly
 * about and the thing least likely to change during a negotiation. Timing and
 * financing are real but negotiable.
 */
const WEIGHTS = {
  buyerType: 30,
  continuity: 25,
  timing: 20,
  financing: 15,
  experience: 10,
} as const;

/** Buyer kinds that typically keep a business running as it was. */
const CONTINUITY_FRIENDLY: BuyerKind[] = [
  'individual',
  'search_fund',
  'employees',
  'family_office',
];

export function scoreSellerFit(
  preferences: SellerPreferences,
  buyer: BuyerSnapshot,
): SellerFitResult {
  const reasons: FitReason[] = [];
  const frictions: string[] = [];

  // --- buyer type ---------------------------------------------------------
  if (preferences.acceptableBuyerTypes.length === 0) {
    reasons.push({
      label: 'Buyer type',
      detail: 'You did not narrow by buyer type, so this counts neither way.',
      points: WEIGHTS.buyerType * 0.5,
    });
  } else if (preferences.acceptableBuyerTypes.includes(buyer.kind)) {
    reasons.push({
      label: 'Buyer type you wanted',
      detail: `${describeKind(buyer.kind)} — one of the kinds you said you would be happy with.`,
      points: WEIGHTS.buyerType,
    });
  } else {
    reasons.push({
      label: 'Not a buyer type you named',
      detail: `${describeKind(buyer.kind)}, which was not on your list.`,
      points: 0,
    });
    frictions.push(
      `You did not list ${describeKind(buyer.kind).toLowerCase()} as a buyer you wanted. Worth deciding whether that is a firm rule before you engage.`,
    );
  }

  // --- staff and legacy ---------------------------------------------------
  //
  // Combined into one factor because they move together in practice, and
  // weighted by how much the seller said each mattered. A seller who said
  // neither matters gets a neutral score here rather than a penalty.
  const continuityWeight = (preferences.employeePriority + preferences.legacyPriority) / 10;
  const friendly = CONTINUITY_FRIENDLY.includes(buyer.kind);
  const operates = buyer.involvement === 'owner_operator';

  let continuityFraction = 0.5;
  const continuityNotes: string[] = [];

  if (friendly) {
    continuityFraction += 0.25;
    continuityNotes.push('this kind of buyer usually keeps a business running as it is');
  }
  if (operates) {
    continuityFraction += 0.25;
    continuityNotes.push('they intend to run it themselves');
  }
  if (buyer.kind === 'strategic') {
    continuityFraction -= 0.35;
    continuityNotes.push('a buyer already in your industry may merge it into what they have');
  }

  continuityFraction = clamp(continuityFraction, 0, 1);

  // Scaled by how much the seller cares. Someone indifferent to legacy is not
  // penalised for a buyer who would absorb the business.
  const continuityPoints =
    WEIGHTS.continuity * (continuityFraction * continuityWeight + 0.5 * (1 - continuityWeight));

  reasons.push({
    label: continuityFraction >= 0.7 ? 'Likely to keep it intact' : 'May change how it operates',
    detail:
      continuityNotes.length > 0
        ? capitalise(continuityNotes.join('; ')) + '.'
        : 'Not enough about this buyer to judge.',
    points: continuityPoints,
  });

  if (buyer.kind === 'strategic' && preferences.legacyPriority >= 4) {
    frictions.push(
      'You said the business continuing as itself matters a great deal, and this buyer is in your industry. Ask directly what they would do with the name and the team.',
    );
  }

  if (preferences.employeePriority >= 4) {
    frictions.push(
      'Staff continuity matters to you. Nothing on this platform binds a buyer to it — if it is a condition, it belongs in the purchase agreement, and that is a conversation for your attorney.',
    );
  }

  // --- timing -------------------------------------------------------------
  const timingFit = scoreTiming(preferences.timeline, buyer.timeline);
  reasons.push({
    label: timingFit >= 0.75 ? 'Timing lines up' : 'Timing may not line up',
    detail: describeTiming(preferences.timeline, buyer.timeline),
    points: WEIGHTS.timing * timingFit,
  });

  if (timingFit < 0.4) {
    frictions.push('Your timelines are some way apart. Worth agreeing a target date early.');
  }

  // --- financing ----------------------------------------------------------
  const financingFit = scoreFinancing(preferences.sellerFinancing, buyer.fundingSource);
  reasons.push({
    label: financingFit >= 0.75 ? 'Funding works with your terms' : 'Funding needs discussion',
    detail: describeFinancing(preferences.sellerFinancing, buyer.fundingSource),
    points: WEIGHTS.financing * financingFit,
  });

  if (buyer.fundingSource === 'sba') {
    frictions.push(
      'SBA financing adds time to a close and comes with lender conditions. Common and workable — just not fast.',
    );
  }
  if (buyer.fundingSource === 'undecided') {
    frictions.push('This buyer has not settled how they would pay. Ask before you disclose much.');
  }

  // --- experience ---------------------------------------------------------
  const prior = buyer.priorAcquisitions ?? 0;
  const experienceFraction = prior === 0 ? 0.4 : prior === 1 ? 0.7 : 1;

  reasons.push({
    label: prior === 0 ? 'First-time buyer' : 'Has bought before',
    detail:
      prior === 0
        ? 'Not a problem in itself — expect to explain more, and expect a slower process.'
        : `${prior} prior ${prior === 1 ? 'acquisition' : 'acquisitions'}, so the process should be familiar to them.`,
    points: WEIGHTS.experience * experienceFraction,
  });

  const total = reasons.reduce((sum, reason) => sum + reason.points, 0);

  return {
    score: Math.round(clamp(total, 0, 100)),
    reasons: [...reasons].sort((a, b) => b.points - a.points),
    frictions,
  };
}

// ---------------------------------------------------------------------------

function scoreTiming(
  seller: SellerPreferences['timeline'],
  buyer: BuyerSnapshot['timeline'],
): number {
  if (seller === 'exploring' || buyer === 'exploring') return 0.4;
  if (seller === 'no_rush') return 1;

  const sellerMonths = { asap: 0, six_months: 6, year: 12, no_rush: 24, exploring: 24 }[seller];
  const buyerMonths = { now: 0, six_months: 6, year: 12, exploring: 24 }[buyer];

  const gap = Math.abs(sellerMonths - buyerMonths);
  return clamp(1 - gap / 12, 0, 1);
}

function describeTiming(
  seller: SellerPreferences['timeline'],
  buyer: BuyerSnapshot['timeline'],
): string {
  if (buyer === 'exploring') return 'This buyer is still looking rather than ready to move.';
  if (seller === 'exploring')
    return 'You are finding out what the business is worth rather than selling yet.';
  if (seller === 'no_rush') return 'You are not in a hurry, so their timing works.';
  return buyer === 'now'
    ? 'They want to move as soon as they find the right business.'
    : 'Their timeline is within the range you set.';
}

function scoreFinancing(
  seller: SellerPreferences['sellerFinancing'],
  buyer: BuyerSnapshot['fundingSource'],
): number {
  if (buyer === 'cash' || buyer === 'fund') return 1;
  if (buyer === 'undecided') return 0.3;

  if (buyer === 'seller') {
    // The buyer needs the seller to carry most of the price.
    return { no: 0, small: 0.4, significant: 0.9, open: 0.8 }[seller];
  }

  // Bank or SBA debt. Lenders often want the seller to carry a slice anyway.
  return { no: 0.6, small: 0.9, significant: 1, open: 0.9 }[seller];
}

function describeFinancing(
  seller: SellerPreferences['sellerFinancing'],
  buyer: BuyerSnapshot['fundingSource'],
): string {
  if (buyer === 'cash') return 'Paying cash, so no financing contingency.';
  if (buyer === 'fund') return 'Backed by committed capital.';
  if (buyer === 'undecided') return 'They have not said how they would fund it.';
  if (buyer === 'seller' && seller === 'no') {
    return 'They are relying on seller financing and you said you want paid at closing.';
  }
  if (buyer === 'sba') return 'SBA financing — widely used, and slower than cash.';
  return 'Bank financing, which usually works alongside a modest seller note.';
}

function describeKind(kind: BuyerKind): string {
  return {
    individual: 'An individual buyer',
    search_fund: 'A funded searcher',
    strategic: 'A company in your industry',
    private_equity: 'A private equity fund',
    family_office: 'A family office',
    employees: 'Management or employees',
  }[kind];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
