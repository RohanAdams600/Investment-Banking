import { describe, expect, it } from 'vitest';

import { colorRoles } from './semantic';

/**
 * Text has to be readable, and "looks fine to me" is not a measurement.
 *
 * This file exists because of a real regression. Moving from a cool grey ramp to
 * a warm limestone one is mostly an aesthetic change, but a warm neutral is
 * lighter at every step than its blue-grey equivalent — so a one-for-one swap
 * carried `text-muted` from 4.3:1 to 2.54:1 against the page ground. It looked
 * correct in a screenshot. It was a WCAG AA failure on exactly the labels,
 * captions and timestamps that are hardest to read already.
 *
 * Nothing here claims the product is accessible; that is a much larger question
 * involving focus order, labels and screen readers. It claims one thing that can
 * be checked arithmetically, and checks it on every build.
 */

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_BODY = 4.5;
/** Large text and non-text UI components; 3:1 under WCAG 1.4.3 and 1.4.11. */
const AA_LARGE = 3;

type Theme = 'light' | 'dark';
const role = (name: keyof typeof colorRoles, theme: Theme) => colorRoles[name][theme];

describe.each<Theme>(['light', 'dark'])('contrast in %s', (theme) => {
  const canvas = role('canvas', theme);
  const surface = role('surface', theme);

  it.each([
    ['text-primary', AA_BODY],
    ['text-secondary', AA_BODY],
    ['text-muted', AA_BODY],
  ] as const)('%s is legible on both grounds', (name, threshold) => {
    // Two grounds, because a card sits on the canvas and text sits on the card.
    expect(contrast(role(name, theme), canvas)).toBeGreaterThanOrEqual(threshold);
    expect(contrast(role(name, theme), surface)).toBeGreaterThanOrEqual(threshold);
  });

  it('draws chart marks that clear the non-text threshold on a card', () => {
    /*
     * The check that forced `chart-mark` to be a different step per theme.
     *
     * A bar is a non-text UI component, so 3:1 under WCAG 1.4.11, and it is
     * judged against the card it sits on rather than the page. Copper 500
     * reaches 4.25:1 on white and only 2.78:1 on the dark card; copper 400 is
     * the reverse. Reusing one value across both themes — the obvious thing to
     * do, and what `accent` does — would ship an unreadable chart in one of
     * them, and it would look fine in whichever theme the author had open.
     */
    expect(contrast(role('chart-mark', theme), surface)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('separates the two chart series enough for a full-colour reader', () => {
    /*
     * The check that forced the second series to be ink rather than a second
     * warm hue. Copper against stone measured ΔE 11.7 in light and 14.5 in
     * dark, against a floor of 15 — two lines a sighted reader cannot reliably
     * tell apart, which no legend or dashed stroke excuses.
     *
     * Approximated here by WCAG luminance distance rather than OKLab ΔE,
     * because this file already carries luminance and a second colour space for
     * one assertion is a maintenance cost.
     *
     * The threshold is a proxy and is calibrated rather than guessed: the pair
     * measures ΔE 34.7 in light and 30.1 in dark against the validator's floor
     * of 15, and 0.18 / 0.59 by this measure. 0.15 sits below both with room,
     * so it catches a step change that would collapse the pair without failing
     * on the values that were actually verified.
     */
    const mark = luminance(role('chart-mark', theme));
    const context = luminance(role('chart-context', theme));
    expect(Math.abs(mark - context)).toBeGreaterThan(0.15);
  });

  it('draws the supporting series legibly on a card too', () => {
    expect(contrast(role('chart-context', theme), surface)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('keeps gridlines recessive without making them invisible', () => {
    /*
     * The opposite failure. Gridlines are not data and must not compete with
     * it, but a rule nobody can see is a rule that is not doing its job — the
     * eye needs it to read a value off the axis.
     *
     * Deliberately a band rather than a floor: too high is as wrong as too low
     * here, and only a range says so.
     */
    const ratio = contrast(role('chart-grid', theme), surface);
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(2.5);
  });

  it('keeps the chart mark clearly ahead of its own context tone', () => {
    // A sparkline draws earlier periods in `chart-mark-soft` and the current one
    // in `chart-mark`. If those two are close, the emphasis does nothing.
    const mark = luminance(role('chart-mark', theme));
    const soft = luminance(role('chart-mark-soft', theme));
    expect(Math.abs(mark - soft)).toBeGreaterThan(0.05);
  });

  it('keeps the three text levels visibly distinct', () => {
    /*
     * Fixing a contrast failure by darkening everything to near-black passes the
     * arithmetic and destroys the hierarchy. Each level must be meaningfully
     * lighter than the one above it.
     */
    const primary = luminance(role('text-primary', theme));
    const secondary = luminance(role('text-secondary', theme));
    const muted = luminance(role('text-muted', theme));

    const order = theme === 'light' ? [primary, secondary, muted] : [muted, secondary, primary];
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it('has a readable accent', () => {
    // The accent carries eyebrows and section labels, which are text.
    expect(contrast(role('accent', theme), canvas)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('has a primary button whose label can be read', () => {
    expect(contrast(role('primary-fg', theme), role('primary', theme))).toBeGreaterThanOrEqual(
      AA_BODY,
    );
  });

  it('has a visible focus ring', () => {
    // A ring nobody can see is not a focus indicator. 3:1 is the non-text bar.
    expect(contrast(role('ring', theme), canvas)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrast(role('ring', theme), surface)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('has borders that separate one surface from another', () => {
    // Not 4.5 — a hairline is decoration, not information. But a border nobody
    // can see is a card that reads as floating text.
    expect(contrast(role('border-default', theme), surface)).toBeGreaterThanOrEqual(1.4);
  });

  it.each(['success', 'warning', 'danger', 'info'] as const)(
    '%s status colour is readable as text',
    (name) => {
      expect(contrast(role(name, theme), canvas)).toBeGreaterThanOrEqual(AA_LARGE);
    },
  );
});
