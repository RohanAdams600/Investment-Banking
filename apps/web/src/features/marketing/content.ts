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

/**
 * The one-sentence answer to "what is this?".
 *
 * Used as the meta description on the landing page and as the fallback OG
 * description everywhere else, so it has to work stripped of all context — as a
 * single grey line under a blue link, read by somebody who has never heard the
 * name. That rules out anything atmospheric and rules in naming the market and
 * the people in it.
 */
export const SITE_DESCRIPTION =
  'A marketplace for buying and selling privately held companies. Owners list, buyers search by industry, state, earnings and price, and investment bankers, M&A advisors and business brokers run their deals here — with every listing anonymous until the seller issues a confidentiality agreement.';

export const HERO = {
  headline: 'A marketplace for buying and selling businesses.',
  subhead:
    'Owners list. Buyers search by industry, state, earnings and asking price, or set their criteria once and let the matching bring listings to them. Investment bankers, M&A advisors and business brokers run their clients’ deals here too. Every listing is anonymous until the seller issues a confidentiality agreement — so a company can be on the market without the market knowing.',
  primaryCta: 'Browse businesses for sale',
  primaryHref: '/listings',
  secondaryCta: 'What is my business worth?',
  secondaryHref: '/tools/valuation',
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
 * The third side of the market.
 *
 * Bankers, advisors and brokers are not a segment bolted on to a seller
 * product — they are the people who bring listings in bulk, and a marketplace
 * that has no place for them is one they will not send a client to. Everything
 * below is a capability that exists today under the `broker` role: listings
 * managed for a client, deal rooms, the document vault, the pipeline, and the
 * commission record.
 */
export const ADVISOR_FEATURES: Feature[] = [
  {
    title: 'Run your clients’ listings, not just your own',
    body: 'List on behalf of the owners you represent, control the wording and the price with them, and move a listing through draft, live and under-offer without handing anyone your credentials.',
  },
  {
    title: 'A data room with an access log',
    body: 'Grant a document to one buyer at a time, replace it with a new version, and see who opened what and when. Revoking access is a click, and the record of who held it stays.',
  },
  {
    title: 'The whole pipeline in one place',
    body: 'Contacts, tasks and notes across every engagement you are running, with reminders on what is due — so a deal that has gone quiet surfaces before the client asks about it.',
  },
  {
    title: 'Your fee arrangement, written down',
    body: `Record the engagement terms and what is owed on a closing, kept alongside the deal rather than in a spreadsheet. ${brand.name} does not move money and does not take a cut of yours.`,
  },
];

export const ADVISOR_STEPS: Step[] = [
  {
    number: 1,
    title: 'Tell us you advise on deals',
    body: 'Pick the intermediary role at sign-up. You can hold it alongside a buy-side role if you do both.',
  },
  {
    number: 2,
    title: 'List for your client',
    body: 'Build the anonymous teaser and the confidential profile with them. Nothing goes live until they say so.',
  },
  {
    number: 3,
    title: 'Decide who gets in',
    body: 'Review who is requesting access and how they would fund it, then issue the confidentiality agreement.',
  },
  {
    number: 4,
    title: 'Run it to a close',
    body: 'Deal room, document vault, pipeline and the commission record, with an audit trail behind all of it.',
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
    body: `${brand.name} is software. It does not represent either side, does not negotiate, and does not receive a fee for recommending anything. Bankers, advisors and brokers can run a client’s deal here, but that engagement is between you and them — not with us.`,
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
