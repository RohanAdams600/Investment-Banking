import { INDUSTRY_PROFILES } from '../valuation/industries';
import type { Answers, Question, Questionnaire } from './types';

/**
 * The buyer questionnaire.
 *
 * Everything here feeds something. `industries`, `states`, `revenueMin/Max`,
 * `earningsMin`, `dealSizeMax`, `structure`, `involvement`,
 * `maxConcentration` and `minRecurring` become `acquisition_criteria` and drive
 * the deterministic score. `thesis` is what the model reads. The rest becomes
 * the buyer profile a seller weighs when deciding whether to release their
 * financials.
 *
 * A question that feeds nothing is a question that should not be asked, and
 * this file is the place that rule is enforceable by reading it.
 *
 * ## Order
 *
 * Easy and interesting first, financial and personal later. The first question
 * somebody sees should not be how much money they have. By the time the capital
 * question arrives they have invested five answers and know what the platform
 * is for, which is when people actually answer it honestly.
 *
 * The free-text thesis sits near the end deliberately: answering the structured
 * questions first primes people to write something specific rather than "a good
 * business at a fair price".
 */

const BUY_SIDE_STRUCTURED: Question[] = [
  {
    id: 'industries',
    type: 'multi',
    prompt: 'Which industries are you looking at?',
    help: 'Pick up to five. Leaving this blank means you are open to anything, which is a real answer — it just ranks industry fit neutrally instead of rewarding it.',
    maxSelections: 5,
    options: Object.values(INDUSTRY_PROFILES).map((profile) => ({
      value: profile.key,
      label: profile.label,
    })),
  },
  {
    id: 'geography',
    type: 'single',
    prompt: 'How far are you willing to go?',
    help: 'Owner-operated businesses usually need you nearby, at least at first. Funds and passive holders often do not.',
    required: true,
    options: [
      {
        value: 'local',
        label: 'Near where I live',
        description: 'I need to be able to drive there.',
      },
      {
        value: 'regional',
        label: 'A few specific states',
        description: 'I will name them next.',
      },
      { value: 'national', label: 'Anywhere in the US', description: 'Location is not a filter.' },
    ],
  },
  {
    id: 'states',
    type: 'multi',
    prompt: 'Which states?',
    help: 'Only listings in these states will score on geography. You can change this later without losing anything.',
    maxSelections: 15,
    when: (answers) => answers.geography === 'local' || answers.geography === 'regional',
    options: US_STATE_OPTIONS(),
  },
  {
    id: 'revenueMin',
    type: 'money',
    prompt: 'What is the smallest business worth your time?',
    help: 'Annual revenue, in dollars. Below this, a deal usually costs more in effort than it returns.',
    placeholder: '500000',
    min: 0,
  },
  {
    id: 'revenueMax',
    type: 'money',
    prompt: 'And the largest you would take on?',
    help: 'Annual revenue. This is about what you can manage, not what you can afford — the money question comes later.',
    placeholder: '10000000',
    min: 0,
  },
  {
    id: 'earningsMin',
    type: 'money',
    prompt: 'What does it need to earn for this to be worth doing?',
    help: 'Annual SDE or EBITDA. For most buyers this is the number that actually matters — revenue can be large and leave nothing behind.',
    placeholder: '250000',
    min: 0,
  },
  {
    id: 'dealSizeMax',
    type: 'money',
    prompt: 'What is the most you can put together for a purchase?',
    help: 'Everything in: your cash, debt you can raise, investor capital. Listings above this are filtered out rather than shown and dismissed. Sellers never see this figure.',
    placeholder: '3000000',
    min: 0,
  },
  {
    id: 'fundingSource',
    type: 'single',
    prompt: 'How would you fund it?',
    help: 'Sellers ask this first, so answering it here saves a round trip. It goes on your buyer profile.',
    required: true,
    options: [
      { value: 'cash', label: 'Cash', description: 'No financing contingency.' },
      {
        value: 'sba',
        label: 'SBA loan',
        description: 'Common under $5M. Adds time and conditions to a close.',
      },
      {
        value: 'conventional',
        label: 'Bank debt',
        description: 'Conventional acquisition financing.',
      },
      {
        value: 'fund',
        label: 'Committed fund capital',
        description: 'Investor capital already raised.',
      },
      {
        value: 'seller',
        label: 'Mostly seller financing',
        description: 'The seller carries much of the price.',
      },
      {
        value: 'undecided',
        label: 'Still working it out',
        description: 'Honest, and sellers would rather know.',
      },
    ],
  },
  {
    id: 'involvement',
    type: 'single',
    prompt: 'Will you run it yourself?',
    help: 'This changes what a good business looks like for you. An owner-critical business is a problem for a passive holder and an opportunity for an operator.',
    required: true,
    options: [
      {
        value: 'owner_operator',
        label: 'Yes, day to day',
        description: 'I am buying myself a job I own.',
      },
      {
        value: 'passive',
        label: 'No, it needs to run without me',
        description: 'There must be a manager, or one I can hire.',
      },
      { value: 'either', label: 'Either could work', description: 'Depends on the business.' },
    ],
  },
  {
    id: 'structure',
    type: 'single',
    prompt: 'Asset purchase or stock purchase?',
    help: 'Most small deals are asset purchases — the buyer takes the assets and leaves the liabilities behind. Say "no preference" if this is new to you; it is usually negotiated anyway.',
    required: true,
    options: [
      { value: 'asset', label: 'Asset purchase' },
      { value: 'stock', label: 'Stock purchase' },
      { value: 'either', label: 'No preference' },
    ],
  },
  {
    id: 'maxConcentration',
    type: 'percent',
    prompt: 'How much of revenue can come from one customer before you walk?',
    help: 'A business where one customer is 60% of revenue is one phone call from being worth much less. This is treated as a hard limit — listings above it are excluded, not down-ranked.',
    placeholder: '30',
    min: 0,
    max: 100,
  },
  {
    id: 'timeline',
    type: 'single',
    prompt: 'When are you looking to close?',
    help: 'Sellers weight this heavily. A buyer who can close in ninety days is worth more than one who might, eventually.',
    required: true,
    options: [
      { value: 'now', label: 'As soon as I find the right one' },
      { value: 'six_months', label: 'Within six months' },
      { value: 'year', label: 'Within a year' },
      { value: 'exploring', label: 'Just looking for now' },
    ],
  },
  {
    id: 'experience',
    type: 'single',
    prompt: 'Have you bought a business before?',
    help: 'Goes on your profile. First-time buyers are not at a disadvantage here — sellers mostly want to know what to expect from the process.',
    required: true,
    options: [
      { value: '0', label: 'This would be my first' },
      { value: '1', label: 'One before' },
      { value: '3', label: 'A few' },
      { value: '10', label: 'Many — this is what I do' },
    ],
  },
  {
    id: 'thesis',
    type: 'longtext',
    prompt: 'In your own words, what are you actually looking for?',
    help: 'This is the most useful thing on the form. The questions above are filters; this is the part that gets read — write what you would say to a broker on the phone. Specific beats polished.',
    placeholder:
      'Route-density home services in the Northeast I can bolt onto a business I already own. Prefer an owner retiring over a distressed sale. Willing to pay up for real recurring contracts.',
    max: 4000,
  },
  {
    id: 'entityName',
    type: 'text',
    prompt: 'What name should sellers see?',
    help: 'Your acquiring entity, if you have one. Leave it blank if you are buying personally — your own name will be shown.',
    placeholder: 'Okafor Capital LLC',
    max: 300,
  },
];

export const BUYER_QUESTIONNAIRE: Questionnaire = {
  id: 'buyer',
  title: 'What are you looking to buy?',
  intro:
    'About three minutes. Every answer does something — it either filters what you are shown or tells a seller who you are. Nothing here is published, and you can change all of it later.',
  questions: BUY_SIDE_STRUCTURED,
};

/**
 * The states, as options.
 *
 * A function rather than a constant so the list is built once at module load
 * and not shipped twice when this file is imported from both flows.
 */
function US_STATE_OPTIONS() {
  return [
    ['AL', 'Alabama'],
    ['AK', 'Alaska'],
    ['AZ', 'Arizona'],
    ['AR', 'Arkansas'],
    ['CA', 'California'],
    ['CO', 'Colorado'],
    ['CT', 'Connecticut'],
    ['DE', 'Delaware'],
    ['DC', 'District of Columbia'],
    ['FL', 'Florida'],
    ['GA', 'Georgia'],
    ['HI', 'Hawaii'],
    ['ID', 'Idaho'],
    ['IL', 'Illinois'],
    ['IN', 'Indiana'],
    ['IA', 'Iowa'],
    ['KS', 'Kansas'],
    ['KY', 'Kentucky'],
    ['LA', 'Louisiana'],
    ['ME', 'Maine'],
    ['MD', 'Maryland'],
    ['MA', 'Massachusetts'],
    ['MI', 'Michigan'],
    ['MN', 'Minnesota'],
    ['MS', 'Mississippi'],
    ['MO', 'Missouri'],
    ['MT', 'Montana'],
    ['NE', 'Nebraska'],
    ['NV', 'Nevada'],
    ['NH', 'New Hampshire'],
    ['NJ', 'New Jersey'],
    ['NM', 'New Mexico'],
    ['NY', 'New York'],
    ['NC', 'North Carolina'],
    ['ND', 'North Dakota'],
    ['OH', 'Ohio'],
    ['OK', 'Oklahoma'],
    ['OR', 'Oregon'],
    ['PA', 'Pennsylvania'],
    ['RI', 'Rhode Island'],
    ['SC', 'South Carolina'],
    ['SD', 'South Dakota'],
    ['TN', 'Tennessee'],
    ['TX', 'Texas'],
    ['UT', 'Utah'],
    ['VT', 'Vermont'],
    ['VA', 'Virginia'],
    ['WA', 'Washington'],
    ['WV', 'West Virginia'],
    ['WI', 'Wisconsin'],
    ['WY', 'Wyoming'],
  ].map(([code, name]) => ({ value: `US-${code}`, label: name as string }));
}

export { US_STATE_OPTIONS };

/** Prior-acquisition count, from the banded answer. */
export function priorAcquisitionsFrom(answers: Answers): number | null {
  const raw = answers.experience;
  if (typeof raw !== 'string') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
