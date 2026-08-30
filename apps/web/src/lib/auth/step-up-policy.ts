/**
 * When to demand a second factor, as a decision with no I/O in it.
 *
 * Split out from `assurance.ts` so the rule can be tested against every
 * combination rather than inferred from a Supabase response, and so the honest
 * awkwardness in it is written down somewhere reviewable.
 */

export type StepUpOutcome =
  /** This session completed a second factor. Proceed. */
  | 'satisfied'
  /** The account has a factor and this session has not used it. Challenge. */
  | 'challenge'
  /**
   * The account has no second factor at all.
   *
   * Step-up cannot protect an account that has nothing to step up to, so this
   * outcome asks the caller a question rather than answering it: for a
   * low-stakes action, proceed and record the gap; for a confidential one,
   * refuse and send them to enrol.
   *
   * See `isConfidentialAction` — the operator has made that call, and it is
   * encoded there rather than decided at each call site.
   */
  | 'unprotected';

export interface AssuranceInput {
  /** What this session actually did. */
  current: 'aal1' | 'aal2' | null;
  /** What the account is capable of. */
  next: 'aal1' | 'aal2' | null;
}

/**
 * The distinction the whole thing rests on: `next` says the account has MFA
 * enrolled, `current` says this session used it. Somebody holding a stolen
 * session cookie also has MFA enrolled — gating on `next` protects nobody.
 */
export function stepUpOutcome(assurance: AssuranceInput): StepUpOutcome {
  if (assurance.current === 'aal2') return 'satisfied';
  if (assurance.next === 'aal2') return 'challenge';
  return 'unprotected';
}

/**
 * Actions where a stolen session is the threat, rather than a stolen password.
 *
 * Named rather than boolean so the audit entry says which one, and so adding a
 * call site is a deliberate edit to this list rather than a flag somebody
 * passes at the call site and nobody reviews.
 */
export const STEP_UP_ACTIONS = {
  /** Opening a document held in a deal's vault. */
  documentDownload: 'document.download',
  /** Reading a listing's confidential half — the name, address and exact figures. */
  confidentialProfile: 'listing.confidential',
  /** A seller issuing a confidentiality agreement, which releases that half. */
  ndaIssue: 'nda.issue',
  /** Entering a deal room, where the documents and the negotiation live. */
  dealRoom: 'deal_room.enter',
  commissionSettings: 'commission.settings',
  mfaRemoval: 'mfa.remove',
} as const;

/**
 * The actions where an account with no second factor must enrol rather than
 * proceed.
 *
 * This list is the operator's policy, written down. The earlier version of this
 * module deferred the question — it let an unprotected account through and
 * recorded the gap, on the reasoning that blocking would put a wall in front of
 * somebody closing a deal, and noted that the real answer was requiring MFA on
 * the roles that touch a data room.
 *
 * That decision has now been taken: everything that reaches somebody else's
 * confidential financials requires a second factor. The trade is deliberate and
 * narrow — signing up, browsing the anonymous market, editing your own listing
 * and running a valuation all stay frictionless, because none of them exposes
 * another person's data. The prompt appears at the moment somebody asks for
 * information a seller was promised control over, which is also the moment they
 * are most willing to accept it.
 *
 * Commission settings stay best-effort: it is the firm's own money, not a third
 * party's confidential information, and a hard block there is a wall with
 * nothing behind it.
 */
const CONFIDENTIAL_ACTIONS = new Set<string>([
  STEP_UP_ACTIONS.documentDownload,
  STEP_UP_ACTIONS.confidentialProfile,
  STEP_UP_ACTIONS.ndaIssue,
  STEP_UP_ACTIONS.dealRoom,
]);

export function isConfidentialAction(action: StepUpAction): boolean {
  return CONFIDENTIAL_ACTIONS.has(action);
}

/** What a caller should actually do, given the action and the session. */
export type StepUpDecision = 'proceed' | 'challenge' | 'enrol' | 'proceed_unprotected';

/**
 * The whole rule in one place.
 *
 * Kept separate from `stepUpOutcome` so the raw session fact ("did this session
 * use a second factor") stays distinct from the policy applied to it. A future
 * change to what counts as confidential touches the set above and nothing else.
 */
export function stepUpDecision(
  action: StepUpAction,
  assurance: AssuranceInput,
): StepUpDecision {
  const outcome = stepUpOutcome(assurance);

  if (outcome === 'satisfied') return 'proceed';
  if (outcome === 'challenge') return 'challenge';
  return isConfidentialAction(action) ? 'enrol' : 'proceed_unprotected';
}

export type StepUpAction = (typeof STEP_UP_ACTIONS)[keyof typeof STEP_UP_ACTIONS];

/** What to tell somebody, in their words rather than the protocol's. */
export function stepUpPrompt(action: StepUpAction): string {
  switch (action) {
    case 'document.download':
      return 'Confirm with your authenticator app before opening a confidential document.';
    case 'listing.confidential':
      return 'Confirm with your authenticator app before opening a business’s confidential profile.';
    case 'nda.issue':
      return 'Confirm with your authenticator app before releasing your confidential information.';
    case 'deal_room.enter':
      return 'Confirm with your authenticator app before entering a deal room.';
    case 'commission.settings':
      return 'Confirm with your authenticator app before changing what your firm charges.';
    case 'mfa.remove':
      return 'Confirm with your authenticator app before removing a second factor.';
  }
}

/**
 * What to tell somebody who has no second factor at all and has just asked for
 * something that requires one.
 *
 * Separate from `stepUpPrompt` because it is a different sentence with a
 * different call to action: not "confirm", but "you need to set this up, and
 * here is why it is being asked of you now rather than at sign-up".
 */
export function enrolPrompt(action: StepUpAction): string {
  switch (action) {
    case 'listing.confidential':
      return 'Set up two-factor authentication to see a business’s confidential profile. Sellers release this on the condition that only the person they approved can read it.';
    case 'nda.issue':
      return 'Set up two-factor authentication before releasing your confidential information, so a stolen session cannot release it for you.';
    case 'deal_room.enter':
      return 'Set up two-factor authentication to enter a deal room. Deal rooms hold financials and documents belonging to somebody else.';
    case 'document.download':
      return 'Set up two-factor authentication to open confidential documents.';
    default:
      return 'Set up two-factor authentication to continue.';
  }
}
