import { describe, expect, it } from 'vitest';

import { TAX_DISCLAIMER_TEXT, VALUATION_DISCLAIMER_TEXT } from './ai-disclaimer';

/**
 * These assert the *wording* of the regulated disclaimers, not the rendering.
 *
 * The tax text is quoted verbatim in the product specification, and the
 * valuation text carries the "not an appraisal" framing the product is required
 * to show. Both are the kind of string someone tightens for tone in a hurry, so
 * the test exists to make that a deliberate act with a visible diff rather than
 * an incidental edit.
 */
describe('regulated disclaimer wording', () => {
  it('matches the required tax disclaimer verbatim', () => {
    expect(TAX_DISCLAIMER_TEXT).toBe(
      'This platform provides transaction records for your convenience and does not provide tax, ' +
        'legal, or accounting advice. You are solely responsible for your own tax obligations and ' +
        'should consult a qualified tax professional or accountant regarding your specific situation.',
    );
  });

  it('frames valuation output as an estimate rather than an appraisal', () => {
    expect(VALUATION_DISCLAIMER_TEXT).toContain('estimate for discussion purposes only');
    expect(VALUATION_DISCLAIMER_TEXT).toContain('not an appraisal');
    expect(VALUATION_DISCLAIMER_TEXT).toContain('recommendation to buy or sell at any price');
  });

  it('never presents AI output as advice or as a guarantee', () => {
    const forbidden = [/\bwe recommend\b/i, /\bguarantee/i, /\bcompliant\b/i, /\bcertif/i];
    for (const pattern of [TAX_DISCLAIMER_TEXT, VALUATION_DISCLAIMER_TEXT]) {
      for (const term of forbidden) {
        expect(pattern, `"${term}" must not appear in a disclaimer`).not.toMatch(term);
      }
    }
  });
});
