import { describe, expect, it } from 'vitest';

import {
  READINESS_THRESHOLDS,
  analyseReadiness,
  headlineNamesBusiness,
  summariseReadiness,
  type ListingSnapshot,
} from './readiness';

const ready: ListingSnapshot = {
  headline: 'Established route-based home services business, Northeast',
  industry: 'home_services',
  jurisdictionCode: 'US-NY',
  askingPriceCents: 180_000_000,
  hasProfile: true,
  legalName: 'Anchor Route Services LLC',
  revenueCents: 420_000_000,
  sdeCents: 90_000_000,
  ebitdaCents: 70_000_000,
  customerConcentration: 0.12,
  ownerDependence: 2,
  employeeCount: 14,
  yearsInBusiness: 19,
  financialYears: 3,
  financialsAreRecent: true,
};

const codes = (snapshot: ListingSnapshot) => analyseReadiness(snapshot).map((f) => f.code);

describe('analyseReadiness', () => {
  it('finds nothing wrong with a listing that is ready', () => {
    // A checker that always finds something is a checker people learn to
    // ignore, so "nothing to fix" has to be a reachable outcome.
    expect(analyseReadiness(ready)).toEqual([]);
    expect(summariseReadiness(ready).readyForReview).toBe(true);
  });

  it('blocks a listing with no confidential profile', () => {
    expect(codes({ ...ready, hasProfile: false })).toContain('no_profile');
    expect(summariseReadiness({ ...ready, hasProfile: false }).readyForReview).toBe(false);
  });

  it('blocks a listing with no financial years', () => {
    const snapshot = { ...ready, financialYears: 0 };
    expect(codes(snapshot)).toContain('no_financials');
  });

  it('does not also complain about thin financials when there are none at all', () => {
    // Two findings for one problem is how a list of ten becomes a list nobody
    // reads.
    const snapshot = { ...ready, financialYears: 0 };
    expect(codes(snapshot)).not.toContain('thin_financials');
  });

  it('orders blocking findings before everything else', () => {
    const snapshot = { ...ready, hasProfile: false, employeeCount: null };
    const severities = analyseReadiness(snapshot).map((f) => f.severity);
    expect(severities[0]).toBe('blocking');
    expect(severities[severities.length - 1]).toBe('note');
  });

  it('carries the number that produced each finding', () => {
    // "Your concentration is a concern" is an opinion nobody can argue with.
    // "60% of revenue, and buyers discount above 30%" is a fact and a stated
    // convention, and the seller can disagree with the convention out loud.
    const snapshot = { ...ready, customerConcentration: 0.6 };
    const finding = analyseReadiness(snapshot).find((f) => f.code === 'severe_concentration');
    expect(finding?.evidence).toMatch(/60%/);
  });

  it('gives every finding something to actually do', () => {
    const snapshot: ListingSnapshot = {
      ...ready,
      hasProfile: false,
      financialYears: 1,
      financialsAreRecent: false,
      customerConcentration: 0.45,
      ownerDependence: 5,
      askingPriceCents: null,
      employeeCount: null,
      yearsInBusiness: null,
      jurisdictionCode: null,
    };

    for (const finding of analyseReadiness(snapshot)) {
      expect(finding.action.length).toBeGreaterThan(20);
      // "Consider improving" is not an action.
      expect(finding.action).not.toMatch(/^consider/i);
    }
  });

  it('escalates concentration rather than reporting it twice', () => {
    const severe = codes({ ...ready, customerConcentration: 0.6 });
    expect(severe).toContain('severe_concentration');
    expect(severe).not.toContain('customer_concentration');
  });

  it('says nothing about concentration that is not there', () => {
    expect(codes({ ...ready, customerConcentration: null })).not.toContain(
      'customer_concentration',
    );
    expect(codes({ ...ready, customerConcentration: 0.05 })).not.toContain(
      'customer_concentration',
    );
  });

  it('treats the threshold itself as crossing it', () => {
    const at = codes({
      ...ready,
      customerConcentration: READINESS_THRESHOLDS.customerConcentration,
    });
    expect(at).toContain('customer_concentration');
  });

  it('never gives a score out of 100', () => {
    // A number invites "get it to 80" and hides which of the two remaining
    // problems is the one that matters.
    const summary = summariseReadiness({ ...ready, hasProfile: false });
    expect(Object.keys(summary)).toEqual([
      'findings',
      'blocking',
      'important',
      'notes',
      'readyForReview',
    ]);
  });

  it('counts each finding into exactly one bucket', () => {
    const snapshot: ListingSnapshot = {
      ...ready,
      hasProfile: false,
      financialYears: 1,
      askingPriceCents: null,
      employeeCount: null,
    };
    const summary = summariseReadiness(snapshot);
    expect(summary.blocking + summary.important + summary.notes).toBe(summary.findings.length);
  });
});

describe('headlineNamesBusiness', () => {
  it('catches the most common way a confidential listing stops being confidential', () => {
    expect(
      headlineNamesBusiness('Anchor Route Services for sale', 'Anchor Route Services LLC'),
    ).toBe(true);
  });

  it('catches a partial mention', () => {
    // Not malice. The headline is the first field and naming the thing is the
    // natural way to describe it.
    expect(
      headlineNamesBusiness("Anchor's established route business", 'Anchor Route Services LLC'),
    ).toBe(true);
  });

  it('ignores the corporate noise words', () => {
    // Otherwise every headline containing "the" or "group" would be flagged.
    expect(headlineNamesBusiness('The established group of route customers', 'Acme LLC')).toBe(
      false,
    );
    expect(headlineNamesBusiness('An LLC in the Northeast', 'Anchor Route Services LLC')).toBe(
      false,
    );
  });

  it('passes a properly anonymous headline', () => {
    expect(
      headlineNamesBusiness(
        'Established route-based home services business, Northeast',
        'Anchor Route Services LLC',
      ),
    ).toBe(false);
  });

  it('says nothing when there is nothing to compare against', () => {
    expect(headlineNamesBusiness(null, 'Anchor LLC')).toBe(false);
    expect(headlineNamesBusiness('Anything', null)).toBe(false);
    expect(headlineNamesBusiness('Anything', 'LLC')).toBe(false);
  });

  it('is case-insensitive, because a shouted name is still the name', () => {
    expect(headlineNamesBusiness('ANCHOR ROUTE for sale', 'Anchor Route Services LLC')).toBe(true);
  });
});

describe('headlineNamesBusiness: one word is a coincidence', () => {
  it('does not flag a headline that shares a single industry word', () => {
    // The bug this rule exists for. A route business is described as
    // route-based whether or not the company is called Anchor Route Services,
    // and flagging on one shared word puts a warning on correctly-written
    // headlines — which is how a warning becomes something people click past.
    expect(
      headlineNamesBusiness(
        'Established route-based business, Northeast',
        'Anchor Route Services LLC',
      ),
    ).toBe(false);
  });

  it('flags as soon as a second distinctive word appears', () => {
    expect(
      headlineNamesBusiness('Anchor route business for sale', 'Anchor Route Services LLC'),
    ).toBe(true);
  });

  it('needs only one match when the name has only one distinctive word', () => {
    expect(headlineNamesBusiness('Acme for sale', 'Acme LLC')).toBe(true);
    expect(headlineNamesBusiness('A business for sale', 'Acme LLC')).toBe(false);
  });

  it('matches whole words, so a name inside another word does not count', () => {
    expect(headlineNamesBusiness('Rerouted logistics group', 'Route Group LLC')).toBe(false);
  });

  it('ignores the generic half of a name entirely', () => {
    // "Services Solutions Group LLC" has no distinctive word at all, so nothing
    // it shares with a headline is evidence of anything.
    expect(
      headlineNamesBusiness('Business services solutions group', 'Services Solutions Group LLC'),
    ).toBe(false);
  });
});
