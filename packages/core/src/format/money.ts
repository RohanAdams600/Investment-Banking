/**
 * Money formatting.
 *
 * Amounts move through the system as integer **cents**, never as floats. A
 * commission of 1.5% on a $4,750,000 close price is not something to compute in
 * binary floating point and then round at display time — the ledger and the
 * screen have to agree exactly, and that is only reliable in integers.
 */

export type Cents = number;

export interface FormatMoneyOptions {
  /** ISO 4217. Only USD ships in v1, but the seam is here for international. */
  currency?: string;
  locale?: string;
  /** Drop cents when the amount is whole — the usual choice for deal figures. */
  compactCents?: boolean;
}

export function formatMoney(
  cents: Cents,
  { currency = 'USD', locale = 'en-US', compactCents = true }: FormatMoneyOptions = {},
): string {
  assertSafeCents(cents);

  const showFraction = !compactCents || cents % 100 !== 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showFraction ? 2 : 0,
    maximumFractionDigits: showFraction ? 2 : 0,
  }).format(cents / 100);
}

/**
 * Abbreviated form for dashboard tiles and listing cards: `$4.8M`, `$750K`.
 * Ranges in listing teasers use this; exact figures never do.
 */
export function formatMoneyCompact(
  cents: Cents,
  { currency = 'USD', locale = 'en-US' }: Omit<FormatMoneyOptions, 'compactCents'> = {},
): string {
  assertSafeCents(cents);

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
    // Without this, a round figure renders as "$750.0K" — the trailing zero
    // reads as false precision on a teaser card.
    trailingZeroDisplay: 'stripIfInteger',
  }).format(cents / 100);
}

/** `"$4,750,000.50"` / `"4750000.5"` -> `475000050`. Throws on unparseable input. */
export function parseMoneyToCents(input: string): Cents {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    throw new Error(`Cannot parse "${input}" as a monetary amount.`);
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot parse "${input}" as a monetary amount.`);
  }

  // Round rather than truncate: 0.1 + 0.2 style drift would otherwise lose a cent.
  return Math.round(value * 100);
}

function assertSafeCents(cents: Cents): void {
  if (!Number.isInteger(cents)) {
    throw new Error(`Monetary amounts must be integer cents, received ${cents}.`);
  }
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Monetary amount ${cents} exceeds the safe integer range.`);
  }
}
