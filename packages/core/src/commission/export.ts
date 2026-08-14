import { formatMoney, type Cents } from '../format/money';

/**
 * Always two decimal places, unlike the rest of the product.
 *
 * `formatMoney` drops the cents on a round figure, which is right on a card and
 * wrong in a column somebody reconciles against a bank statement — a column
 * mixing "$180,000" and "$180,000.50" is harder to scan and harder for an
 * importer to type consistently.
 */
function exportMoney(cents: Cents): string {
  return formatMoney(cents, { compactCents: false });
}

/**
 * Commission records as a file an accountant can open.
 *
 * The last outstanding half of step 9. What a broker needs at the end of a year
 * is not a screen — it is something they can hand to whoever does their books,
 * and the honest form of that is a CSV, because every accounting package on
 * earth imports one and no accountant has ever asked for JSON.
 *
 * ## Two amount columns, and both of them
 *
 * A statement that shows only the net fee understates what the firm invoiced; a
 * statement that shows only the gross overstates what it kept. Both are on
 * every row, alongside the sale price they came from, so a reconciliation that
 * disagrees with the bank has somewhere to look.
 *
 * ## Cents, and also dollars
 *
 * Every amount appears twice: the integer cents that the platform computed with
 * and a formatted dollar figure a person can read. That looks redundant and is
 * not — a spreadsheet that reads "$1,234.56" as text and "123456" as a number
 * lets the accountant sum one column and eyeball the other, and it makes a
 * rounding dispute resolvable rather than an argument about display.
 *
 * ## What this is not
 *
 * Not a tax filing, not a 1099, and not advice about either. It is the firm's
 * own record in a portable format, and the header row says so.
 */

export interface ExportableCommission {
  id: string;
  status: 'projected' | 'earned' | 'settled' | 'waived';
  listingId: string | null;
  salePriceCents: Cents;
  calculatedFeeCents: Cents;
  totalFeeCents: Cents;
  coBrokerFeeCents: Cents;
  netFeeCents: Cents;
  closedAt: string | null;
  settledAt: string | null;
  waivedReason: string | null;
  createdAt: string;
}

export const COMMISSION_EXPORT_COLUMNS = [
  'record_id',
  'status',
  'listing_id',
  'sale_price_cents',
  'sale_price',
  'calculated_fee_cents',
  'calculated_fee',
  'minimum_applied',
  'gross_fee_cents',
  'gross_fee',
  'co_broker_fee_cents',
  'co_broker_fee',
  'net_fee_cents',
  'net_fee',
  'closed_at',
  'settled_at',
  'waived_reason',
  'recorded_at',
] as const;

/**
 * Escapes one field for CSV.
 *
 * Quoting is not the interesting part. The leading apostrophe is: a field
 * beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and Sheets
 * when the file is opened, which turns "export your records" into arbitrary
 * code running on the accountant's machine. `waived_reason` is free text a user
 * typed, which is exactly the field somebody would put `=cmd|...` in.
 *
 * Prefixing with an apostrophe is the standard mitigation and costs a leading
 * character in a cell nobody sums.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const dangerous = /^[=+\-@\t\r]/.test(text);
  const prefixed = dangerous ? `'${text}` : text;

  if (/[",\n\r]/.test(prefixed)) {
    return `"${prefixed.replace(/"/g, '""')}"`;
  }

  return prefixed;
}

export function commissionCsv(records: readonly ExportableCommission[]): string {
  const rows = [COMMISSION_EXPORT_COLUMNS.join(',')];

  for (const record of records) {
    rows.push(
      [
        record.id,
        record.status,
        record.listingId ?? '',
        record.salePriceCents,
        exportMoney(record.salePriceCents),
        record.calculatedFeeCents,
        exportMoney(record.calculatedFeeCents),
        // Derived rather than stored, because it is a fact about two other
        // columns and a stored copy could disagree with them.
        record.totalFeeCents > record.calculatedFeeCents ? 'yes' : 'no',
        record.totalFeeCents,
        exportMoney(record.totalFeeCents),
        record.coBrokerFeeCents,
        exportMoney(record.coBrokerFeeCents),
        record.netFeeCents,
        exportMoney(record.netFeeCents),
        record.closedAt ?? '',
        record.settledAt ?? '',
        record.waivedReason ?? '',
        record.createdAt,
      ]
        .map(csvField)
        .join(','),
    );
  }

  // A trailing newline. Some importers drop the last row without one, and
  // losing the most recent commission is the worst row to lose.
  return `${rows.join('\n')}\n`;
}

/** `cairn-commissions-2026-08-14.csv` — sorts by date in a folder listing. */
export function exportFilename(firmName: string, on: Date = new Date()): string {
  const slug =
    firmName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'firm';

  return `${slug}-commissions-${on.toISOString().slice(0, 10)}.csv`;
}
