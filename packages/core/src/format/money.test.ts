import { describe, expect, it } from 'vitest';

import { formatMoney, formatMoneyCompact, parseMoneyToCents } from './money';

describe('formatMoney', () => {
  it('drops the fractional part for whole-dollar amounts', () => {
    expect(formatMoney(4_750_000_00)).toBe('$4,750,000');
  });

  it('keeps cents when the amount is not whole', () => {
    expect(formatMoney(4_750_000_50)).toBe('$4,750,000.50');
  });

  it('shows cents on whole amounts when asked to', () => {
    expect(formatMoney(1_000_00, { compactCents: false })).toBe('$1,000.00');
  });

  it('handles zero and negative amounts', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(-25_000_00)).toBe('-$25,000');
  });

  it('rejects non-integer cents rather than silently rounding', () => {
    // A float here means an upstream calculation escaped integer arithmetic,
    // which is exactly the bug this guard exists to surface.
    expect(() => formatMoney(1234.56)).toThrow(/integer cents/);
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer/);
  });
});

describe('formatMoneyCompact', () => {
  it('abbreviates millions and thousands', () => {
    expect(formatMoneyCompact(4_750_000_00)).toBe('$4.8M');
    expect(formatMoneyCompact(750_000_00)).toBe('$750K');
  });
});

describe('parseMoneyToCents', () => {
  it('parses formatted currency back to integer cents', () => {
    expect(parseMoneyToCents('$4,750,000.50')).toBe(475_000_050);
    expect(parseMoneyToCents('4750000')).toBe(475_000_000);
  });

  it('round-trips through formatMoney without drift', () => {
    const original = 1_234_567_89;
    expect(parseMoneyToCents(formatMoney(original, { compactCents: false }))).toBe(original);
  });

  it('rounds rather than truncating, so a cent is never lost', () => {
    // 0.1 + 0.2 arithmetic would otherwise land on 10.299999999999999 -> 1029.
    expect(parseMoneyToCents('10.30')).toBe(1030);
  });

  it('throws on input with no numeric content', () => {
    expect(() => parseMoneyToCents('')).toThrow();
    expect(() => parseMoneyToCents('n/a')).toThrow();
  });
});
