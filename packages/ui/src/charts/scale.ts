/**
 * The arithmetic behind the charts, kept out of the components.
 *
 * Axis rounding and value compaction are the two things in a chart that are
 * quietly wrong far more often than the drawing is, and they are pure functions
 * — so they are separated here and tested directly rather than inferred from a
 * screenshot.
 */

/**
 * The axis: a ceiling and the ticks up to it.
 *
 * Returned together because they are one decision. Computing a ceiling and then
 * dividing it into a fixed number of ticks — the obvious split, and what this
 * did first — produces axes labelled 0, 17, 33, 50: a ceiling that is round and
 * gridlines that are not, which is worse than either alone, because a reader
 * cannot place a bar against 17 without doing arithmetic. It looked fine until
 * it was rendered and read.
 *
 * So the *step* is chosen first, from the 1/2/5 ladder people read without
 * thinking, and the ceiling is whatever multiple of that step clears the data.
 * Every tick is then round by construction.
 *
 * Four intervals is the target. Fewer makes a reader interpolate across a wide
 * gap; more turns the plot into a grid with some bars in it.
 */
export interface Axis {
  ceiling: number;
  ticks: number[];
}

export function axisFor(max: number, intervals = 4): Axis {
  /*
   * An empty chart still needs a height to divide by, and this product launches
   * into exactly that state — every listing starts at zero views. A zero
   * ceiling would make every bar 0/0.
   */
  if (!Number.isFinite(max) || max <= 0) return { ceiling: 1, ticks: [0, 1] };

  let step = niceStep(max / intervals);

  /*
   * Counts do not have halves.
   *
   * Every chart in this product plots a tally — views, requests, listings — and
   * an axis reading 0 / 0.5 / 1 invites the reader to wonder what half a view
   * is. When the data is whole, the gridlines are too.
   */
  if (Number.isInteger(max)) step = Math.max(1, Math.round(step));

  const ceiling = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // The epsilon guards binary floating point: a step of 0.1 accumulates error
  // and would otherwise drop the final tick about half the time.
  for (let value = 0; value <= ceiling + step / 1000; value += step) {
    ticks.push(round(value));
  }

  return { ceiling, ticks };
}

/** The nearest 1, 2 or 5 scaled by a power of ten, at or above `raw`. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Kills the floating-point tail, so a tick is 0.3 and not 0.30000000000000004. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * A number as a reader wants it.
 *
 * Thousands-separated below ten thousand, compacted above. The threshold is
 * where the digits stop being read individually and start being read as a
 * magnitude — "12.9K" is faster than "12,904" for a headline, and slower for a
 * count somebody has to reconcile against something else.
 */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';

  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);

  if (magnitude < 10_000) return sign + Math.round(magnitude).toLocaleString('en-US');
  if (magnitude < 1_000_000) return `${sign}${trim(magnitude / 1_000)}K`;
  if (magnitude < 1_000_000_000) return `${sign}${trim(magnitude / 1_000_000)}M`;
  return `${sign}${trim(magnitude / 1_000_000_000)}B`;
}

/** One decimal, but never a trailing ".0" — "12K", not "12.0K". */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A change between two periods, as a signed percentage.
 *
 * Returns null when the previous period was zero. The alternative is reporting
 * an infinite rise, or silently substituting 100%, and both of those are a
 * chart telling somebody something that is not true — going from no views to
 * four views is not a percentage, it is "four".
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
