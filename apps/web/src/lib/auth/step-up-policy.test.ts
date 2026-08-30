import { describe, expect, it } from 'vitest';

import {
  STEP_UP_ACTIONS,
  enrolPrompt,
  stepUpDecision,
  stepUpOutcome,
  stepUpPrompt,
  type AssuranceInput,
} from './step-up-policy';

describe('stepUpOutcome', () => {
  it('is satisfied only when this session completed a second factor', () => {
    expect(stepUpOutcome({ current: 'aal2', next: 'aal2' })).toBe('satisfied');
  });

  it('challenges a session that has a factor available and has not used it', () => {
    // The case the whole guard exists for: a stolen session cookie on an
    // account that does have MFA. `next` says the account can; `current` says
    // this session did not.
    expect(stepUpOutcome({ current: 'aal1', next: 'aal2' })).toBe('challenge');
  });

  it('never treats "has MFA enrolled" as "has authenticated with MFA"', () => {
    // Gating on `next` would let a stolen session straight through, because a
    // stolen session belongs to an account that also has MFA enrolled.
    const stolen: AssuranceInput = { current: 'aal1', next: 'aal2' };
    expect(stepUpOutcome(stolen)).not.toBe('satisfied');
  });

  it('reports an account with no factor as unprotected rather than blocking it', () => {
    // Blocking would read as a security feature and function as a wall in front
    // of the product on the day somebody is closing a deal. The gap is recorded
    // instead of hidden.
    expect(stepUpOutcome({ current: 'aal1', next: 'aal1' })).toBe('unprotected');
  });

  it('treats an unreadable assurance state as unprotected, not as satisfied', () => {
    // Failing open on "satisfied" would turn an outage in the auth service into
    // a silent removal of the control.
    expect(stepUpOutcome({ current: null, next: null })).toBe('unprotected');
  });

  it('covers every combination without falling through', () => {
    const levels: AssuranceInput['current'][] = ['aal1', 'aal2', null];

    for (const current of levels) {
      for (const next of levels) {
        const outcome = stepUpOutcome({ current, next });
        expect(['satisfied', 'challenge', 'unprotected']).toContain(outcome);
        // The only route to "satisfied" is this session having done it.
        if (outcome === 'satisfied') expect(current).toBe('aal2');
      }
    }
  });
});

describe('stepUpPrompt', () => {
  it('says what is about to happen, not what protocol level is missing', () => {
    for (const action of Object.values(STEP_UP_ACTIONS)) {
      const prompt = stepUpPrompt(action);
      expect(prompt).not.toMatch(/aal|assurance|factor level/i);
      expect(prompt.length).toBeGreaterThan(20);
    }
  });

  it('names the specific thing being protected', () => {
    expect(stepUpPrompt('document.download')).toMatch(/document/i);
    expect(stepUpPrompt('commission.settings')).toMatch(/charge|fee|commission/i);
  });
});

describe('stepUpDecision — the confidential tier', () => {
  const noFactor = { current: 'aal1', next: 'aal1' } as const;
  const enrolledNotUsed = { current: 'aal1', next: 'aal2' } as const;
  const stepped = { current: 'aal2', next: 'aal2' } as const;

  const CONFIDENTIAL = [
    STEP_UP_ACTIONS.documentDownload,
    STEP_UP_ACTIONS.confidentialProfile,
    STEP_UP_ACTIONS.ndaIssue,
    STEP_UP_ACTIONS.dealRoom,
    STEP_UP_ACTIONS.adminPanel,
  ] as const;

  it('sends an account with no second factor to enrol, for anything confidential', () => {
    /*
     * The behaviour change this tier exists for. It used to proceed and record
     * the gap; a seller releases their financials on the understanding that
     * only the person they approved can read them, and "that person, or anyone
     * holding their session cookie" is not that.
     */
    for (const action of CONFIDENTIAL) {
      expect(stepUpDecision(action, noFactor), action).toBe('enrol');
    }
  });

  it('challenges an account that has a factor it has not used this session', () => {
    // The important distinction: having MFA enrolled protects nobody if this
    // session never completed it. A stolen cookie is also "enrolled".
    for (const action of CONFIDENTIAL) {
      expect(stepUpDecision(action, enrolledNotUsed), action).toBe('challenge');
    }
  });

  it('lets a stepped-up session straight through', () => {
    for (const action of CONFIDENTIAL) {
      expect(stepUpDecision(action, stepped), action).toBe('proceed');
    }
  });

  it('does not block a firm changing its own commission settings', () => {
    /*
     * Deliberately best-effort, and the reason is the line the tier is drawn
     * on: commission is the firm's own money, not a third party's confidential
     * information. A hard block there is friction with nothing behind it.
     */
    expect(stepUpDecision(STEP_UP_ACTIONS.commissionSettings, noFactor)).toBe(
      'proceed_unprotected',
    );
    expect(stepUpDecision(STEP_UP_ACTIONS.commissionSettings, enrolledNotUsed)).toBe('challenge');
  });

  it('classifies every action deliberately', () => {
    // A new action added to STEP_UP_ACTIONS and forgotten here would silently
    // default to the lenient tier, which is the wrong way round to fail.
    const classified = new Set<string>([...CONFIDENTIAL, STEP_UP_ACTIONS.commissionSettings, STEP_UP_ACTIONS.mfaRemoval]);
    for (const action of Object.values(STEP_UP_ACTIONS)) {
      expect(classified.has(action), `${action} has not been placed in a tier`).toBe(true);
    }
  });

  it('gives every action a prompt in both voices', () => {
    // A missing case would render as undefined at the moment somebody is being
    // asked to do something unusual, which is when clarity matters most.
    for (const action of Object.values(STEP_UP_ACTIONS)) {
      expect(stepUpPrompt(action), action).toMatch(/\S/);
      expect(enrolPrompt(action), action).toMatch(/\S/);
    }
  });

  it('explains why the second factor is being asked for, not just that it is', () => {
    // "Set up 2FA to continue" reads as an obstacle. Naming whose data is at
    // stake is what makes somebody do it rather than leave.
    expect(enrolPrompt(STEP_UP_ACTIONS.confidentialProfile).toLowerCase()).toContain('sellers');
    expect(enrolPrompt(STEP_UP_ACTIONS.dealRoom).toLowerCase()).toContain('somebody else');
  });
});
