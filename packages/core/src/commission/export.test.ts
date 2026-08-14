import { describe, expect, it } from 'vitest';

import {
  COMMISSION_EXPORT_COLUMNS,
  commissionCsv,
  csvField,
  exportFilename,
  exportTotals,
  type ExportableCommission,
} from './export';

const record = (over: Partial<ExportableCommission> = {}): ExportableCommission => ({
  id: 'rec-1',
  status: 'earned',
  listingId: 'listing-1',
  salePriceCents: 200_000_000,
  calculatedFeeCents: 18_000_000,
  totalFeeCents: 18_000_000,
  coBrokerFeeCents: 0,
  netFeeCents: 18_000_000,
  closedAt: '2026-03-01T00:00:00Z',
  settledAt: null,
  waivedReason: null,
  createdAt: '2026-02-01T00:00:00Z',
  ...over,
});

describe('csvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('earned')).toBe('earned');
    expect(csvField(1234)).toBe('1234');
  });

  it('quotes a value containing a comma', () => {
    expect(csvField('Anchor, Route and Sons')).toBe('"Anchor, Route and Sons"');
  });

  it('doubles an embedded quote', () => {
    expect(csvField('the "final" price')).toBe('"the ""final"" price"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('defuses a formula, which is the actual attack here', () => {
    // A field beginning = + - or @ is executed by Excel and Sheets when the
    // file is opened. `waived_reason` is free text a user typed, which is
    // exactly where somebody would put one.
    // Quoted only when the value also contains a comma, quote or newline —
    // the apostrophe is what defuses it, not the quoting.
    expect(csvField('=cmd|/c calc')).toBe(`'=cmd|/c calc`);
    expect(csvField('=SUM(A1,A2)')).toBe(`"'=SUM(A1,A2)"`);
    expect(csvField('+1234')).toBe(`'+1234`);
    expect(csvField('-1+1')).toBe(`'-1+1`);
    expect(csvField('@SUM(A1:A9)')).toBe(`'@SUM(A1:A9)`);
  });

  it('defuses the tab and carriage-return variants too', () => {
    // Both are treated as leading whitespace by spreadsheet parsers, which then
    // read the character after them as the start of a formula.
    expect(csvField('\t=1+1')).toContain(`'`);
    expect(csvField('\r=1+1')).toContain(`'`);
  });

  it('renders an absent value as empty rather than "null"', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});

describe('commissionCsv', () => {
  it('starts with the header row', () => {
    const csv = commissionCsv([]);
    expect(csv.split('\n')[0]).toBe(COMMISSION_EXPORT_COLUMNS.join(','));
  });

  it('writes one row per record', () => {
    const csv = commissionCsv([record(), record({ id: 'rec-2' })]);
    // Header, two rows, and the trailing newline's empty tail.
    expect(csv.trim().split('\n')).toHaveLength(3);
  });

  it('ends with a newline, so importers do not drop the last row', () => {
    // And the last row is the most recent commission, which is the worst one
    // to lose.
    expect(commissionCsv([record()]).endsWith('\n')).toBe(true);
  });

  it('always shows two decimal places, unlike the rest of the product', () => {
    // `formatMoney` drops the cents on a round figure, which is right on a card
    // and wrong in a column somebody reconciles against a bank statement.
    const csv = commissionCsv([record({ salePriceCents: 200_000_000 })]);
    expect(csv).toContain('$2,000,000.00');
  });

  it('gives every amount in cents and in dollars', () => {
    // A spreadsheet reads "$180,000.00" as text and 18000000 as a number. Both
    // means the accountant can sum one column and eyeball the other, and a
    // rounding dispute becomes resolvable rather than an argument about
    // display.
    const csv = commissionCsv([record()]);
    expect(csv).toContain('18000000');
    expect(csv).toContain('$180,000.00');
  });

  it('says when the minimum fee raised the number', () => {
    // Derived from two other columns rather than stored, because a stored copy
    // could disagree with them.
    const raised = commissionCsv([
      record({ calculatedFeeCents: 500_000, totalFeeCents: 1_500_000 }),
    ]);
    expect(raised.split('\n')[1]).toContain(',yes,');

    const unchanged = commissionCsv([record()]);
    expect(unchanged.split('\n')[1]).toContain(',no,');
  });

  it('carries a waived reason through without letting it break the file', () => {
    const csv = commissionCsv([
      record({ status: 'waived', waivedReason: 'Client dispute, settled at 0' }),
    ]);
    expect(csv).toContain('"Client dispute, settled at 0"');
    expect(csv.trim().split('\n')).toHaveLength(2);
  });

  it('does not execute a formula somebody typed into a waived reason', () => {
    const csv = commissionCsv([
      record({ status: 'waived', waivedReason: '=HYPERLINK("http://x")' }),
    ]);
    expect(csv).toContain(`'=HYPERLINK`);
  });

  it('produces a header-only file for no records', () => {
    expect(commissionCsv([]).trim().split('\n')).toHaveLength(1);
  });
});

describe('exportTotals', () => {
  it('reconstitutes: co-broker plus net equals gross', () => {
    const records = [
      record({ totalFeeCents: 10_000_000, coBrokerFeeCents: 4_000_000, netFeeCents: 6_000_000 }),
      record({ id: 'b', totalFeeCents: 5_000_000, coBrokerFeeCents: 0, netFeeCents: 5_000_000 }),
    ];
    const totals = exportTotals(records);
    expect(totals.coBrokerCents + totals.netCents).toBe(totals.grossCents);
  });

  it('counts a waived record but gives it no money', () => {
    // A write-off is a thing that happened. Leaving it out of the count would
    // make the file disagree with the screen; the reason is on the row.
    const totals = exportTotals([
      record(),
      record({ id: 'w', status: 'waived', waivedReason: 'goodwill' }),
    ]);
    expect(totals.records).toBe(2);
    expect(totals.grossCents).toBe(18_000_000);
  });

  it('separates earned from settled', () => {
    const totals = exportTotals([
      record({ status: 'earned', netFeeCents: 1_000_000 }),
      record({ id: 'b', status: 'settled', netFeeCents: 2_000_000 }),
    ]);
    expect(totals.earnedCents).toBe(1_000_000);
    expect(totals.settledCents).toBe(2_000_000);
  });

  it('returns zeros for an empty year', () => {
    expect(exportTotals([])).toEqual({
      records: 0,
      grossCents: 0,
      coBrokerCents: 0,
      netCents: 0,
      earnedCents: 0,
      settledCents: 0,
    });
  });
});

describe('exportFilename', () => {
  it('sorts by date in a folder listing', () => {
    expect(exportFilename('Anchor Brokerage', new Date('2026-08-14T10:00:00Z'))).toBe(
      'anchor-brokerage-commissions-2026-08-14.csv',
    );
  });

  it('survives a firm name full of punctuation', () => {
    expect(exportFilename('O’Brien & Sons, LLC', new Date('2026-01-02T00:00:00Z'))).toBe(
      'o-brien-sons-llc-commissions-2026-01-02.csv',
    );
  });

  it('falls back rather than producing a name that starts with a dot', () => {
    expect(exportFilename('!!!', new Date('2026-01-02T00:00:00Z'))).toBe(
      'firm-commissions-2026-01-02.csv',
    );
  });
});
