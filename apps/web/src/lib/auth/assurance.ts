import 'server-only';

import { cache } from 'react';

import { createClient } from '../supabase/server';
import {
  enrolPrompt,
  stepUpDecision,
  stepUpOutcome,
  type StepUpAction,
  type StepUpOutcome,
} from './step-up-policy';

export {
  STEP_UP_ACTIONS,
  enrolPrompt,
  isConfidentialAction,
  stepUpDecision,
  stepUpPrompt,
  type StepUpAction,
  type StepUpDecision,
  type StepUpOutcome,
} from './step-up-policy';

/**
 * Authenticator Assurance Level.
 *
 * `aal1` — signed in with a password.
 * `aal2` — signed in and completed a second factor **in this session**.
 *
 * The distinction that matters: `nextLevel` tells you what the account is
 * capable of, `currentLevel` tells you what this session actually did. Gating on
 * "the user has MFA enrolled" is not a check — someone holding a stolen session
 * cookie also has MFA enrolled. Gating on `currentLevel === 'aal2'` is.
 */

export type AssuranceLevel = 'aal1' | 'aal2';

export interface AssuranceState {
  current: AssuranceLevel | null;
  next: AssuranceLevel | null;
  /** The account has at least one verified factor. */
  hasEnrolledFactor: boolean;
  /** Enrolled, but this session has not completed the challenge. */
  needsStepUp: boolean;
}

export const getAssuranceState = cache(async (): Promise<AssuranceState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !data) {
    return { current: null, next: null, hasEnrolledFactor: false, needsStepUp: false };
  }

  const current = data.currentLevel as AssuranceLevel | null;
  const next = data.nextLevel as AssuranceLevel | null;

  return {
    current,
    next,
    hasEnrolledFactor: next === 'aal2',
    needsStepUp: next === 'aal2' && current !== 'aal2',
  };
});

/**
 * Guard for actions where a stolen session is the threat rather than a stolen
 * password: downloading confidential documents, changing commission settings,
 * removing a second factor, exporting a deal's message history.
 *
 * Throws rather than returning a boolean, because these are call sites where
 * forgetting to check the result fails open.
 *
 * Deliberately *not* wired into the middleware. Step-up is a per-action
 * decision, and a blanket rule would either be too coarse to be useful or would
 * push people into re-authenticating so often they stop reading the prompt.
 */
export async function requireStepUp(action: string): Promise<void> {
  const assurance = await getAssuranceState();

  if (assurance.current !== 'aal2') {
    throw new StepUpRequiredError(action, assurance.hasEnrolledFactor);
  }
}

/**
 * The form the product actually uses.
 *
 * `requireStepUp` blocks unconditionally, which is right for removing a second
 * factor — somebody with no factor has nothing to remove — and wrong for
 * everything else, because it would mean "download this document, or first go
 * and enrol in MFA". That reads as a security feature and functions as a wall
 * in front of the product on the day somebody is closing a deal.
 *
 * So this enforces step-up for every account that *can* step up, and reports
 * the gap for the rest rather than hiding it. The caller records the
 * `unprotected` outcome in the audit log, which is what makes "how many
 * confidential downloads happened without a second factor" a question the
 * operator can answer — and the answer is the argument for requiring MFA on the
 * roles that touch a data room, which is their policy call and not this
 * function's.
 */
export async function stepUpIfPossible(action: StepUpAction): Promise<StepUpOutcome> {
  const assurance = await getAssuranceState();

  const outcome = stepUpOutcome({ current: assurance.current, next: assurance.next });
  if (outcome === 'challenge') {
    throw new StepUpRequiredError(action, true);
  }

  return outcome;
}

export class StepUpRequiredError extends Error {
  readonly action: string;
  /** False means the user has no second factor to step up with — they must enrol. */
  readonly canStepUp: boolean;

  constructor(action: string, canStepUp: boolean, message?: string) {
    super(
      message ??
        (canStepUp
          ? 'Confirm with your authenticator app to continue.'
          : 'Set up two-factor authentication to continue.'),
    );
    this.name = 'StepUpRequiredError';
    this.action = action;
    this.canStepUp = canStepUp;
  }
}

/**
 * The guard for anything that reaches somebody else's confidential
 * information.
 *
 * Differs from `stepUpIfPossible` in exactly one case, and it is the case that
 * matters: an account with no second factor is refused and sent to enrol,
 * rather than proceeding with the gap recorded. That is the operator policy
 * described in `step-up-policy.ts` — a seller releases their financials on the
 * understanding that only the person they approved can read them, and "approved
 * person, or anyone holding their session cookie" is not that.
 *
 * Throws rather than returning, because every call site here fails open if the
 * result is ignored.
 */
export async function requireConfidentialAssurance(action: StepUpAction): Promise<void> {
  const assurance = await getAssuranceState();
  const decision = stepUpDecision(action, { current: assurance.current, next: assurance.next });

  if (decision === 'challenge') throw new StepUpRequiredError(action, true);
  if (decision === 'enrol') throw new StepUpRequiredError(action, false, enrolPrompt(action));
}
