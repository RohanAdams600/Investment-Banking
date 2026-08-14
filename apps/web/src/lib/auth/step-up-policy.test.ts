import { describe, expect, it } from 'vitest';

import {
  STEP_UP_ACTIONS,
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
