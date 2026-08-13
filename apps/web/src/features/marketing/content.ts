import { brand } from '@ib/core';

/**
 * Marketing copy, in one place.
 *
 * Separated from the components for the same reason the questionnaire is:
 * copy gets rewritten far more often than layout, and it should be reviewable
 * as prose rather than read out of JSX. It also makes one rule enforceable by a
 * test rather than by vigilance.
 *
 * ## The rule
 *
 * **Nothing here may claim a number the platform cannot substantiate, and
 * nothing may promise an outcome.**
 *
 * A new marketplace has no closed deals, no average multiple, and no
 * testimonials. Inventing them is not marketing licence — for a platform that
 * handles the sale of somebody's life's work it is the first signal that the
 * rest of the claims are soft too, and in this market it is the kind of thing
 * that attracts a regulator's attention rather than a customer's.
 *
 * So the copy sells the mechanism, which is real and specific, rather than
 * results, which do not exist yet. "Your business stays anonymous until you
 * issue an NDA" is a stronger claim than "trusted by thousands", and it happens
 * to be true.
 *
 * A test asserts no digit-plus-unit pattern reaches these strings.
 */

export interface Feature {
  title: string;
  body: string;
}

export interface Step {
  number: number;
  title: string;
  body: string;
}

export const HERO = {
  headline: 'Sell your business without telling the market you are selling.',
  subhead:
    'A marketplace for lower-middle-market acquisitions. Your business stays anonymous until you decide otherwise — buyers see the shape of the deal, and nothing that identifies you, until you issue them a confidentiality agreement.',
  primaryCta: 'What is my business worth?',
  secondaryCta: 'Browse businesses for sale',
} as const;

/**
 * What the platform does, stated as mechanism.
 *
 * Each of these is a thing the software actually does today, described in terms
 * a seller would recognise. Nothing aspirational, and nothing that describes a
 * feature which is still a migration away.
 */
export const SELLER_FEATURES: Feature[] = [
  {
    title: 'Anonymous until you say so',
    body: 'Your listing shows industry, state and size ranges. The company name, address, exact figures and customer detail live in a separate record that a buyer cannot reach until they have signed your NDA — enforced by the database, not by a setting.',
  },
  {
    title: 'Priced with your eyes open',
    body: 'A valuation across several methods — earnings multiple, revenue multiple, asset value — with every adjustment itemised. You still set whatever price you want. The estimate is there so a buyer cannot tell you something about your own numbers that you did not already know.',
  },
  {
    title: 'Buyers ranked for you, not just you for them',
    body: 'Tell us who you would be happy to sell to — an operator, a searcher, a competitor — and how much staff continuity and the name matter. Buyers are scored against that as well as against your business, and conflicts surface in week one rather than week ten.',
  },
  {
    title: 'You approve every message',
    body: 'Introductions to matched buyers are drafted for you and sent only when you have read the exact wording and clicked send. Nothing on this platform contacts anyone on your behalf automatically.',
  },
];

export const BUYER_FEATURES: Feature[] = [
  {
    title: 'Ranked against what you actually said',
    body: 'Set your criteria once — industry, size, geography, structure, hard limits — and every listing is scored against them with the reasoning shown. Write what you are looking for in your own words and that gets read too.',
  },
  {
    title: 'Scored on real numbers you have not seen',
    body: 'Matching runs on the seller’s exact figures, inside our database, and returns you a ranking with every figure stripped out. You get an accurate score before signing anything; the seller discloses nothing.',
  },
  {
    title: 'Your limits are limits',
    body: 'Say you will not go above a customer-concentration threshold and listings past it are excluded rather than shown at a flattering percentage. When your own limits are filtering everything out, you are told that too.',
  },
  {
    title: 'One profile, taken seriously',
    body: 'Sellers see who you are, what you buy with, and whether you have done this before — which is what gets an access request answered instead of ignored.',
  },
];

export const SELLER_STEPS: Step[] = [
  {
    number: 1,
    title: 'Answer some questions',
    body: 'About five minutes, one question at a time. What the business does, what it earns, and who you would be happy to sell to.',
  },
  {
    number: 2,
    title: 'See what it might be worth',
    body: 'Several valuation methods side by side, with the assumptions shown and editable. No obligation to list anything.',
  },
  {
    number: 3,
    title: 'Publish an anonymous listing',
    body: 'It starts as a draft only you can see. You choose the price, the wording, and when it goes live.',
  },
  {
    number: 4,
    title: 'Decide who gets the details',
    body: 'Buyers request access. You see who they are and how they would fund it, then issue a confidentiality agreement — or do not.',
  },
];

export const BUYER_STEPS: Step[] = [
  {
    number: 1,
    title: 'Say what you are looking for',
    body: 'Industry, size, geography, how you would fund it, and what you actually want in your own words.',
  },
  {
    number: 2,
    title: 'Get a ranked list',
    body: 'Every live listing scored against your criteria, with the reasoning behind each score.',
  },
  {
    number: 3,
    title: 'Request access',
    body: 'Sign the seller’s confidentiality agreement and the full profile opens — company, exact financials, customer concentration, risks.',
  },
  {
    number: 4,
    title: 'Talk in a deal room',
    body: 'Messaging, documents and an audit trail, with the seller and their broker.',
  },
];

/**
 * What the platform is not.
 *
 * On the page, deliberately. A marketplace that handles this much money and
 * this much confidential information should say plainly what it does not do,
 * and saying it first is cheaper than being asked later — by a customer or by a
 * regulator.
 */
export const LIMITS: Feature[] = [
  {
    title: 'We are not your broker or your advisor',
    body: `${brand.name} is software. It does not represent either side, does not negotiate, and does not receive a fee for recommending anything. If you want a broker or an advisor, engage one — several use this platform to run their own deals.`,
  },
  {
    title: 'Estimates are estimates',
    body: 'Valuations and match scores are calculated from what you tell us. They are for discussion, not appraisals or fairness opinions, and they ignore everything diligence would find.',
  },
  {
    title: 'Documents are a starting point',
    body: 'Templates and checklists help you prepare and compare drafts. They do not make a document sound, and nothing here is legal advice. Have an attorney review anything you intend to sign.',
  },
  {
    title: 'Confidentiality is enforced, not promised',
    body: 'The gate on your full profile is a database policy that a buyer without a signed agreement cannot pass, tested on every build. What a buyer does with information after you release it to them is between you, them, and the agreement they signed.',
  },
];
