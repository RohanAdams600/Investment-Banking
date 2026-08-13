import { describe, expect, it } from 'vitest';

import { addVersion, diffDocuments, summariseRevision } from './revise';

describe('diffDocuments', () => {
  it('reports no changes for identical text', () => {
    const diff = diffDocuments('one\ntwo', 'one\ntwo');
    expect(diff.addedCount).toBe(0);
    expect(diff.removedCount).toBe(0);
  });

  it('marks an inserted line and leaves the rest alone', () => {
    // The property that makes a redline readable. A naive comparison would
    // mark every line after the insertion as changed, and a diff that flags the
    // whole second half of a contract is worse than none.
    const diff = diffDocuments('a\nb\nc', 'a\nNEW\nb\nc');

    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(0);
    expect(diff.lines.filter((l) => l.kind === 'unchanged')).toHaveLength(3);
  });

  it('marks a removed line', () => {
    const diff = diffDocuments('a\nb\nc', 'a\nc');
    expect(diff.removedCount).toBe(1);
    expect(diff.lines.find((l) => l.kind === 'removed')?.text).toBe('b');
  });

  it('reports a replaced line as one removal and one addition', () => {
    const diff = diffDocuments('a\nold\nc', 'a\nnew\nc');
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
  });

  it('carries line numbers from both sides', () => {
    const diff = diffDocuments('a\nb', 'a\nx\nb');
    const unchanged = diff.lines.filter((l) => l.kind === 'unchanged');

    expect(unchanged[0]).toMatchObject({ beforeLine: 1, afterLine: 1 });
    // The second line moved down in the new version, and both numbers say so.
    expect(unchanged[1]).toMatchObject({ beforeLine: 2, afterLine: 3 });
  });

  it('handles an empty starting document', () => {
    const diff = diffDocuments('', 'a\nb');
    expect(diff.addedCount).toBeGreaterThan(0);
    expect(diff.removedCount).toBe(0);
  });

  it('handles everything being deleted', () => {
    const diff = diffDocuments('a\nb', '');
    expect(diff.removedCount).toBe(2);
  });

  it('recognises a whitespace-only change', () => {
    const diff = diffDocuments('The  Seller shall\nindemnify.', 'The Seller shall indemnify.');
    expect(diff.onlyWhitespace).toBe(true);
  });

  it('does not call a real edit whitespace', () => {
    const diff = diffDocuments('Seller shall indemnify.', 'Seller may indemnify.');
    expect(diff.onlyWhitespace).toBe(false);
  });
});

describe('significant removals', () => {
  const contract = [
    '1. Purchase price shall be $1,000,000.',
    '2. Seller shall indemnify Buyer against all claims.',
    '3. Governing law is the State of New York.',
    '4. The parties agree to confidential treatment.',
  ].join('\n');

  it('flags an indemnity that disappeared', () => {
    // The change most likely to be missed in a long redline and most likely to
    // matter when it is.
    const without = contract
      .split('\n')
      .filter((l) => !l.includes('indemnify'))
      .join('\n');
    expect(diffDocuments(contract, without).significantRemovals).toContain('Indemnification');
  });

  it('flags several at once', () => {
    const stripped = '1. Purchase price shall be $1,000,000.';
    const removals = diffDocuments(contract, stripped).significantRemovals;

    expect(removals).toContain('Indemnification');
    expect(removals).toContain('Governing law');
    expect(removals).toContain('Confidentiality');
  });

  it('does not flag a clause that merely moved', () => {
    // Reporting a move as a deletion trains people to ignore the warning,
    // which is worse than not warning at all.
    const reordered = contract.split('\n').reverse().join('\n');
    expect(diffDocuments(contract, reordered).significantRemovals).toEqual([]);
  });

  it('does not flag a clause that was reworded but kept', () => {
    const reworded = contract.replace(
      'Seller shall indemnify Buyer against all claims.',
      'Seller shall indemnify and hold Buyer harmless from any claim.',
    );
    expect(diffDocuments(contract, reworded).significantRemovals).toEqual([]);
  });

  it('flags nothing when nothing significant was there', () => {
    expect(diffDocuments('Hello.', 'Goodbye.').significantRemovals).toEqual([]);
  });
});

describe('summariseRevision', () => {
  it('says so when nothing changed', () => {
    expect(summariseRevision(diffDocuments('a', 'a'), 'nda')).toBe('No changes.');
  });

  it('calls formatting formatting', () => {
    const diff = diffDocuments('a  b', 'a b');
    expect(summariseRevision(diff, 'nda')).toMatch(/formatting only/i);
  });

  it('counts what moved', () => {
    const summary = summariseRevision(diffDocuments('a\nb', 'a\nc\nd'), 'loi');
    expect(summary).toMatch(/2 lines added/);
    expect(summary).toMatch(/1 line removed/);
  });

  it('warns about a removed indemnity', () => {
    const diff = diffDocuments('Seller shall indemnify Buyer.', 'Seller sells the business.');
    const summary = summariseRevision(diff, 'asset_purchase_agreement');

    expect(summary).toMatch(/indemnification/i);
    expect(summary).toMatch(/intended/i);
  });

  it('tells the reader to re-review', () => {
    // A review run against version three says nothing about version four.
    const summary = summariseRevision(diffDocuments('a', 'b'), 'stock_purchase_agreement');
    expect(summary).toMatch(/re-run the review/i);
  });

  it('never judges whether a change was good', () => {
    // The line this module does not cross. Whether a concession is wise is
    // counsel's call, and a platform saying otherwise is giving legal advice.
    const diff = diffDocuments(
      'Seller shall indemnify Buyer without limitation.',
      'Seller may indemnify Buyer up to $10,000.',
    );
    const summary = summariseRevision(diff, 'asset_purchase_agreement');

    expect(summary).not.toMatch(/improve|better|worse|risky|unsafe|recommend|should accept/i);
  });
});

describe('addVersion', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('numbers the first version 1', () => {
    expect(addVersion([], 'first', undefined, now)[0]!.version).toBe(1);
  });

  it('increments and keeps everything before it', () => {
    // The point of a revision history is answering "what did I agree to in
    // round two". Overwriting makes that unanswerable.
    let versions = addVersion([], 'v1', 'initial', now);
    versions = addVersion(versions, 'v2', 'buyer redline', now);
    versions = addVersion(versions, 'v3', undefined, now);

    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[0]!.body).toBe('v1');
    expect(versions[1]!.note).toBe('buyer redline');
  });

  it('does not reuse a number after a gap', () => {
    const existing = [{ version: 7, body: 'x', createdAt: now.toISOString() }];
    expect(addVersion(existing, 'y', undefined, now)[1]!.version).toBe(8);
  });
});
