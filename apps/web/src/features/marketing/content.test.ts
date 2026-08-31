import { describe, expect, it } from 'vitest';

import {
  ADVISOR_FEATURES,
  ADVISOR_STEPS,
  BUYER_FEATURES,
  BUYER_STEPS,
  HERO,
  LIMITS,
  SELLER_FEATURES,
  SELLER_STEPS,
  SITE_DESCRIPTION,
  DOORS,
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
  SITE_DESCRIPTION,
  HERO.headline,
  HERO.subhead,
  ...DOORS.flatMap((door) => [door.eyebrow, door.title, door.body, door.cta, ...door.facets]),
  ...[...SELLER_FEATURES, ...BUYER_FEATURES, ...ADVISOR_FEATURES, ...LIMITS].flatMap((f) => [
    f.title,
    f.body,
  ]),
  ...[...SELLER_STEPS, ...BUYER_STEPS, ...ADVISOR_STEPS].flatMap((s) => [s.title, s.body]),
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

  it('says it is a marketplace before it says anything else', () => {
    // The product is a place to buy and sell companies. It was previously
    // introduced by its valuation tool, which is the free thing at the front
    // door rather than the thing being sold, and a visitor who reads the
    // headline should not come away thinking they found a calculator.
    expect(HERO.headline.toLowerCase()).toMatch(/buy/);
    expect(HERO.headline.toLowerCase()).toMatch(/sell/);

    /*
     * "Marketplace" moved from the headline to the subhead when the hero became
     * two doors. The headline now says the two things a visitor came to do,
     * which serves the same purpose more directly — so the assertion follows
     * the positioning rather than pinning it to one string.
     */
    expect(`${HERO.headline} ${HERO.subhead}`.toLowerCase()).toMatch(/marketplace/);

    /*
     * And neither door leads to the calculator. This is the rule that matters:
     * a marketplace whose front door offers a valuation reads as a valuation
     * tool with a marketplace attached, which is what the front page used to
     * do.
     */
    expect(DOORS.map((door) => door.href)).toContain('/listings');
    for (const door of DOORS) {
      expect(door.href).not.toContain('valuation');
    }
  });

  it('names the professionals it is built for', () => {
    // "Investment bankers can use it too" is not a positioning statement unless
    // the words appear somewhere a banker will read them.
    const advisors = ADVISOR_FEATURES.map((f) => `${f.title} ${f.body}`).join(' ');
    expect(`${SITE_DESCRIPTION} ${HERO.subhead} ${advisors}`.toLowerCase()).toMatch(
      /investment banker/,
    );
    expect(`${SITE_DESCRIPTION} ${HERO.subhead}`.toLowerCase()).toMatch(/broker/);
  });

  it('describes itself usefully to somebody who has never heard of it', () => {
    // This string is the grey line under a search result, read with no context
    // at all. If it does not say what the product is, nothing else gets read.
    expect(SITE_DESCRIPTION.toLowerCase()).toMatch(/marketplace/);
    expect(SITE_DESCRIPTION.split(' ').length).toBeGreaterThan(20);
  });

  it('has substantive body copy everywhere', () => {
    // A heading with a one-line stub under it reads as unfinished, and this is
    // the page that decides whether somebody signs up.
    for (const item of [...SELLER_FEATURES, ...BUYER_FEATURES, ...ADVISOR_FEATURES, ...LIMITS]) {
      expect(item.body.split(' ').length, item.title).toBeGreaterThan(15);
    }
  });

  it('numbers the steps in order on every side', () => {
    expect(SELLER_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(BUYER_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(ADVISOR_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it('gives all three sides equal weight', () => {
    // A marketplace that reads as built for one side does not get the others.
    // Sellers and buyers are the trade; advisors bring listings in bulk and
    // will not send a client somewhere that treats them as an afterthought.
    expect(SELLER_FEATURES.length).toBe(BUYER_FEATURES.length);
    expect(ADVISOR_FEATURES.length).toBe(BUYER_FEATURES.length);
    expect(SELLER_STEPS.length).toBe(BUYER_STEPS.length);
    expect(ADVISOR_STEPS.length).toBe(BUYER_STEPS.length);
  });

  it('does not promise advisors a regulatory status', () => {
    // A platform cannot license anyone, and copy aimed at intermediaries is
    // exactly where that would slip in.
    const advisors = ADVISOR_FEATURES.map((f) => `${f.title} ${f.body}`).join(' ');
    expect(advisors).not.toMatch(/licen[cs]ed|registered broker|finra|series \d/i);
  });
});
