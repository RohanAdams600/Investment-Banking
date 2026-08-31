import { describe, expect, it } from 'vitest';

import { nextActions, setupProgress, type AccountState } from './next-actions';

const base: AccountState = {
  roles: [],
  hasDisplayName: false,
  hasSecondFactor: false,
  listingCount: 0,
  draftListingCount: 0,
  liveListingCount: 0,
  listingsMissingConfidential: 0,
  pendingNdaRequests: 0,
  hasAcquisitionCriteria: false,
  fundingVerification: 'none',
  savedListingCount: 0,
  signedNdaCount: 0,
};

const seller = (over: Partial<AccountState> = {}): AccountState => ({
  ...base,
  roles: ['seller'],
  ...over,
});
const buyer = (over: Partial<AccountState> = {}): AccountState => ({
  ...base,
  roles: ['buyer'],
  ...over,
});

const ids = (state: AccountState) => nextActions(state).map((a) => a.id);

describe('nextActions', () => {
  it('never offers a step the account cannot take', () => {
    /*
     * The failure that teaches somebody the product is not paying attention: a
     * buyer told to list a business, or a seller told to set acquisition
     * criteria. A door that does not open is worse than no door.
     */
    expect(ids(buyer())).not.toContain('first-listing');
    expect(ids(buyer())).not.toContain('confidential-half');
    expect(ids(seller())).not.toContain('criteria');
    expect(ids(seller())).not.toContain('funding');
  });

  it('offers both sides to somebody who is both', () => {
    const both = { ...base, roles: ['buyer', 'seller'] as AccountState['roles'] };
    expect(ids(both)).toContain('first-listing');
    expect(ids(both)).toContain('criteria');
  });

  it('treats a broker as sell side', () => {
    // Brokers list on behalf of clients. Gating on the role name rather than
    // the capability would have missed them.
    expect(ids({ ...base, roles: ['broker'] })).toContain('first-listing');
  });

  it('does not suggest completing a listing that does not exist', () => {
    // A step somebody cannot start reads as noise, and it never turns green.
    expect(ids(seller({ listingCount: 0 }))).not.toContain('confidential-half');
    expect(ids(seller({ listingCount: 1 }))).toContain('confidential-half');
  });

  it('puts somebody else waiting on you above your own setup', () => {
    /*
     * A half-finished profile costs the account nothing today. A buyer waiting
     * four days for an answer is a deal going cold, and the seller is the only
     * one who can unblock it.
     */
    const state = seller({ pendingNdaRequests: 2, listingCount: 1, liveListingCount: 1 });
    expect(nextActions(state)[0]?.id).toBe('nda-requests');
  });

  it('counts waiting buyers in the singular and the plural', () => {
    expect(nextActions(seller({ pendingNdaRequests: 1 }))[0]?.title).toContain('A buyer is waiting');
    expect(nextActions(seller({ pendingNdaRequests: 3 }))[0]?.title).toContain('3 buyers');
  });

  it('returns finished steps rather than dropping them', () => {
    // A checklist that only shows what is left never visibly gets shorter, and
    // the shortening is what makes people finish.
    const done = seller({ hasDisplayName: true, hasSecondFactor: true, listingCount: 1 });
    const name = nextActions(done).find((a) => a.id === 'display-name');
    expect(name).toBeDefined();
    expect(name?.done).toBe(true);
  });

  it('tells a buyer under review that there is nothing to do', () => {
    /*
     * The state that most often produces a support message. Somebody who has
     * submitted and hears nothing assumes it is broken; saying "a person is
     * reading it" costs a sentence and prevents the email.
     */
    const pending = nextActions(buyer({ fundingVerification: 'pending' })).find(
      (a) => a.id === 'funding',
    );
    expect(pending?.title).toContain('being reviewed');
    expect(pending?.body).toContain('Nothing to do');
    expect(pending?.done).toBe(false);
  });

  it('does not blame a buyer whose verification was not confirmed', () => {
    // Usually a missing document rather than anything about them, and phrasing
    // it as a judgement loses a buyer who would have resubmitted.
    const rejected = nextActions(buyer({ fundingVerification: 'rejected' })).find(
      (a) => a.id === 'funding',
    );
    expect(rejected?.body).toContain('document was missing');
  });

  it('marks funding done only when it is actually verified', () => {
    for (const status of ['none', 'pending', 'rejected'] as const) {
      const action = nextActions(buyer({ fundingVerification: status })).find(
        (a) => a.id === 'funding',
      );
      expect(action?.done, status).toBe(false);
    }
    const verified = nextActions(buyer({ fundingVerification: 'verified' })).find(
      (a) => a.id === 'funding',
    );
    expect(verified?.done).toBe(true);
  });

  it('gives every action a destination and a distinct id', () => {
    const all = nextActions({ ...base, roles: ['buyer', 'seller', 'broker'], listingCount: 1 });
    const seen = new Set<string>();
    for (const action of all) {
      expect(action.href.startsWith('/'), action.id).toBe(true);
      expect(action.cta.length, action.id).toBeGreaterThan(0);
      expect(seen.has(action.id), `${action.id} appears twice`).toBe(false);
      seen.add(action.id);
    }
  });

  it('explains why each step matters rather than what the button does', () => {
    // "Click here to add your name" is not a reason. Every body should say what
    // the person gains or risks, which is what makes somebody act.
    for (const action of nextActions({ ...base, roles: ['buyer', 'seller'], listingCount: 1 })) {
      expect(action.body.length, action.id).toBeGreaterThan(40);
      expect(action.body.toLowerCase(), action.id).not.toContain('click');
    }
  });
});

describe('setupProgress', () => {
  it('reaches 100 only when everything is finished', () => {
    const unfinished = setupProgress(nextActions(seller()));
    expect(unfinished.percent).toBeLessThan(100);

    const finished = setupProgress(
      nextActions(
        seller({
          hasDisplayName: true,
          hasSecondFactor: true,
          listingCount: 1,
          liveListingCount: 1,
          listingsMissingConfidential: 0,
        }),
      ),
    );
    expect(finished.percent).toBe(100);
    expect(finished.next).toBeNull();
  });

  it('does not go backwards when a buyer asks a question', () => {
    /*
     * The bug this guards. "Waiting on you" is not setup — it recurs — so
     * counting it in the denominator would drop a completed seller from 100%
     * every time somebody requested access. A progress bar that falls for doing
     * well is one people stop trusting.
     */
    const complete = seller({
      hasDisplayName: true,
      hasSecondFactor: true,
      listingCount: 1,
      liveListingCount: 1,
    });

    const quiet = setupProgress(nextActions(complete));
    const busy = setupProgress(nextActions({ ...complete, pendingNdaRequests: 4 }));

    expect(quiet.percent).toBe(100);
    expect(busy.percent).toBe(100);
    expect(busy.total).toBe(quiet.total);
  });

  it('points at the first outstanding thing, including a waiting buyer', () => {
    const state = seller({ hasDisplayName: true, pendingNdaRequests: 1 });
    expect(setupProgress(nextActions(state)).next?.id).toBe('nda-requests');
  });

  it('never divides by zero', () => {
    expect(setupProgress([]).percent).toBe(100);
  });
});
