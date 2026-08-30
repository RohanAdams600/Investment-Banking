import { cn } from '../lib/cn';

import { ChartTable, type ChartPoint } from './column-chart';
import { axisFor, compact } from './scale';

/**
 * Magnitude across named categories, horizontally.
 *
 * Horizontal because the categories here have long names — "Home services
 * (HVAC, plumbing, electrical)" does not fit under a column, and the usual
 * answer, rotating the labels forty-five degrees, makes a reader tilt their
 * head to read their own data.
 *
 * Sorted by value rather than left in taxonomy order: the job is comparison,
 * and a sorted bar chart answers "which is biggest" without the reader scanning.
 *
 * One hue, no legend, and the value at the tip of each bar — the one place a
 * label per mark is right, because there are few marks and each has a free end.
 */
export function BarChart({
  points,
  title,
  description,
  unit = 'listings',
  format = compact,
  className,
}: {
  points: ChartPoint[];
  title: string;
  description?: string;
  unit?: string;
  format?: (value: number) => string;
  className?: string;
}) {
  const ranked = [...points].sort((a, b) => b.value - a.value);
  const { ceiling } = axisFor(ranked.reduce((max, point) => Math.max(max, point.value), 0));
  const total = ranked.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure className={cn('space-y-3', className)}>
      <figcaption className="space-y-1">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {description ? <p className="text-text-muted text-xs">{description}</p> : null}
      </figcaption>

      {total === 0 ? (
        <div className="border-chart-grid text-text-muted flex h-[120px] items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
          Nothing to compare yet.
        </div>
      ) : (
        /*
         * CSS rather than SVG for this one.
         *
         * The bars are a single dimension against a shared maximum, so a grid of
         * divs expresses it exactly — and it brings text wrapping, which is the
         * whole reason this chart is horizontal. Laying long category names out
         * in SVG means measuring text by hand.
         */
        <ul className="space-y-2.5">
          {ranked.map((point) => (
            <li key={point.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
              <span className="text-text-secondary truncate text-xs" title={point.label}>
                {point.label}
              </span>

              {/* The track is the ramp's lightest usable step, so the bar reads
                  as a proportion of something rather than as a floating mark. */}
              <span className="bg-chart-grid/40 relative block h-3 overflow-hidden rounded-sm">
                <span
                  className="bg-chart-mark absolute inset-y-0 left-0 rounded-r-sm"
                  style={{ width: `${Math.max(1.5, (point.value / ceiling) * 100)}%` }}
                  aria-hidden
                />
              </span>

              <span className="text-text-primary w-10 text-right text-xs tabular-nums">
                {format(point.value)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ChartTable points={ranked} unit={unit} format={format} />
    </figure>
  );
}
