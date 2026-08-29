import { INDUSTRY_KEYS, type IndustryKey } from '@ib/core';

/**
 * The editorial half of an industry landing page.
 *
 * ## Why this file is long, and why it must stay long
 *
 * Ten pages that differ only by a heading and a filtered list are a doorway
 * set, and Google has been demoting those since 2015. The page has to be worth
 * landing on when the filtered list is empty — which, at launch, is every one of
 * them. So each entry carries the thing an owner searching "sell my HVAC
 * business" is actually looking for: what a buyer of that specific kind of
 * business examines, and which facts move the price in each direction.
 *
 * ## What this is not
 *
 * None of it is advice about a particular business, and none of it is a
 * valuation. `INDUSTRY_PROFILES` supplies a multiple range for illustration; it
 * is a heuristic that is wrong for any individual company by an amount no model
 * knows. The pages label it as such, in the same visual weight as the number.
 *
 * Written to be read by a person, and reviewed as copy rather than data — a
 * generated paragraph per sector would read as generated, which is precisely
 * what a business owner deciding whether to trust a marketplace notices first.
 */

export interface IndustryGuide {
  /** The phrase an owner or buyer actually types. Drives the <h1> and title. */
  searchPhrase: string;
  /** Two or three sentences on what this market looks like from both sides. */
  intro: string;
  /** What a buyer of this kind of business examines first. */
  buyersLookAt: Array<{ title: string; body: string }>;
  /** Facts that push a price up, in this sector specifically. */
  liftsValue: string[];
  /** Facts that push it down. */
  limitsValue: string[];
  /** Aimed at the owner, not the buyer. The reason they clicked. */
  sellerNote: string;
}

export const INDUSTRY_GUIDES: Record<IndustryKey, IndustryGuide> = {
  home_services: {
    searchPhrase: 'home services businesses for sale',
    intro:
      'HVAC, plumbing, electrical and adjacent trades are the most actively bought ' +
      'small businesses in the country, largely because private equity has spent a ' +
      'decade rolling them up. That means an owner with a well-run shop has more ' +
      'than one kind of buyer — a competitor, a platform company, or an operator ' +
      'buying their first business with an SBA loan.',
    buyersLookAt: [
      {
        title: 'Service agreements, counted and dated',
        body: 'A maintenance base that renews is the difference between buying a business and buying a job. Buyers want the count, the renewal rate and the average ticket, not a total.',
      },
      {
        title: 'Whether the technicians stay',
        body: 'Licensed techs are the scarce input. Tenure, pay relative to local market, and whether anyone holds the licence the company operates under are examined before the financials are.',
      },
      {
        title: 'How much work the owner personally does',
        body: 'An owner who still runs calls, quotes jobs or holds the customer relationships is selling a role. Buyers price the cost of replacing that role and subtract it.',
      },
      {
        title: 'Replacement versus repair mix',
        body: 'Install and replacement revenue is lumpy and weather-driven; service revenue recurs. The mix changes both the multiple and how a lender sizes the loan.',
      },
    ],
    liftsValue: [
      'A large, renewing maintenance agreement base',
      'A general manager already running day-to-day operations',
      'Licences held by staff who are staying, not only by the seller',
      'Dispatch and CRM data that survives the sale',
    ],
    limitsValue: [
      'Revenue concentrated in one builder or one property manager',
      'Technician turnover above the local norm',
      'Fleet at the end of its life, with the replacement bill still ahead',
      'Cash jobs that never reached the books',
    ],
    sellerNote:
      'The single highest-return thing most trades owners do before a sale is get ' +
      'themselves out of the daily schedule. A business that runs for ninety days ' +
      'without the owner is a different asset from one that does not, and the gap ' +
      'between the two is usually worth more than any operational improvement made ' +
      'in the same period.',
  },

  professional_services: {
    searchPhrase: 'accounting, consulting and agency businesses for sale',
    intro:
      'Accounting practices, consultancies, marketing agencies and similar firms ' +
      'sell on the durability of client relationships. The central question in every ' +
      'one of these transactions is whether the clients belong to the firm or to the ' +
      'person selling it, and buyers structure the deal around their answer.',
    buyersLookAt: [
      {
        title: 'Client concentration, by revenue',
        body: 'One client at thirty per cent of revenue is a different business from twenty clients at five. Buyers ask for a ranked client list with revenue and tenure before almost anything else.',
      },
      {
        title: 'Recurring versus project work',
        body: 'Retainers, compliance work and annual filings are contracted revenue. Project work has to be won again every year, and is discounted accordingly.',
      },
      {
        title: 'Who the client calls',
        body: 'If the answer is the owner, the buyer is purchasing a relationship that is leaving. Expect earnouts and long transition periods wherever this is true.',
      },
      {
        title: 'Staff leverage',
        body: 'The ratio of billable staff to owners determines whether the business scales. A firm where the owner bills most of the hours has a low ceiling and prices like it.',
      },
    ],
    liftsValue: [
      'Multi-year retainers or recurring compliance engagements',
      'Named client relationships held by staff who are staying',
      'Documented delivery processes rather than institutional memory',
      'A partner or director layer beneath the owner',
    ],
    limitsValue: [
      'A single client above roughly a fifth of revenue',
      'Work won through the owner’s personal reputation alone',
      'Realisation rates that fall once the owner stops reviewing every job',
      'Handshake fee arrangements with no engagement letters',
    ],
    sellerNote:
      'Expect the structure of a professional services sale to be different from a ' +
      'trades sale. Buyers routinely hold back a meaningful share of the price ' +
      'against client retention over one to two years, because the risk they are ' +
      'taking is specifically that the clients followed you. Getting clients ' +
      'genuinely transitioned to other staff before you go to market is what shrinks ' +
      'that holdback.',
  },

  manufacturing: {
    searchPhrase: 'manufacturing businesses for sale',
    intro:
      'Manufacturing businesses carry real assets, which changes the arithmetic. ' +
      'Lenders will advance against equipment and inventory, so a buyer can often ' +
      'finance more of the price, but the same assets raise questions about ' +
      'condition, capacity and the capital spending that has been deferred.',
    buyersLookAt: [
      {
        title: 'Equipment age and remaining life',
        body: 'A buyer prices the machine list, not the depreciation schedule. Deferred maintenance is a bill that arrives shortly after closing, and it is negotiated down from the price.',
      },
      {
        title: 'Customer concentration and contract terms',
        body: 'Long-run production for two or three OEMs is durable revenue right up until it is not. Buyers want to see the contracts, the notice periods and the requalification cost if a customer leaves.',
      },
      {
        title: 'Actual capacity utilisation',
        body: 'Headroom is the growth story. A plant running at sixty per cent gives a buyer somewhere to put more volume; one running at ninety-five requires capital before it can grow at all.',
      },
      {
        title: 'Working capital in the business',
        body: 'Inventory and receivables are a large, moving number here. How much of it transfers at close is one of the most commonly disputed points in a manufacturing sale.',
      },
    ],
    liftsValue: [
      'Long-term supply agreements with credible counterparties',
      'Certifications that are expensive for a competitor to obtain',
      'Owned real estate that can be sold or leased back',
      'Recent, documented capital investment in the plant',
    ],
    limitsValue: [
      'A single customer carrying the majority of volume',
      'Machinery near end of life with no replacement plan',
      'Environmental questions attached to the site',
      'Skilled operators approaching retirement with nobody trained behind them',
    ],
    sellerNote:
      'Settle the real estate question before you go to market. Whether the building ' +
      'is included, leased back, or sold separately changes the buyer pool, the ' +
      'financing and the headline price, and discovering that the seller has not ' +
      'decided is one of the fastest ways to lose a serious buyer’s attention.',
  },

  distribution: {
    searchPhrase: 'wholesale and distribution businesses for sale',
    intro:
      'Distribution is a margin-and-logistics business, and it is bought by people ' +
      'who understand that. Revenue is a poor guide to value here — a distributor ' +
      'turning twenty million at six per cent gross margin is worth less than one ' +
      'turning eight million at thirty.',
    buyersLookAt: [
      {
        title: 'Supplier agreements and exclusivity',
        body: 'Territory rights and line authorisations are often the real asset. Whether they survive a change of control is a question for the supplier contract, and buyers read it early.',
      },
      {
        title: 'Gross margin by product line',
        body: 'Blended margin hides the picture. Buyers want it broken out, because a business carried by one high-margin line is a concentrated bet on that line.',
      },
      {
        title: 'Inventory quality',
        body: 'Aged and obsolete stock sits on the balance sheet at cost and is worth considerably less. Expect a physical count and a write-down argument.',
      },
      {
        title: 'Customer stickiness',
        body: 'Purchase frequency and account tenure matter more than a customer count. Accounts that reorder monthly for years are the thing being bought.',
      },
    ],
    liftsValue: [
      'Exclusive territory or line rights that transfer',
      'Route density that a new entrant cannot cheaply replicate',
      'Clean, current inventory with real turns',
      'Systems that let a buyer see margin by SKU without a rebuild',
    ],
    limitsValue: [
      'Supplier agreements terminable on change of control',
      'Aged inventory carried at cost',
      'Thin margins with no pricing power',
      'A warehouse lease with little term remaining',
    ],
    sellerNote:
      'Get an honest inventory position before a buyer does it for you. The most ' +
      'common way a distribution deal loses value late is a physical count that ' +
      'turns up stock nobody has sold in three years, discovered at the point where ' +
      'the buyer’s trust is the thing actually being spent.',
  },

  saas: {
    searchPhrase: 'software and SaaS businesses for sale',
    intro:
      'Software businesses trade on the quality of their revenue rather than its ' +
      'size. Two companies with identical annual recurring revenue can be worth ' +
      'twice one another, and the difference is almost entirely churn, gross margin ' +
      'and how much of growth is bought rather than earned.',
    buyersLookAt: [
      {
        title: 'Net revenue retention',
        body: 'Whether an existing cohort spends more or less this year than last. Above one hundred per cent the business grows without selling anything new, and buyers pay for that specifically.',
      },
      {
        title: 'Churn, by cohort and by logo',
        body: 'A blended churn figure hides whether the product keeps small customers and loses large ones. Buyers rebuild this from raw data and rarely accept the seller’s dashboard.',
      },
      {
        title: 'Customer acquisition cost and payback',
        body: 'How many months of gross profit it takes to recover the cost of winning a customer. A long payback funded by the founder’s savings is not growth, it is a subsidy.',
      },
      {
        title: 'Technical concentration',
        body: 'Whether one engineer holds the entire system in their head, and whether the code, the infrastructure accounts and the domain are all actually owned by the company.',
      },
    ],
    liftsValue: [
      'Net revenue retention above one hundred per cent',
      'Annual contracts paid up front',
      'Organic or referral-led acquisition rather than paid',
      'An engineering team that outlives any one person',
    ],
    limitsValue: [
      'Monthly plans with high logo churn',
      'Growth that stops the moment ad spend does',
      'A single integration or platform the whole product depends on',
      'Infrastructure or domains registered to a founder personally',
    ],
    sellerNote:
      'Assemble the data room before you talk to anyone. Software buyers are the ' +
      'most analytically aggressive in the lower middle market: they will ask for ' +
      'raw subscription events, not a summary, and the speed of your answer is read ' +
      'as a signal about the quality of the business itself.',
  },

  healthcare_services: {
    searchPhrase: 'healthcare services businesses for sale',
    intro:
      'Medical, dental and allied practices sell into a deep buyer pool of ' +
      'consolidators, but they also carry regulatory weight that other sectors do ' +
      'not. Payer mix, licensure and corporate practice rules shape both the price ' +
      'and the legal structure the deal has to take.',
    buyersLookAt: [
      {
        title: 'Payer mix and reimbursement rates',
        body: 'The split between commercial insurance, government programmes and cash determines both margin and its stability. Contracted rates are examined line by line.',
      },
      {
        title: 'Provider retention',
        body: 'Whether the clinicians who generate the revenue are staying, and what their employment and non-compete agreements say. A practice without its providers is a lease and some equipment.',
      },
      {
        title: 'Billing and compliance history',
        body: 'Coding practices, past audits and any open enquiries. This is due diligence that buyers do carefully because the liability can follow the business.',
      },
      {
        title: 'Referral sources',
        body: 'Where patients come from, and whether those relationships are the owner’s personally. Referral arrangements also raise legal questions specific to healthcare.',
      },
    ],
    liftsValue: [
      'Associate providers under contract and staying',
      'A diversified payer mix with favourable contracted rates',
      'Clean billing and audit history',
      'Modern equipment and records systems already in place',
    ],
    limitsValue: [
      'Revenue dependent on the selling clinician personally',
      'Concentration in a single payer or programme',
      'Open compliance or billing enquiries',
      'Referral relationships that will not survive the owner’s exit',
    ],
    sellerNote:
      'Structure matters more here than in any other sector on this list. Many ' +
      'states restrict who may own a practice, which shapes whether a transaction ' +
      'can be a straightforward sale at all. That is a question for a healthcare ' +
      'transactions attorney in your state, early, before you agree to anything ' +
      'with a buyer.',
  },

  restaurants_retail: {
    searchPhrase: 'restaurants and retail businesses for sale',
    intro:
      'Restaurants and retail shops change hands more often than any other category ' +
      'and at the lowest multiples, for a reason worth stating plainly: much of what ' +
      'makes them work is the lease and the operator, and neither is guaranteed to ' +
      'transfer.',
    buyersLookAt: [
      {
        title: 'The lease, in full',
        body: 'Remaining term, renewal options, rent escalations and whether the landlord will consent to an assignment. A short lease with no options can make an otherwise sound business unsellable.',
      },
      {
        title: 'Rent and labour as a share of sales',
        body: 'These two lines decide whether the business survives a slow quarter. Buyers benchmark them against category norms before looking at anything else.',
      },
      {
        title: 'Verifiable sales',
        body: 'Point-of-sale data reconciled to bank deposits and tax filings. Unreported cash is worth nothing to a buyer and raises a question about everything else in the numbers.',
      },
      {
        title: 'Condition of the equipment and fit-out',
        body: 'Kitchen equipment and refrigeration have finite lives and a large replacement cost. A buyer prices the remaining life, not the book value.',
      },
    ],
    liftsValue: [
      'A long lease with renewal options at known rent',
      'Sales that reconcile cleanly to filed tax returns',
      'A trained manager running shifts without the owner',
      'Recently replaced kitchen or refrigeration equipment',
    ],
    limitsValue: [
      'A lease near expiry, or a landlord who must approve any buyer',
      'A large share of sales in unreported cash',
      'An owner working sixty hours a week in the business',
      'Deferred equipment replacement',
    ],
    sellerNote:
      'Talk to the landlord before you list. Lease assignment is the single most ' +
      'common reason a restaurant or retail sale collapses after a buyer is found, ' +
      'and it is entirely knowable in advance. Get the assignment terms in writing ' +
      'first; it costs you a phone call and saves the deal.',
  },

  construction: {
    searchPhrase: 'construction and contracting businesses for sale',
    intro:
      'Construction businesses are bought on backlog and bonding capacity. The ' +
      'financial statements describe work that has already happened; the value sits ' +
      'in signed work that has not, and in whether the buyer can be bonded to ' +
      'perform it.',
    buyersLookAt: [
      {
        title: 'Backlog, and its margin',
        body: 'Signed contracts not yet built, with the estimated gross margin on each. A large backlog at thin or negative margin is a liability, not an asset.',
      },
      {
        title: 'Bonding capacity and who it follows',
        body: 'Surety capacity is extended to the company on the strength of the owner’s balance sheet and personal indemnity. Whether it survives a sale is a conversation with the surety, not an assumption.',
      },
      {
        title: 'Work-in-progress accounting',
        body: 'Over- and under-billings are where construction financials most often mislead. Buyers rebuild the WIP schedule and reconcile it to the balance sheet.',
      },
      {
        title: 'Licensing and the qualifying individual',
        body: 'Many contractor licences attach to a named person. If that person is the seller, the buyer needs a plan for the licence before closing, not after.',
      },
    ],
    liftsValue: [
      'A backlog of signed work at documented margin',
      'A qualifying individual who is staying with the business',
      'Repeat general contractor or public agency relationships',
      'Owned equipment with real remaining life',
    ],
    limitsValue: [
      'Bonding capacity tied to the seller personally',
      'Backlog concentrated in one project or one general contractor',
      'Open claims, liens or warranty disputes',
      'Cost overruns that the WIP schedule has been absorbing quietly',
    ],
    sellerNote:
      'Ask your surety what happens on a change of control before you go to market. ' +
      'Bonding is frequently the constraint that decides which buyers can credibly ' +
      'close, and knowing the answer early tells you which kind of buyer to spend ' +
      'your time on.',
  },

  transportation: {
    searchPhrase: 'transportation and logistics businesses for sale',
    intro:
      'Trucking, freight brokerage and last-mile logistics companies are bought on ' +
      'contracted lane density and the cost structure underneath it. Asset-heavy and ' +
      'asset-light businesses in this sector are genuinely different assets and are ' +
      'priced by different buyers.',
    buyersLookAt: [
      {
        title: 'Contracted versus spot revenue',
        body: 'Dedicated contract freight is durable; spot market exposure moves with the cycle. The mix is the first thing a buyer separates out.',
      },
      {
        title: 'Driver retention and classification',
        body: 'Turnover is the sector’s defining operating problem, and whether drivers are employees or contractors carries real legal exposure that a buyer inherits.',
      },
      {
        title: 'Fleet age and maintenance history',
        body: 'Tractors and trailers have known replacement cycles. A buyer prices the capital plan for the next three years and deducts it.',
      },
      {
        title: 'Safety rating and claims history',
        body: 'Regulatory safety scores and insurance loss runs affect both insurability and cost. A poor record can raise a buyer’s premiums enough to change the price.',
      },
    ],
    liftsValue: [
      'Dedicated contracts with shippers, in writing',
      'Driver turnover meaningfully below sector norms',
      'A clean safety record and favourable loss runs',
      'Owned, well-maintained equipment with life remaining',
    ],
    limitsValue: [
      'Heavy exposure to spot rates',
      'Contractor classification that has not been tested',
      'An ageing fleet with the replacement cycle due',
      'One shipper carrying most of the volume',
    ],
    sellerNote:
      'Have the insurance loss runs and the safety file ready on day one. In this ' +
      'sector those two documents move the price as much as the profit and loss ' +
      'statement does, and a seller who produces them immediately is treated as a ' +
      'different class of counterparty.',
  },

  other: {
    searchPhrase: 'businesses for sale',
    intro:
      'Businesses that do not fit a standard category — and a great many good ones ' +
      'do not. What buyers examine is the same in every case: whether the earnings ' +
      'are real, whether they continue without the current owner, and whether ' +
      'anything about the business is concentrated in a way that could remove those ' +
      'earnings suddenly.',
    buyersLookAt: [
      {
        title: 'Earnings that reconcile to tax returns',
        body: 'Every serious buyer traces reported profit back to filed returns. Add-backs are normal; add-backs that cannot be evidenced are where trust ends.',
      },
      {
        title: 'Owner dependence',
        body: 'How much of the business runs through one person’s relationships, knowledge or hours. This single factor moves value more than any other on this list.',
      },
      {
        title: 'Concentration of any kind',
        body: 'One customer, one supplier, one employee, one contract, one platform. Buyers look for anything whose departure would materially change the business.',
      },
      {
        title: 'What is actually being sold',
        body: 'Whether the contracts, licences, domain names, equipment and intellectual property are owned by the company or by the owner personally. Frequently they are mixed.',
      },
    ],
    liftsValue: [
      'Earnings that tie cleanly to filed tax returns',
      'Management that operates without the owner present',
      'Diversified customers and suppliers',
      'Assets and contracts held by the company, not the owner',
    ],
    limitsValue: [
      'Income that cannot be evidenced',
      'Any single relationship the business could not survive losing',
      'Key assets registered to the owner personally',
      'No written agreements with staff, customers or suppliers',
    ],
    sellerNote:
      'If your business does not fit a category neatly, the preparation that matters ' +
      'is the same as everyone else’s: clean books that reconcile to your returns, ' +
      'written agreements where there are currently understandings, and evidence ' +
      'that the business runs when you are not there.',
  },
};

/** Guarded so a new industry cannot be added without its page content. */
export const GUIDED_INDUSTRY_KEYS: IndustryKey[] = INDUSTRY_KEYS.filter(
  (key) => key in INDUSTRY_GUIDES,
);

export function industryGuide(key: IndustryKey): IndustryGuide {
  return INDUSTRY_GUIDES[key];
}

/**
 * Sentence-cases a search phrase so it can open a meta description.
 *
 * `charAt` rather than an index, because an index into a string is possibly
 * undefined under the strict compiler settings this workspace runs, and a page
 * that fails to build over a description is not a trade worth making.
 */
export function sentenceCase(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
