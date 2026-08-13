import { describe, expect, it } from 'vitest';

import {
  BUYER_FEATURES,
  BUYER_STEPS,
  HERO,
  LIMITS,
  SELLER_FEATURES,
  SELLER_STEPS,
} from './content';

/**
 * The marketing copy has one rule, and this file is how it is kept.
 *
 * A new marketplace has no closed deals, no average multiple, and no
 * testimonials. Inventing them is not marketing licence — on a platform that
 * handles the sale of somebody's life's work it is the first signal that the
 * rest of the claims are soft, and in this market it draws a regulator's
 * attention rather than a customer's.
 *
 * These tests are cheap to keep passing and would catch the one edit nobody
 * reviews carefully: a well-meaning "trusted by 400 brokers" added on a Friday.
 */

const ALL_TEXT = [
  HERO.headline,
  HERO.subhead,
  HERO.primaryCta,
  HERO.secondaryCta,
  ...[...SELLER_FEATURES, ...BUYER_FEATURES, ...LIMITS].flatMap((f) => [f.title, f.body]),
  ...[...SELLER_STEPS, ...BUYER_STEPS].flatMap((s) => [s.title, s.body]),
];

describe('marketing copy', () => {
  it('claims no statistic', () => {
    // Any digit followed by a unit, percentage, or multiplier. The platform has
    // no numbers it can substantiate yet, so it should quote none.
    for (const text of ALL_TEXT) {
      expect(text, `"${text}"`).not.toMatch(
        /\d[\d,.]*\s*(%|x\b|m\b|k\b|bn\b|million|billion|deals|businesses|buyers|sellers|brokers|users|customers|years)/i,
      );
    }
  });

  it('promises no outcome', () => {
    // "Get the best price" and "sell faster" are the two claims a marketplace
    // reaches for first and can least support.
    for (const text of ALL_TEXT) {
      expect(text, `"${text}"`).not.toMatch(
        /\bguarantee|\bwe (will|can) (get|find|sell)|\bbest price\b|\bmaximum value\b|\bsell (faster|quickly)\b|\brisk-free\b/i,
      );
    }
  });

  it('never claims legal or regulatory compliance', () => {
    // The specification is explicit: compliance features are tools that support
    // the user's own process, never a guarantee about theirs.
    for (const text of ALL_TEXT) {
      expect(text, `"${text}"`).not.toMatch(
        /\bsec-compliant\b|\bfully compliant\b|\blegally binding\b|\bcompliance guaranteed\b/i,
      );
    }
  });

  it('does not present itself as a broker or advisor', () => {
    const limits = LIMITS.map((l) => `${l.title} ${l.body}`).join(' ');
    expect(limits).toMatch(/not your broker|not .*advisor/i);
  });

  it('says plainly that documents are not legal advice', () => {
    const limits = LIMITS.map((l) => `${l.title} ${l.body}`).join(' ');
    // Matches the negation rather than one exact phrasing — "nothing here is
    // legal advice" and "this is not legal advice" are the same promise.
    expect(limits).toMatch(/(not|nothing|never)[^.]{0,60}legal advice/i);
    expect(limits).toMatch(/attorney/i);
  });

  it('says estimates are not appraisals', () => {
    const limits = LIMITS.map((l) => `${l.title} ${l.body}`).join(' ');
    expect(limits).toMatch(/not appraisals/i);
  });

  it('leads with the confidentiality mechanism', () => {
    // It is the strongest true claim the platform has, and the one a seller
    // cares about before anything else.
    expect(`${HERO.headline} ${HERO.subhead}`.toLowerCase()).toContain('anonymous');
  });

  it('has substantive body copy everywhere', () => {
    // A heading with a one-line stub under it reads as unfinished, and this is
    // the page that decides whether somebody signs up.
    for (const item of [...SELLER_FEATURES, ...BUYER_FEATURES, ...LIMITS]) {
      expect(item.body.split(' ').length, item.title).toBeGreaterThan(15);
    }
  });

  it('numbers the steps in order on both sides', () => {
    expect(SELLER_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(BUYER_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it('gives both sides equal weight', () => {
    // A marketplace that reads as built for one side does not get the other,
    // and this platform is useless without both.
    expect(SELLER_FEATURES.length).toBe(BUYER_FEATURES.length);
    expect(SELLER_STEPS.length).toBe(BUYER_STEPS.length);
  });
});
