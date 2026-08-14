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
   * This is the awkward case, and it is worth being blunt: step-up cannot
   * protect an account that has nothing to step up to. Blocking here would mean
   * "download a document, or first enrol in MFA", which reads as a security
   * feature and functions as a wall in front of the product on the day somebody
   * is trying to close a deal.
   *
   * So the action proceeds and the gap is recorded rather than hidden. The real
   * answer is requiring MFA for the roles that touch confidential documents,
   * which is an operator policy, not something this function should decide on
   * their behalf.
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
  documentDownload: 'document.download',
  commissionSettings: 'commission.settings',
  mfaRemoval: 'mfa.remove',
} as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[keyof typeof STEP_UP_ACTIONS];

/** What to tell somebody, in their words rather than the protocol's. */
export function stepUpPrompt(action: StepUpAction): string {
  switch (action) {
    case 'document.download':
      return 'Confirm with your authenticator app before opening a confidential document.';
    case 'commission.settings':
      return 'Confirm with your authenticator app before changing what your firm charges.';
    case 'mfa.remove':
      return 'Confirm with your authenticator app before removing a second factor.';
  }
}
