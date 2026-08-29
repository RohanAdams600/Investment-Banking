import { INDUSTRY_KEYS, INDUSTRY_PROFILES } from '@ib/core';
import { describe, expect, it } from 'vitest';

import {
  GUIDED_INDUSTRY_KEYS,
  INDUSTRY_GUIDES,
  industryGuide,
  sentenceCase,
} from './industry-guides';

/**
 * The sector pages are the organic search strategy, and the way they fail is
 * not a crash — it is quietly becoming a doorway set. Ten near-identical pages
 * built from a filter get demoted, and nobody finds out from a stack trace.
 *
 * So these tests assert substance: every sector has content, none of it is
 * shared with another sector, and none of it is short enough to be filler.
 */
describe('industry guides', () => {
  it('covers every industry the valuation model knows about', () => {
    // A new sector added to INDUSTRY_PROFILES without content here would render
    // a page with a heading and nothing under it.
    for (const key of INDUSTRY_KEYS) {
      expect(INDUSTRY_GUIDES[key], `${key} has no landing page content`).toBeDefined();
    }
    expect(GUIDED_INDUSTRY_KEYS).toHaveLength(INDUSTRY_KEYS.length);
  });

  it('gives every sector enough material to be worth landing on', () => {
    for (const key of GUIDED_INDUSTRY_KEYS) {
      const guide = industryGuide(key);

      expect(guide.intro.length, `${key} intro is too thin`).toBeGreaterThan(180);
      expect(guide.sellerNote.length, `${key} seller note is too thin`).toBeGreaterThan(180);
      expect(guide.buyersLookAt.length, `${key} needs more diligence points`).toBeGreaterThanOrEqual(4);
      expect(guide.liftsValue.length).toBeGreaterThanOrEqual(3);
      expect(guide.limitsValue.length).toBeGreaterThanOrEqual(3);

      for (const item of guide.buyersLookAt) {
        expect(item.body.length, `${key}: "${item.title}" is a stub`).toBeGreaterThan(80);
      }
    }
  });

  it('shares no prose between two sectors', () => {
    /*
     * The actual doorway-page test. Duplicated paragraphs across sector pages is
     * exactly the pattern search engines demote, and it is what happens when
     * somebody adds a sector by copying the one above it and changing the title.
     */
    const seen = new Map<string, string>();

    for (const key of GUIDED_INDUSTRY_KEYS) {
      const guide = industryGuide(key);
      const passages = [
        guide.intro,
        guide.sellerNote,
        ...guide.buyersLookAt.map((item) => item.body),
        ...guide.liftsValue,
        ...guide.limitsValue,
      ];

      for (const passage of passages) {
        const previous = seen.get(passage);
        expect(previous, `${key} reuses text from ${previous}: "${passage.slice(0, 60)}…"`).toBe(
          undefined,
        );
        seen.set(passage, key);
      }
    }
  });

  it('never states a multiple as a fact about a business', () => {
    /*
     * The compliance line, tested rather than trusted. The guides describe what
     * buyers examine; the number itself comes from INDUSTRY_PROFILES and is
     * rendered by the page alongside its qualification. A guide that started
     * quoting figures would be making a valuation claim in prose, where no
     * disclaimer sits next to it.
     */
    for (const key of GUIDED_INDUSTRY_KEYS) {
      const guide = industryGuide(key);
      const prose = [
        guide.intro,
        guide.sellerNote,
        ...guide.buyersLookAt.map((item) => item.body),
      ].join(' ');

      expect(prose, `${key} quotes a multiple in prose`).not.toMatch(/\d+(\.\d+)?\s*(×|x)\b/);
      expect(prose, `${key} quotes a dollar figure in prose`).not.toMatch(/\$\s?\d/);
    }
  });

  it('keeps the search phrase lower case so it can be composed into a sentence', () => {
    // generateMetadata capitalises the first character to build a description.
    // A phrase that arrives already capitalised produces a description that
    // reads as though two sentences collided.
    for (const key of GUIDED_INDUSTRY_KEYS) {
      const phrase = industryGuide(key).searchPhrase;
      expect(phrase.charAt(0)).toBe(phrase.charAt(0).toLowerCase());
      expect(phrase).not.toMatch(/\.$/);
      // And that composing it produces a sentence rather than two colliding.
      expect(sentenceCase(phrase).charAt(0)).toBe(phrase.charAt(0).toUpperCase());
    }
  });

  it('uses the sector label the rest of the product uses', () => {
    // The page renders INDUSTRY_PROFILES[key].label as its <h1>. If the guides
    // ever grow their own label the two would drift and the page would disagree
    // with the questionnaire a seller filled in.
    for (const key of GUIDED_INDUSTRY_KEYS) {
      expect(INDUSTRY_PROFILES[key].label).toBeTruthy();
    }
  });
});
