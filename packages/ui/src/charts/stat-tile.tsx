import { cn } from '../lib/cn';

import { compact } from './scale';

/**
 * One number, and what it is.
 *
 * A single value is not a chart. A one-bar bar chart is the classic way to spend
 * a hundred pixels saying "4", and this is the form that says it in twenty.
 *
 * ## The delta is signed against a named period, or absent
 *
 * A percentage with no baseline named is unreadable — "+50%" against what? So
 * `deltaLabel` is required whenever `delta` is given, and a null delta renders
 * nothing rather than "—" or "0%". On this platform the first week always
 * starts from zero, where a percentage does not exist; `percentChange` returns
 * null there and this renders no delta at all rather than an invented one.
 *
 * ## Direction is not the same as good
 *
 * More views is good. More days on the market is not. `higherIsBetter` decides
 * the colour, and the arrow always follows the number's actual direction — so
 * a red rise stays visibly a rise. Colour is never the only signal: the arrow
 * character carries it for anyone who cannot separate the hues.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  higherIsBetter = true,
  hint,
  className,
}: {
  label: string;
  value: number | string;
  /** A signed percentage. Null or undefined renders nothing. */
  delta?: number | null;
  /** The period compared against — "vs the previous 7 days". */
  deltaLabel?: string;
  higherIsBetter?: boolean;
  hint?: string;
  className?: string;
}) {
  const shown = typeof value === 'number' ? compact(value) : value;
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta) && delta !== 0;
  const rising = hasDelta && delta > 0;
  const good = hasDelta && (higherIsBetter ? rising : !rising);

  return (
    <div className={cn('border-border-subtle space-y-1 rounded-md border p-4', className)}>
      <p className="text-text-muted text-xs">{label}</p>

      {/* Sans, semibold, tabular. Never the display serif — a figure set in a
          serif reads as decoration rather than as a measurement. */}
      <p className="text-text-primary text-2xl font-semibold tabular-nums">{shown}</p>

      {hasDelta && deltaLabel ? (
        <p className={cn('text-xs', good ? 'text-success' : 'text-warning')}>
          <span aria-hidden>{rising ? '↑' : '↓'}</span>{' '}
          <span className="tabular-nums">{Math.abs(delta).toFixed(0)}%</span>{' '}
          <span className="text-text-muted">{deltaLabel}</span>
        </p>
      ) : null}

      {hint ? <p className="text-text-muted text-xs leading-relaxed">{hint}</p> : null}
    </div>
  );
}
