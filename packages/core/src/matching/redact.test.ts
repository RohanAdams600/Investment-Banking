import { describe, expect, it } from 'vitest';

import { scoreFit, type AcquisitionCriteria, type ListingProfile } from '../criteria/model';
import { redactExclusionReason, redactFitResult, redactReason } from './redact';

/**
 * The matcher scores against figures the buyer is not entitled to see. These
 * tests are the thing standing between an accurate score and a disclosure.
 *
 * The last test in this file is the important one. Every other test here checks
 * a case somebody thought of; that one checks the cases nobody thought of, by
 * asserting no digit survives redaction across a wide sweep of inputs. A new
 * reason added to the scoring model that quotes a figure fails it without
 * anyone having to remember this file exists.
 */

const baseCriteria: AcquisitionCriteria = {
  industries: ['home_services'],
  jurisdictions: ['US-NY'],
  revenueMin: 200_000_000,
  revenueMax: 600_000_000,
  earningsMin: 50_000_000,
  earningsMax: 150_000_000,
  dealSizeMax: 500_000_000,
  dealStructure: 'asset',
  involvement: 'either',
  maxCustomerConcentration: 0.4,
  minRecurringRevenueShare: 0.2,
};

const baseListing: ListingProfile = {
  industry: 'home_services',
  jurisdiction: 'US-NY',
  revenue: 420_000_000,
  earnings: 95_000_000,
  askingPrice: 380_000_000,
  dealStructure: 'asset',
  customerConcentration: 0.12,
  recurringRevenueShare: 0.55,
  ownerDependence: 'moderate',
};

/** Every string a buyer could read off a redacted result. */
function allText(result: ReturnType<typeof redactFitResult>): string {
  return [
    ...result.exclusionReasons,
    ...result.allReasons.map((r) => `${r.label} ${r.detail}`),
    ...result.topReasons.map((r) => `${r.label} ${r.detail}`),
  ].join(' ');
}

describe('redactReason', () => {
  it('replaces the quality reason, which is built from confidential figures', () => {
    const scored = scoreFit(baseCriteria, { ...baseListing, customerConcentration: 0.45 });
    const quality = scored.allReasons.find((r) => r.label === 'Business quality')!;

    // The unredacted version names the number. That is the whole problem.
    expect(quality.detail).toMatch(/\d/);

    const redacted = redactReason(quality);
    expect(redacted.detail).not.toMatch(/\d/);
    expect(redacted.detail).toContain('full profile');
  });

  it('keeps the points, which drive the ordering', () => {
    const scored = scoreFit(baseCriteria, baseListing);
    for (const reason of scored.allReasons) {
      expect(redactReason(reason).points).toBe(reason.points);
    }
  });

  it('leaves a reason with no figures readable', () => {
    const scored = scoreFit(baseCriteria, baseListing);
    const industry = scored.allReasons.find((r) => r.label === 'Industry match')!;

    // Nothing to hide here, so nothing should be mangled.
    expect(redactReason(industry).detail).toBe(industry.detail);
  });
});

describe('redactExclusionReason', () => {
  it('keeps which limit was missed without the figure', () => {
    const scored = scoreFit(baseCriteria, { ...baseListing, customerConcentration: 0.62 });
    expect(scored.exclusionReasons[0]).toMatch(/\d/);

    const redacted = redactExclusionReason(scored.exclusionReasons[0]!);
    expect(redacted).not.toMatch(/\d/);
    // The buyer still learns the actionable part: it failed *their* concentration
    // limit, so widening that limit is what would surface it.
    expect(redacted.toLowerCase()).toContain('customer concentration');
  });

  it('handles the recurring revenue limit', () => {
    const redacted = redactExclusionReason('Recurring revenue is 8%, below your 20% minimum.');
    expect(redacted).not.toMatch(/\d/);
    expect(redacted.toLowerCase()).toContain('recurring revenue');
  });

  it('handles the deal size limit', () => {
    const redacted = redactExclusionReason('Asking price is above the maximum deal size you set.');
    expect(redacted.toLowerCase()).toContain('asking price');
  });

  it('says something safe about a rule it does not recognise', () => {
    // A new exclusion added to the scoring model reaches this branch. Saying
    // nothing specific beats guessing and quoting the seller's numbers back.
    const redacted = redactExclusionReason(
      'Franchise royalty is 7.5% of gross, above your 5% cap.',
    );
    expect(redacted).not.toMatch(/\d/);
    expect(redacted).toBe('This listing falls outside a limit you set.');
  });
});

describe('redactFitResult', () => {
  it('preserves the score', () => {
    const scored = scoreFit(baseCriteria, baseListing);
    expect(redactFitResult(scored).score).toBe(scored.score);
  });

  it('preserves exclusion and ordering', () => {
    const scored = scoreFit(baseCriteria, { ...baseListing, customerConcentration: 0.9 });
    const redacted = redactFitResult(scored);

    expect(redacted.excluded).toBe(true);
    expect(redacted.exclusionReasons).toHaveLength(scored.exclusionReasons.length);
    expect(redacted.topReasons.map((r) => r.points)).toEqual(
      scored.topReasons.map((r) => r.points),
    );
  });

  it('never lets a figure through, across every shape of input', () => {
    // The test that does the real work. Rather than checking the cases the
    // redaction was written for, it sweeps the input space and asserts the
    // invariant: nothing a buyer can read contains a digit.
    //
    // A figure reaching a buyer pre-NDA is the failure this whole subsystem
    // exists to prevent, and it would not be noticed by reading the diff that
    // caused it.
    const concentrations = [undefined, 0, 0.05, 0.12, 0.39, 0.4, 0.41, 0.75, 1];
    const recurring = [undefined, 0, 0.19, 0.2, 0.21, 0.8, 1];
    const dependences: Array<ListingProfile['ownerDependence']> = [
      undefined,
      'absentee',
      'moderate',
      'critical',
    ];
    const involvements: Array<AcquisitionCriteria['involvement']> = [
      'either',
      'passive',
      'owner_operator',
    ];
    const revenues = [1, 199_999_999, 420_000_000, 600_000_001, 90_000_000_000];
    const structures: Array<ListingProfile['dealStructure']> = ['asset', 'stock'];

    let checked = 0;

    for (const customerConcentration of concentrations) {
      for (const recurringRevenueShare of recurring) {
        for (const ownerDependence of dependences) {
          for (const involvement of involvements) {
            for (const revenue of revenues) {
              for (const dealStructure of structures) {
                const result = redactFitResult(
                  scoreFit(
                    { ...baseCriteria, involvement },
                    {
                      ...baseListing,
                      customerConcentration,
                      recurringRevenueShare,
                      ownerDependence,
                      revenue,
                      dealStructure,
                    },
                  ),
                );

                const text = allText(result);
                expect(
                  text,
                  `leaked a figure for concentration=${customerConcentration} ` +
                    `recurring=${recurringRevenueShare} revenue=${revenue}`,
                ).not.toMatch(/\d/);

                checked += 1;
              }
            }
          }
        }
      }
    }

    // Guards against the sweep silently collapsing to nothing after an edit.
    expect(checked).toBeGreaterThan(2000);
  });

  it('still says something useful after redaction', () => {
    // Stripping figures must not reduce every explanation to noise. A buyer who
    // is told only "a figure" learns nothing and stops reading the scores.
    const redacted = redactFitResult(scoreFit(baseCriteria, baseListing));

    for (const reason of redacted.topReasons) {
      expect(reason.label.length).toBeGreaterThan(3);
      expect(reason.detail.split(' ').length).toBeGreaterThan(4);
    }
  });
});
