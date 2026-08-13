import { INDUSTRY_PROFILES } from '../valuation/industries';
import { US_STATE_OPTIONS } from './buyer';
import type { Question, Questionnaire } from './types';

/**
 * The seller questionnaire.
 *
 * Two halves, and the second is the one nobody else asks.
 *
 * **The business.** Industry, state, revenue, earnings, concentration, owner
 * dependence. This feeds the valuation estimate and, once the seller publishes,
 * the listing itself.
 *
 * **Who they want to sell to.** Almost every marketplace treats the seller's
 * side as "highest price wins" and it is not true. Owners who spent thirty
 * years building something care, often more than they care about the last five
 * percent of price, about whether the staff keep their jobs, whether the name
 * survives, and whether the buyer is a competitor who will strip it for parts.
 *
 * Capturing that makes matching two-sided: a buyer is ranked for the seller as
 * well as the other way round. It also surfaces a conflict early — a seller who
 * wants the business kept intact and a buyer who says they will merge it are
 * both better off knowing on day one.
 *
 * ## What is deliberately not asked
 *
 * An asking price. It comes after the valuation estimate, because a number
 * given before seeing any analysis anchors the whole process to a guess. The
 * seller still sets whatever price they want — the estimate informs, it does
 * not gate.
 */

const SELLER_QUESTIONS: Question[] = [
  {
    id: 'industry',
    type: 'single',
    prompt: 'What kind of business is it?',
    help: 'This sets the multiple range your estimate starts from. Pick the closest — you can refine it later.',
    required: true,
    options: Object.values(INDUSTRY_PROFILES).map((profile) => ({
      value: profile.key,
      label: profile.label,
    })),
  },
  {
    id: 'state',
    type: 'single',
    prompt: 'Which state is it in?',
    help: 'Buyers filter by state. Your city is never published — state plus industry is already enough to identify many businesses, so the public listing stops at the state line.',
    required: true,
    options: US_STATE_OPTIONS(),
  },
  {
    id: 'yearsInBusiness',
    type: 'number',
    prompt: 'How long has it been trading?',
    help: 'Years. A long record lowers a buyer’s sense of risk more than almost anything else you can tell them.',
    placeholder: '12',
    min: 0,
    max: 200,
  },
  {
    id: 'employeeCount',
    type: 'number',
    prompt: 'How many people work there?',
    help: 'Full-time equivalents, including you.',
    placeholder: '14',
    min: 0,
  },
  {
    id: 'revenue',
    type: 'money',
    prompt: 'What did it bring in over the last twelve months?',
    help: 'Total revenue, before costs. This stays confidential — the public listing shows a range, never this figure.',
    placeholder: '4200000',
    required: true,
    min: 0,
  },
  {
    id: 'earnings',
    type: 'money',
    prompt: 'What did it earn, after your costs?',
    help: 'SDE or EBITDA — profit plus your own compensation and any one-off or personal expenses added back. This is the number buyers value the business on, so it is worth getting right rather than modest.',
    placeholder: '950000',
    required: true,
  },
  {
    id: 'revenueGrowth',
    type: 'percent',
    prompt: 'How did revenue move last year?',
    help: 'Percent, up or down. A decline is not disqualifying and hiding it is — buyers find it in diligence and then wonder what else is missing.',
    placeholder: '8',
    min: -100,
    max: 500,
  },
  {
    id: 'customerConcentration',
    type: 'percent',
    prompt: 'What share of revenue comes from your biggest customer?',
    help: 'The number buyers ask about first and sellers disclose last. High concentration lowers the estimate here, exactly as it will in a real negotiation.',
    placeholder: '18',
    min: 0,
    max: 100,
  },
  {
    id: 'recurringRevenue',
    type: 'percent',
    prompt: 'How much of it is contracted or repeat?',
    help: 'Percent under contract, on subscription, or from customers who reliably come back. This raises the multiple more than almost any other factor.',
    placeholder: '45',
    min: 0,
    max: 100,
  },
  {
    id: 'ownerDependence',
    type: 'single',
    prompt: 'What happens if you stop showing up tomorrow?',
    help: 'The most honest predictor of what a buyer will pay. A business that runs without its owner is worth substantially more than the same business that does not.',
    required: true,
    options: [
      {
        value: 'absentee',
        label: 'It runs fine',
        description: 'There is a manager and the business does not need me.',
      },
      {
        value: 'moderate',
        label: 'It would wobble',
        description: 'I hold some key relationships, but the team could cope.',
      },
      {
        value: 'critical',
        label: 'It would struggle badly',
        description:
          'The customers deal with me. Say so — it is fixable, and lying about it is not.',
      },
    ],
  },

  // --- who they want to sell to -------------------------------------------

  {
    id: 'sellReason',
    type: 'single',
    prompt: 'Why are you selling?',
    help: 'The public listing shows only a broad version of this. Buyers ask, and a straight answer builds more trust than a vague one.',
    required: true,
    options: [
      { value: 'retirement', label: 'Retiring' },
      { value: 'new_venture', label: 'Moving on to something else' },
      {
        value: 'partial',
        label: 'Taking some money off the table',
        description: 'I would stay involved.',
      },
      { value: 'health', label: 'Health or family reasons' },
      { value: 'burnout', label: 'I have had enough of running it' },
      { value: 'opportunistic', label: 'Only if the number is right' },
    ],
  },
  {
    id: 'buyerTypes',
    type: 'multi',
    prompt: 'Who would you be happy to sell to?',
    help: 'Buyers ranked for you are weighted by this. Choosing everyone is fine and means price and certainty decide.',
    maxSelections: 6,
    options: [
      {
        value: 'individual',
        label: 'An individual who will run it',
        description: 'Usually the best outcome for staff and name.',
      },
      { value: 'search_fund', label: 'A searcher backed by investors' },
      {
        value: 'strategic',
        label: 'A competitor or a company in my industry',
        description: 'Often pays the most. Often merges the business away.',
      },
      { value: 'private_equity', label: 'A private equity fund' },
      {
        value: 'family_office',
        label: 'A family office',
        description: 'Longer hold, less pressure to flip.',
      },
      { value: 'employees', label: 'My own management or employees' },
    ],
  },
  {
    id: 'employeePriority',
    type: 'scale',
    prompt: 'How much does it matter that your staff keep their jobs?',
    help: 'This is weighted into how buyers are ranked for you, and it is shown to a buyer only once you have both agreed to talk.',
    required: true,
    min: 1,
    max: 5,
    scaleLabels: { low: 'Not a factor', high: 'A condition of any deal' },
  },
  {
    id: 'legacyPriority',
    type: 'scale',
    prompt: 'How much does it matter that the business carries on as itself?',
    help: 'Name, brand, the way it operates. Some buyers absorb what they buy; others leave it alone. Worth knowing before you are three months into a process with the wrong one.',
    required: true,
    min: 1,
    max: 5,
    scaleLabels: { low: 'Not a factor', high: 'Very important to me' },
  },
  {
    id: 'transition',
    type: 'single',
    prompt: 'How long would you stay on after the sale?',
    help: 'Buyers price this. A seller who will stay six months is worth real money to somebody buying an owner-dependent business.',
    required: true,
    options: [
      { value: 'none', label: 'I want a clean break' },
      { value: 'weeks', label: 'A few weeks of handover' },
      { value: 'months', label: 'Three to six months' },
      { value: 'year', label: 'Up to a year' },
      {
        value: 'ongoing',
        label: 'I would like to stay involved',
        description: 'Consulting, or keeping a minority stake.',
      },
    ],
  },
  {
    id: 'sellerFinancing',
    type: 'single',
    prompt: 'Would you carry part of the price yourself?',
    help: 'Seller financing — the buyer pays you over time from the business. It widens your buyer pool considerably and is how a large share of small deals actually close.',
    required: true,
    options: [
      { value: 'no', label: 'No, I want paid at closing' },
      { value: 'small', label: 'A small portion', description: 'Up to about a fifth.' },
      {
        value: 'significant',
        label: 'A meaningful portion',
        description: 'A third or more, on the right terms.',
      },
      { value: 'open', label: 'Open to discussing it' },
    ],
  },
  {
    id: 'timeline',
    type: 'single',
    prompt: 'When would you like this done?',
    help: 'Most lower-middle-market sales take six to twelve months from listing to close. Setting an honest expectation now saves a lot of frustration later.',
    required: true,
    options: [
      { value: 'asap', label: 'As quickly as possible' },
      { value: 'six_months', label: 'Within six months' },
      { value: 'year', label: 'Within a year' },
      { value: 'no_rush', label: 'No hurry — the right buyer matters more' },
      { value: 'exploring', label: 'Just finding out what it is worth' },
    ],
  },
  {
    id: 'confidentialityConcern',
    type: 'scale',
    prompt: 'How damaging would it be if word got out?',
    help: 'Sets how much detail your public listing carries. High concern means a vaguer teaser and fewer, better-qualified enquiries.',
    required: true,
    min: 1,
    max: 5,
    scaleLabels: { low: 'People already know', high: 'It would cost me staff and customers' },
  },
];

export const SELLER_QUESTIONNAIRE: Questionnaire = {
  id: 'seller',
  title: 'Tell us about your business',
  intro:
    'About five minutes. At the end you will get a valuation estimate across several methods, and a draft listing you control. Nothing is published until you say so, and the confidential answers stay confidential.',
  questions: SELLER_QUESTIONS,
};
