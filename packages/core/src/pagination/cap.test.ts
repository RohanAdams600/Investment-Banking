import { describe, expect, it } from 'vitest';

import { capped, overFetch, truncationNotice } from './cap';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('capped', () => {
  it('reports nothing cut when the result is short', () => {
    const result = capped(rows(3), 10);

    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('does not claim truncation on an exactly-full page', () => {
    // The boundary that makes this worth a function. Asking for 11 and getting
    // 10 means there were exactly 10 — not 10 and something hidden.
    const result = capped(rows(10), 10);

    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(false);
  });

  it('trims and reports when the extra row comes back', () => {
    const result = capped(rows(11), 10);

    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('keeps the order the database chose', () => {
    // The query decided the sort. Slicing must not disturb it, or "the first
    // 500" stops meaning the first 500 by whatever the page ordered on.
    const result = capped(['a', 'b', 'c', 'd'], 3);
    expect(result.rows).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty result', () => {
    const result = capped([], 10);

    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('handles a limit of zero', () => {
    const result = capped(rows(1), 0);

    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it('refuses a negative limit rather than silently emptying the list', () => {
    // `.slice(0, -1)` drops the last row and looks like it worked, which is the
    // kind of bug that reaches production.
    expect(() => capped(rows(5), -1)).toThrow(RangeError);
  });
});

describe('overFetch', () => {
  it('asks for one more than it will show', () => {
    expect(overFetch(100)).toBe(101);
  });
});

describe('truncationNotice', () => {
  it('says nothing when nothing was cut', () => {
    expect(truncationNotice(capped(rows(3), 10), 'contacts')).toBeNull();
  });

  it('names what was counted', () => {
    // "Showing the first 500" on a page with three lists does not say which.
    const notice = truncationNotice(capped(rows(11), 10), 'contacts');

    expect(notice).toContain('10');
    expect(notice).toContain('contacts');
  });

  it('tells the reader what to do about it', () => {
    const notice = truncationNotice(capped(rows(11), 10), 'listings');
    expect(notice).toMatch(/filter/i);
  });
});
