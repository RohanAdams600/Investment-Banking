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
  headline: 'Buy a business. Sell a business.',
  subhead:
    'A marketplace for privately held companies. Every listing is anonymous until the seller issues a confidentiality agreement — so a company can be on the market without the market knowing.',
} as const;

/**
 * The sector index, on the front page.
 *
 * The competition puts a grid of business types on its sell page, and it is the
 * right instinct badly aimed: a seller does not need to be told what kinds of
 * business exist. A buyer does — it is the first question they have, and on our
 * front page there was previously no answer to it at all and no way to start
 * looking without signing up.
 *
 * These are the sectors that have a written guide behind them, so each link
 * lands on a page worth landing on rather than an empty filtered list. The keys
 * come from the guides themselves, which is what stops this drifting out of
 * sync with the pages it points at.
 */

/**
 * The two doors.
 *
 * Almost everybody arriving here is doing one of two things, and they know
 * which before the page loads. Asking them to read a paragraph and then choose
 * from a row of buttons wastes the one moment they are certain of anything.
 *
 * The valuation tool used to hold the second call to action, and that was the
 * wrong shape: it is a useful way in for an owner who is only thinking about
 * selling, and it is not what this business is. A marketplace whose front door
 * offers a calculator reads as a calculator with a marketplace attached.
 * It now sits below, offered to the people it is actually for.
 *
 * `facets` are the real filter values from the product, not decoration. They
 * do the job a screenshot would: showing what the market is made of, in the
 * vernacular somebody looking for a business already uses.
 */
export interface Door {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  facets: string[];
}

export const DOORS: Door[] = [
  {
    eyebrow: 'If you are buying',
    title: 'Find a business worth owning',
    body: 'Search by industry, state, earnings and asking price — or set your criteria once and let matching listings come to you. Ask a seller for the full picture when one fits.',
    cta: 'Browse businesses for sale',
    href: '/businesses-for-sale',
    facets: ['Home services', 'Manufacturing', 'Distribution', 'Healthcare', 'Construction'],
  },
  {
    eyebrow: 'If you are selling',
    title: 'Sell without telling the market',
    body: 'List anonymously: industry, state and size ranges only. Your name, address and exact figures stay sealed until you personally issue a confidentiality agreement to a buyer you have chosen.',
    cta: 'List your business',
    /*
     * The seller page, not sign-up.
     *
     * An owner clicking this has decided nothing yet — they want to know what
     * listing here means before they make an account, and a form is the worst
     * possible answer to that. The buying door can go straight to the market
     * because the market is itself the explanation; selling needs a page.
     */
    href: '/sell',
    facets: ['Anonymous listing', 'You issue the NDA', 'Revocable access', 'Buyers verified'],
  },
];

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
 * The questions people actually ask before signing up.
 *
 * ## Why these are on the front page and not in a help centre
 *
 * The competition puts its answers behind a "Tools & Advice" tab and a
 * downloadable toolkit, which works for the people who go looking and does
 * nothing for the ones deciding in the next thirty seconds whether this is
 * safe. Every question below was going to be asked anyway; answering it before
 * it is asked is the cheapest trust there is, and it costs a visitor nothing to
 * skip.
 *
 * ## The rule these follow
 *
 * Each answer says what the software does, not what we hope you conclude. Where
 * the honest answer is unflattering — that a listing can be pieced together from
 * a detailed enough teaser, that we cannot stop a buyer forwarding a document
 * once they have it — it says that too. A marketplace handling somebody's life's
 * work does not get to be vague about its own limits, and a visitor who catches
 * one evasion stops believing the rest.
 */
export interface Question {
  q: string;
  a: string;
}

export const FAQS: Question[] = [
  {
    q: 'Will anyone know my business is for sale?',
    a: 'Not from the listing. It shows your industry, your state and size ranges — never the name, the address or an exact figure. Those live in a separate record that a buyer reaches only after you have personally issued them a confidentiality agreement. The honest limit: if you write a teaser detailed enough that somebody local recognises the business, no database rule can un-write it, so the listing form warns you about the fields where that happens.',
  },
  {
    q: 'What does it cost to list?',
    a: 'Nothing to list, nothing to browse, and no card is taken to start. Owners selling their own business stay free through the first few listings. The paid tiers are for intermediaries running deals for clients — brokers and firms — because that is who gets a pipeline, a document vault and commission records out of it. We do not take a percentage of your sale.',
  },
  {
    q: 'Do I need a broker to use this?',
    a: 'No. An owner can run the whole thing themselves: build the listing, review who is asking, issue the agreement, and talk in a deal room. If you already have a broker, they can run it here on your behalf without you handing over your login, and their engagement stays between you and them.',
  },
  {
    q: 'Who are the buyers, and how do I know they are real?',
    a: 'Buyers hold a profile that says who they are and how they would fund a purchase, and they can add evidence of that funding for review. When they ask for access you see a verification badge and a capacity band — never their bank statements, which are not ours to pass on. You are still the one deciding; the badge tells you whether somebody has shown their working.',
  },
  {
    q: 'What happens after I release the details?',
    a: 'Access is per-buyer and revocable: withdraw it and the confidential record closes again, though the record of who held it stays. Documents in the vault are watermarked with the viewer’s name and the minute they opened them, and you see the log. What that achieves is attribution rather than prevention — a leaked page can be traced to an account, and nothing anywhere can stop somebody photographing a screen.',
  },
  {
    q: 'I am only curious what it is worth. Can I start there?',
    a: 'Yes, and without listing anything. The valuation runs several methods side by side with every assumption shown and editable, and it stays yours — nothing is published, and no buyer is contacted, until you build a listing and take it live yourself.',
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
