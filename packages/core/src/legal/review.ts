/**
 * Legal document drafting support and review.
 *
 * Read this before changing anything here.
 *
 * What this does: fills a versioned, attorney-approved template with the
 * particulars of a deal, and checks the result against a checklist of terms
 * that are commonly missing or commonly wrong in lower-middle-market M&A
 * documents.
 *
 * What this does **not** do, and must never be described as doing:
 *
 *   - produce a document that is ready to sign
 *   - determine that a document is legally sufficient, enforceable, or
 *     compliant with any law or regulation
 *   - replace an attorney
 *
 * The distinction is not decorative. A seller who signs a purchase agreement
 * because software told them it was fine has been harmed by this product, and
 * "the disclaimer was on the page" is not a defence anyone should be
 * comfortable relying on. So the checklist is deliberately framed as *questions
 * to take to your attorney*, findings are never phrased as verdicts, and no
 * code path returns anything resembling "this document is complete".
 *
 * The generation is template substitution, not a language model writing legal
 * text from scratch. Templates are drafted and approved by counsel, versioned,
 * and referenced by id from every consent and document record, so the exact
 * words a party agreed to are reproducible years later. An LLM generating novel
 * contract language per deal makes that impossible and adds a failure mode —
 * plausible-sounding clauses that do not mean what they appear to — that nobody
 * downstream is equipped to catch.
 */

export type LegalDocumentKind =
  'nda' | 'loi' | 'asset_purchase_agreement' | 'stock_purchase_agreement' | 'broker_agreement';

export const LEGAL_DOCUMENT_KINDS: LegalDocumentKind[] = [
  'nda',
  'loi',
  'asset_purchase_agreement',
  'stock_purchase_agreement',
  'broker_agreement',
];

export const DOCUMENT_LABELS: Record<LegalDocumentKind, string> = {
  nda: 'Non-disclosure agreement',
  loi: 'Letter of intent',
  asset_purchase_agreement: 'Asset purchase agreement',
  stock_purchase_agreement: 'Stock purchase agreement',
  broker_agreement: 'Broker engagement agreement',
};

/** Severity describes how much attention a finding deserves — never legality. */
export type FindingSeverity = 'blocker' | 'attention' | 'note';

export interface ReviewFinding {
  severity: FindingSeverity;
  /** What is missing or unusual. */
  summary: string;
  /**
   * Framed as a question for the parties or their counsel, never as an
   * instruction and never as a judgment about validity.
   */
  question: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  /** Placeholders left unfilled in the draft. */
  unresolvedPlaceholders: string[];
  /**
   * Always true. Present as a field rather than left implicit so that any
   * surface rendering a review has to acknowledge it, and so a future change
   * that tried to set it false would be a visible diff.
   */
  requiresAttorneyReview: true;
}

/**
 * Terms whose absence is worth raising, per document kind.
 *
 * These are drawn from what routinely causes disputes in this market. They are
 * not a definition of a valid document — no such list exists, and a document
 * containing every term below can still be badly wrong for a particular deal.
 */
const EXPECTED_TERMS: Record<
  LegalDocumentKind,
  Array<{
    pattern: RegExp;
    severity: FindingSeverity;
    summary: string;
    question: string;
  }>
> = {
  nda: [
    {
      pattern: /\bterm\b|\bduration\b|\bperiod of\b/i,
      severity: 'blocker',
      summary: 'No confidentiality period appears to be stated.',
      question: 'How long should confidentiality last, and does it survive termination?',
    },
    {
      pattern: /\bpermitted\s+(disclosure|recipient)|\brepresentatives\b/i,
      severity: 'attention',
      summary: 'No permitted-recipient clause found.',
      question:
        'May the receiving party share information with lenders, accountants or counsel, and ' +
        'are they bound on the same terms?',
    },
    {
      pattern: /\breturn\b|\bdestroy\b/i,
      severity: 'attention',
      summary: 'No return-or-destroy obligation found.',
      question: 'What happens to the information if the deal does not proceed?',
    },
    {
      pattern: /\bnon-?solicit/i,
      severity: 'note',
      summary: 'No non-solicitation clause found.',
      question:
        'Should the buyer be restricted from soliciting employees or customers if the deal ' +
        'does not close?',
    },
  ],
  loi: [
    {
      pattern: /\bnon-?binding\b|\bbinding\b/i,
      severity: 'blocker',
      summary: 'The letter does not say which provisions are binding.',
      question:
        'Which parts are intended to bind — typically exclusivity and confidentiality — and ' +
        'which are not? An LOI silent on this is the most common source of dispute at this stage.',
    },
    {
      pattern: /\bexclusiv|\bno-?shop\b/i,
      severity: 'attention',
      summary: 'No exclusivity or no-shop period found.',
      question: 'Is the seller agreeing not to negotiate with others, and for how long?',
    },
    {
      pattern: /\bpurchase price\b|\bconsideration\b/i,
      severity: 'blocker',
      summary: 'No purchase price or consideration appears to be stated.',
      question: 'What is the proposed price, and how is it structured?',
    },
    {
      pattern: /\bdue diligence\b|\bdiligence period\b/i,
      severity: 'attention',
      summary: 'No diligence period found.',
      question: 'How long does the buyer have to complete diligence, and what access is granted?',
    },
    {
      pattern: /\bfinancing\b|\bcontingen/i,
      severity: 'attention',
      summary: 'No financing contingency found.',
      question: 'Is the offer conditional on the buyer obtaining financing?',
    },
  ],
  asset_purchase_agreement: [
    {
      pattern: /\bexcluded assets?\b/i,
      severity: 'blocker',
      summary: 'No excluded assets are identified.',
      question:
        'Which assets are the seller keeping? In an asset sale, anything not listed as ' +
        'transferring is a question waiting to be argued about.',
    },
    {
      pattern: /\bassumed liabilit/i,
      severity: 'blocker',
      summary: 'No assumed liabilities clause found.',
      question:
        'Which liabilities transfer to the buyer and which stay with the seller? This is the ' +
        'main reason buyers prefer asset sales.',
    },
    {
      pattern: /\bworking capital\b/i,
      severity: 'attention',
      summary: 'No working capital adjustment found.',
      question: 'Is there a target working capital level, and how is a shortfall settled?',
    },
    {
      pattern: /\bindemnif/i,
      severity: 'blocker',
      summary: 'No indemnification provisions found.',
      question: 'Who bears the cost if a representation turns out to be untrue after closing?',
    },
    {
      pattern: /\bescrow\b|\bholdback\b/i,
      severity: 'note',
      summary: 'No escrow or holdback found.',
      question: 'Is part of the price being held back to secure the seller’s indemnities?',
    },
  ],
  stock_purchase_agreement: [
    {
      pattern: /\brepresentations and warranties\b/i,
      severity: 'blocker',
      summary: 'No representations and warranties section found.',
      question:
        'What is the seller stating about the company? In a stock sale the buyer inherits ' +
        'everything, so these carry more weight than in an asset sale.',
    },
    {
      pattern: /\bindemnif/i,
      severity: 'blocker',
      summary: 'No indemnification provisions found.',
      question: 'Who bears the cost of pre-closing liabilities that surface later?',
    },
    {
      pattern: /\bcapitalization\b|\bcap table\b|\bshares outstanding\b/i,
      severity: 'attention',
      summary: 'No capitalisation detail found.',
      question: 'Exactly what equity is being sold, and is there anything convertible outstanding?',
    },
    {
      pattern: /\bescrow\b|\bholdback\b/i,
      severity: 'note',
      summary: 'No escrow or holdback found.',
      question: 'Is part of the price being held back to secure the seller’s indemnities?',
    },
  ],
  broker_agreement: [
    {
      pattern: /\bcommission\b|\bfee\b/i,
      severity: 'blocker',
      summary: 'No commission or fee terms found.',
      question: 'How is the broker paid, on what, and when does the fee become due?',
    },
    {
      pattern: /\bterm\b|\bexpir/i,
      severity: 'blocker',
      summary: 'No engagement term found.',
      question: 'How long does the engagement run and how can either side end it?',
    },
    {
      pattern: /\btail\b|\bafter termination\b/i,
      severity: 'attention',
      summary: 'No tail period found.',
      question:
        'If the seller closes with a buyer the broker introduced, after the engagement ends, ' +
        'is a fee still owed?',
    },
    {
      pattern: /\bexclusive\b|\bnon-?exclusive\b/i,
      severity: 'attention',
      summary: 'The engagement does not say whether it is exclusive.',
      question: 'May the seller engage other brokers, or sell directly, during the term?',
    },
  ],
};

/** `{{buyer_name}}` and similar. */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Fills a template with the values provided.
 *
 * Unknown placeholders are deliberately **left in place** rather than replaced
 * with an empty string. A contract with a blank where a party's name should be
 * is obviously unfinished; one where the blank has been silently removed reads
 * as complete and is not.
 */
export function fillTemplate(
  templateBody: string,
  values: Record<string, string>,
): { body: string; unresolved: string[] } {
  const unresolved = new Set<string>();

  const body = templateBody.replace(PLACEHOLDER_PATTERN, (match, rawName: string) => {
    const name = rawName.toLowerCase();
    const value = values[name];

    if (value === undefined || value.trim() === '') {
      unresolved.add(name);
      return match;
    }

    return value;
  });

  return { body, unresolved: [...unresolved].sort() };
}

/**
 * Reviews a draft against the checklist for its kind.
 *
 * Returns questions, never verdicts. There is no "passed" in the result type,
 * and adding one would misrepresent what this can determine.
 */
export function reviewDocument(kind: LegalDocumentKind, body: string): ReviewResult {
  const findings: ReviewFinding[] = [];

  for (const term of EXPECTED_TERMS[kind]) {
    if (!term.pattern.test(body)) {
      findings.push({
        severity: term.severity,
        summary: term.summary,
        question: term.question,
      });
    }
  }

  const unresolved = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    unresolved.add(match[1]!.toLowerCase());
  }

  if (unresolved.size > 0) {
    findings.unshift({
      severity: 'blocker',
      summary: `${unresolved.size} placeholder${unresolved.size === 1 ? '' : 's'} still unfilled.`,
      question: 'Fill every placeholder before sending this to the other side or to counsel.',
    });
  }

  return {
    findings,
    unresolvedPlaceholders: [...unresolved].sort(),
    requiresAttorneyReview: true,
  };
}

/**
 * The line shown on every generated document, and embedded in the file itself
 * so it survives being downloaded and forwarded.
 *
 * Exported as a constant rather than written per surface, for the same reason
 * the AI disclaimers are: a new export path should not be able to omit it.
 */
export const LEGAL_DRAFT_NOTICE =
  'This is a draft generated from a template for discussion purposes. It is not legal ' +
  'advice, it has not been reviewed for your situation, and it is not represented as ' +
  'complete, enforceable, or compliant with any law. Have a qualified attorney review it ' +
  'before you sign or send it.';
