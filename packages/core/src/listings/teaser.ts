import { formatMoneyCompact, type Cents } from '../format/money';

/**
 * Presenting the anonymised teaser.
 *
 * The rule these helpers exist to hold: **a teaser never shows an exact
 * figure.** Industry plus state plus a precise revenue number identifies most
 * lower-middle-market businesses on its own, and a seller whose business is
 * identifiable before they chose to disclose it can lose staff, customers, and
 * the sale. Bands are not a rounding convenience; they are the disclosure
 * boundary, and the schema enforces the same split by keeping exact figures in
 * a separate, NDA-gated table.
 */

export interface Band {
  lowCents: Cents | null;
  highCents: Cents | null;
}

/**
 * `$1.5M – $2.5M`, `Under $500K`, `$5M+`, or an explicit "not disclosed".
 *
 * Never returns an empty string: a blank cell reads as a rendering fault, while
 * "Not disclosed" is information — plenty of sellers deliberately withhold the
 * asking price, and that is worth showing as a choice rather than a gap.
 */
export function formatBand({ lowCents, highCents }: Band, notDisclosed = 'Not disclosed'): string {
  if (lowCents === null && highCents === null) return notDisclosed;
  if (lowCents === null) return `Under ${formatMoneyCompact(highCents as Cents)}`;
  if (highCents === null) return `${formatMoneyCompact(lowCents)}+`;
  if (lowCents === highCents) return formatMoneyCompact(lowCents);

  // An en dash, not a hyphen: this is a range, and the typography says so.
  return `${formatMoneyCompact(lowCents)} – ${formatMoneyCompact(highCents)}`;
}

/**
 * Rounds an exact figure outwards into a band a teaser can carry.
 *
 * Used when a seller enters real numbers on the full profile and has not set
 * the public bands themselves — the derived band is deliberately wide, and
 * always rounds *outwards*, because a band that brackets the true figure too
 * tightly discloses it.
 */
export function deriveBand(exactCents: Cents | null, spread = 0.2): Band {
  if (exactCents === null || exactCents <= 0) return { lowCents: null, highCents: null };

  const step = bandStepFor(exactCents);
  const low = Math.floor((exactCents * (1 - spread)) / step) * step;
  const high = Math.ceil((exactCents * (1 + spread)) / step) * step;

  return { lowCents: Math.max(low, 0), highCents: high };
}

/**
 * The rounding granularity, in cents, for a figure of this size.
 *
 * Fixed steps rather than significant figures, so two businesses of similar
 * size land in the same band instead of in two adjacent bands that, compared,
 * narrow both.
 */
function bandStepFor(cents: Cents): number {
  const dollars = cents / 100;
  if (dollars < 500_000) return 50_000 * 100;
  if (dollars < 2_000_000) return 100_000 * 100;
  if (dollars < 10_000_000) return 250_000 * 100;
  if (dollars < 50_000_000) return 1_000_000 * 100;
  return 5_000_000 * 100;
}

export const GROWTH_TREND_LABELS = {
  declining: 'Declining',
  flat: 'Flat',
  growing: 'Growing',
  rapid: 'Rapid growth',
} as const;

export const OWNER_DEPENDENCE_LABELS = {
  absentee: 'Absentee owner',
  moderate: 'Moderately owner-involved',
  critical: 'Owner-critical',
} as const;

export const DEAL_STRUCTURE_LABELS = {
  asset: 'Asset sale',
  stock: 'Stock sale',
} as const;

export const NDA_STATUS_LABELS = {
  none: 'Not requested',
  requested: 'Requested',
  sent: 'Awaiting your signature',
  signed: 'Signed',
  revoked: 'Revoked',
  expired: 'Expired',
} as const;
