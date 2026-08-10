import { describe, expect, it } from 'vitest';

import {
  fillTemplate,
  reviewDocument,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DRAFT_NOTICE,
  type LegalDocumentKind,
} from './review';

/**
 * These test the compliance posture as much as the logic.
 *
 * The risk here is not a wrong regex. It is a future change that makes this
 * feature feel more finished — a "document complete" badge, a finding phrased
 * as a verdict, a placeholder quietly dropped — and in doing so encourages
 * somebody to sign a purchase agreement no lawyer has read.
 */

describe('fillTemplate', () => {
  it('substitutes provided values', () => {
    const { body } = fillTemplate('This agreement is between {{buyer_name}} and {{seller_name}}.', {
      buyer_name: 'Northgate Holdings LLC',
      seller_name: 'Acme Industrial Inc.',
    });

    expect(body).toBe('This agreement is between Northgate Holdings LLC and Acme Industrial Inc..');
  });

  it('leaves unfilled placeholders visible rather than blanking them', () => {
    // A contract with a blank where a party's name should be is obviously
    // unfinished. One where the blank was silently removed reads as complete.
    const { body, unresolved } = fillTemplate('Between {{buyer_name}} and {{seller_name}}.', {
      buyer_name: 'Northgate Holdings LLC',
    });

    expect(body).toContain('{{seller_name}}');
    expect(unresolved).toEqual(['seller_name']);
  });

  it('treats a whitespace-only value as unfilled', () => {
    const { unresolved } = fillTemplate('Price: {{purchase_price}}', { purchase_price: '   ' });
    expect(unresolved).toEqual(['purchase_price']);
  });

  it('is case-insensitive and tolerates spacing in placeholders', () => {
    const { body, unresolved } = fillTemplate('{{ Buyer_Name }} agrees.', {
      buyer_name: 'Northgate',
    });

    expect(body).toBe('Northgate agrees.');
    expect(unresolved).toEqual([]);
  });
});

describe('reviewDocument', () => {
  it('flags unfilled placeholders as a blocker, first', () => {
    const result = reviewDocument('nda', 'The parties {{buyer_name}} agree to keep it quiet.');

    expect(result.findings[0]?.severity).toBe('blocker');
    expect(result.findings[0]?.summary).toMatch(/placeholder/i);
    expect(result.unresolvedPlaceholders).toEqual(['buyer_name']);
  });

  it('raises a missing binding-provisions clause on an LOI', () => {
    // The most common source of dispute at the LOI stage.
    const result = reviewDocument('loi', 'We propose to acquire the business. Purchase price TBD.');

    expect(result.findings.some((f) => /binding/i.test(f.summary))).toBe(true);
  });

  it('does not raise a term it can find', () => {
    const body =
      'This letter is non-binding except for exclusivity. Purchase price is $4,000,000. ' +
      'Due diligence period of 60 days. Financing contingency applies. No-shop for 45 days.';

    const result = reviewDocument('loi', body);

    expect(result.findings.some((f) => /binding/i.test(f.summary))).toBe(false);
    expect(result.findings.some((f) => /purchase price/i.test(f.summary))).toBe(false);
  });

  it('flags assumed liabilities on an asset purchase agreement', () => {
    const result = reviewDocument('asset_purchase_agreement', 'Buyer purchases the assets.');

    expect(result.findings.some((f) => /assumed liabilit/i.test(f.summary))).toBe(true);
    expect(result.findings.some((f) => /excluded assets/i.test(f.summary))).toBe(true);
  });
});

describe('compliance posture', () => {
  it('always reports that attorney review is required', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      // Even a document with every expected term present.
      const result = reviewDocument(kind, 'x'.repeat(50));
      expect(result.requiresAttorneyReview, kind).toBe(true);
    }
  });

  it('has no notion of a document passing review', () => {
    const result = reviewDocument('nda', 'anything');

    // There is deliberately no `passed`, `valid`, `compliant` or `complete`.
    // Adding one would misrepresent what this can determine.
    expect(result).not.toHaveProperty('passed');
    expect(result).not.toHaveProperty('valid');
    expect(result).not.toHaveProperty('compliant');
    expect(result).not.toHaveProperty('complete');
  });

  it('poses every checklist finding as a question', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      // A body with no placeholders, so the only findings are checklist ones.
      // The placeholder finding is deliberately an instruction rather than a
      // question — "fill the blanks" is a process step, not a matter for
      // counsel.
      const result = reviewDocument(kind, 'minimal');

      for (const finding of result.findings) {
        // `includes` rather than `endsWith`: several questions carry a sentence
        // of context after the question mark, which is worth keeping.
        expect(finding.question.includes('?'), `${kind}: ${finding.question}`).toBe(true);
      }
    }
  });

  it('never asserts legality, enforceability, or compliance', () => {
    const forbidden = [
      /\bis (legally )?(valid|binding|enforceable)\b/i,
      /\bcompliant with\b/i,
      /\bmeets (all )?(legal|regulatory) requirements\b/i,
      /\bready to sign\b/i,
      /\bapproved\b/i,
    ];

    // Findings only. The draft notice is excluded on purpose: it *negates*
    // these same phrases ("not represented as complete, enforceable, or
    // compliant with any law"), and a substring scan cannot tell an assertion
    // from its denial. The notice has its own test below.
    const surfaces: string[] = [];
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      for (const finding of reviewDocument(kind, 'minimal').findings) {
        surfaces.push(finding.summary, finding.question);
      }
    }

    for (const text of surfaces) {
      for (const pattern of forbidden) {
        expect(text, `"${text}" matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('states in the draft notice that this is not legal advice', () => {
    expect(LEGAL_DRAFT_NOTICE).toMatch(/not legal advice/i);
    expect(LEGAL_DRAFT_NOTICE).toMatch(/attorney/i);
    // Explicitly disclaims the three things a user is most likely to assume.
    expect(LEGAL_DRAFT_NOTICE).toMatch(/complete/i);
    expect(LEGAL_DRAFT_NOTICE).toMatch(/enforceable/i);
    expect(LEGAL_DRAFT_NOTICE).toMatch(/compliant/i);
  });

  it('covers every document kind with a checklist', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS as LegalDocumentKind[]) {
      // A kind with no checklist would return zero findings on an empty
      // document, which reads as approval.
      expect(reviewDocument(kind, '').findings.length, kind).toBeGreaterThan(0);
    }
  });
});
