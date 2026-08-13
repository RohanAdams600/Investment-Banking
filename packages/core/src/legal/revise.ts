import type { LegalDocumentKind } from './review';

/**
 * Revising a document, and showing exactly what changed.
 *
 * Drafting is the easy half. The half that eats weeks in a real transaction is
 * the third round of redlines, where somebody has to work out what moved
 * between version four and version five and whether they agreed to it.
 *
 * So a revision here is never a silent overwrite. Every version is kept, and
 * the diff between any two is computed line by line and shown. That is the
 * whole feature: not "the AI improved your contract" — which is a claim nobody
 * should make — but "here is precisely what is different, read it".
 *
 * ## What this does not do
 *
 * It does not decide whether a change is good. A clause moving from
 * "Seller shall indemnify" to "Seller may indemnify" is a large change and this
 * module will show it in the right colour and say nothing about whether to
 * accept it. That is counsel's call and the parties'.
 */

export type ChangeKind = 'added' | 'removed' | 'unchanged';

export interface DiffLine {
  kind: ChangeKind;
  text: string;
  /** Line number in the earlier version, where it exists. */
  beforeLine?: number;
  /** Line number in the later version, where it exists. */
  afterLine?: number;
}

export interface DocumentDiff {
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
  /** True when nothing changed but whitespace. */
  onlyWhitespace: boolean;
  /**
   * Clauses whose disappearance is worth stopping over.
   *
   * A revision that removes an indemnity or a governing-law clause is the kind
   * of thing that gets missed in a long redline and matters enormously.
   */
  significantRemovals: string[];
}

export interface DocumentVersion {
  version: number;
  body: string;
  createdAt: string;
  /** Free text, from whoever made the revision. */
  note?: string;
}

/**
 * Clause language whose removal is flagged loudly.
 *
 * Deliberately short. A long list produces noise, everything gets flagged,
 * and the flag stops meaning anything — these are the terms whose quiet
 * disappearance actually causes disputes in this market.
 */
const SIGNIFICANT_CLAUSES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bindemnif/i, label: 'Indemnification' },
  { pattern: /\bgoverning law\b/i, label: 'Governing law' },
  { pattern: /\bconfidential/i, label: 'Confidentiality' },
  { pattern: /\bnon-?compet/i, label: 'Non-compete' },
  { pattern: /\bnon-?solicit/i, label: 'Non-solicitation' },
  { pattern: /\bescrow\b/i, label: 'Escrow' },
  { pattern: /\brepresentations? and warrant/i, label: 'Representations and warranties' },
  { pattern: /\btermination\b/i, label: 'Termination' },
  { pattern: /\bdispute resolution\b|\barbitrat/i, label: 'Dispute resolution' },
  { pattern: /\bpurchase price\b/i, label: 'Purchase price' },
];

/**
 * Line-by-line diff.
 *
 * A longest-common-subsequence walk, which is what makes the output readable:
 * a naive line-by-line comparison reports every line after an insertion as
 * changed, and a redline that marks the whole second half of a contract as new
 * is worse than no redline at all.
 *
 * Lines rather than words. Contract review happens at the clause level, and a
 * word-level diff of a paragraph that was rewritten is confetti.
 */
export function diffDocuments(before: string, after: string): DocumentDiff {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  const table = lcsTable(beforeLines, afterLines);
  const lines: DiffLine[] = [];

  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      lines.push({ kind: 'unchanged', text: beforeLines[i]!, beforeLine: i + 1, afterLine: j + 1 });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      lines.push({ kind: 'removed', text: beforeLines[i]!, beforeLine: i + 1 });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: afterLines[j]!, afterLine: j + 1 });
      j += 1;
    }
  }

  while (i < beforeLines.length) {
    lines.push({ kind: 'removed', text: beforeLines[i]!, beforeLine: i + 1 });
    i += 1;
  }
  while (j < afterLines.length) {
    lines.push({ kind: 'added', text: afterLines[j]!, afterLine: j + 1 });
    j += 1;
  }

  const added = lines.filter((line) => line.kind === 'added');
  const removed = lines.filter((line) => line.kind === 'removed');

  return {
    lines,
    addedCount: added.length,
    removedCount: removed.length,
    onlyWhitespace: normalise(before) === normalise(after) && before !== after,
    significantRemovals: findSignificantRemovals(before, after),
  };
}

/**
 * Clauses present before and absent after.
 *
 * Checked against the whole document rather than the removed lines, because a
 * clause that moved is not a clause that went — and reporting a move as a
 * deletion trains people to ignore the warning.
 */
function findSignificantRemovals(before: string, after: string): string[] {
  return SIGNIFICANT_CLAUSES.filter(
    ({ pattern }) => pattern.test(before) && !pattern.test(after),
  ).map(({ label }) => label);
}

/**
 * An empty document has no lines.
 *
 * `''.split('\n')` yields one empty string, which would report the first draft
 * of a document as "1 line removed" against nothing.
 */
function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Standard LCS length table over two line arrays. */
function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? (table[i + 1]![j + 1] ?? 0) + 1
          : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }

  return table;
}

/**
 * A plain-language summary of a revision.
 *
 * Describes scale and flags removals. It does not characterise the change as
 * an improvement, a risk, or a concession — those are judgements about the
 * substance of a contract, and this counts lines.
 */
export function summariseRevision(diff: DocumentDiff, kind: LegalDocumentKind): string {
  if (diff.addedCount === 0 && diff.removedCount === 0) {
    return 'No changes.';
  }

  if (diff.onlyWhitespace) {
    return 'Formatting only — the wording is unchanged.';
  }

  const parts: string[] = [];
  if (diff.addedCount > 0) {
    parts.push(`${diff.addedCount} ${diff.addedCount === 1 ? 'line' : 'lines'} added`);
  }
  if (diff.removedCount > 0) {
    parts.push(`${diff.removedCount} ${diff.removedCount === 1 ? 'line' : 'lines'} removed`);
  }

  let summary = `${parts.join(', ')}.`;

  if (diff.significantRemovals.length > 0) {
    summary +=
      ` This revision removes language about ${listPhrase(diff.significantRemovals)}. ` +
      'Confirm that was intended before sending it on.';
  }

  // Named so the reader knows which checklist the review beneath it used.
  summary += ` Re-run the review for this ${kind.replace(/_/g, ' ')} after any revision.`;

  return summary;
}

function listPhrase(items: string[]): string {
  if (items.length === 1) return items[0]!.toLowerCase();
  const lowered = items.map((item) => item.toLowerCase());
  return `${lowered.slice(0, -1).join(', ')} and ${lowered[lowered.length - 1]}`;
}

/**
 * Appends a version, keeping every earlier one.
 *
 * Nothing is overwritten. The whole value of a revision history is that a party
 * can go back and see what they actually agreed to in round two, and a system
 * that keeps only the current text cannot answer that question.
 */
export function addVersion(
  versions: DocumentVersion[],
  body: string,
  note?: string,
  now: Date = new Date(),
): DocumentVersion[] {
  const version = versions.length === 0 ? 1 : Math.max(...versions.map((v) => v.version)) + 1;

  return [...versions, { version, body, note, createdAt: now.toISOString() }];
}
