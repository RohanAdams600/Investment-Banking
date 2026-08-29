import { cn } from '../lib/cn';

import { axisFor, compact } from './scale';

export interface ChartPoint {
  /** The x-axis category. A date, a week, a sector. */
  label: string;
  value: number;
  /** Fuller text for the tooltip and the table — "Tuesday 12 August". */
  caption?: string;
}

/**
 * Counts over time.
 *
 * ## Why columns rather than a line
 *
 * A line implies a value existed between its points. Daily view counts are
 * separate tallies, and a line drawn through them invites reading "3.5 views on
 * Thursday afternoon" off a slope that means nothing. Columns say discrete.
 *
 * ## Why there is no charting library
 *
 * Everything here is one `<svg>` rendered on the server. A library would add a
 * client component, a hydration boundary and a bundle for what is arithmetic
 * and rectangles — on a page a seller opens to read four numbers.
 *
 * ## The hover layer
 *
 * A `<title>` inside each column. That is a real tooltip: the browser draws it
 * on hover, screen readers announce it, it works before hydration because there
 * is nothing to hydrate, and it cannot drift out of sync with the mark it
 * describes. A custom tooltip would look better and be worse.
 *
 * The `<details>` table underneath is not a fallback — it is the accessible
 * path to the actual numbers, and it is what makes the sub-3:1 cases legible.
 *
 * ## Colour
 *
 * One series, so one hue and no legend — the title says what is plotted. The
 * hue is `chart-mark`, which is a different step of the copper ramp in each
 * theme because no single step clears 3:1 on both surfaces; see the token file.
 * Nothing here colours text with it.
 */
export function ColumnChart({
  points,
  title,
  description,
  unit = 'views',
  className,
}: {
  points: ChartPoint[];
  title: string;
  /** Sits under the title. The place to say what the number does not include. */
  description?: string;
  unit?: string;
  className?: string;
}) {
  const max = points.reduce((highest, point) => Math.max(highest, point.value), 0);
  const { ceiling, ticks } = axisFor(max);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  // User units. Rendered at width="100%", so these are proportions rather than
  // pixels — but the mark specs are in pixels, so the viewBox is sized to make
  // one user unit ≈ one pixel at the width this renders at in a card.
  const WIDTH = 720;
  const HEIGHT = 190;
  const PAD = { top: 12, right: 8, bottom: 22, left: 34 };

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const slot = points.length > 0 ? plotW / points.length : plotW;
  /*
   * The 2px surface gap, and the 24px cap. The cap matters at low counts: seven
   * weekly columns across 680 units would otherwise be 95 units wide each and
   * read as a wall rather than as data.
   */
  const barWidth = Math.min(24, Math.max(1, slot - 2));

  const y = (value: number) => PAD.top + plotH - (value / ceiling) * plotH;

  // The extreme, labelled directly. Never a number on every column.
  const peakIndex = points.reduce(
    (best, point, index) => (point.value > (points[best]?.value ?? -1) ? index : best),
    0,
  );

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure className={cn('space-y-3', className)}>
      <figcaption className="space-y-1">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {description ? <p className="text-text-muted text-xs">{description}</p> : null}
      </figcaption>

      {total === 0 ? (
        /*
         * An empty chart, said in words.
         *
         * Thirty columns of zero height under a full axis reads as a rendering
         * failure, and this product launches into exactly that state. The axis
         * is drawn without the fiction of data on it.
         */
        <div className="border-chart-grid text-text-muted flex h-[120px] items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
          No {unit} recorded yet.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          role="img"
          aria-label={`${title}. ${compact(total)} ${unit} in total across ${points.length} periods. The figures are in the table below.`}
          className="overflow-visible"
        >
          {/* Gridlines: hairline, solid, recessive. Not data. */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-chart-grid"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(tick) + 3}
                textAnchor="end"
                className="fill-text-muted text-[9px] tabular-nums"
              >
                {compact(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const height = Math.max(0, PAD.top + plotH - y(point.value));
            const x = PAD.left + index * slot + (slot - barWidth) / 2;
            const isPeak = index === peakIndex && point.value > 0;

            return (
              <g key={`${point.label}-${index}`}>
                {point.value > 0 ? (
                  <path
                    d={roundedTop(x, y(point.value), barWidth, height, 4)}
                    className="fill-chart-mark"
                  >
                    {/* The hover layer, and the screen-reader text, as one thing. */}
                    <title>{`${point.caption ?? point.label}: ${compact(point.value)} ${unit}`}</title>
                  </path>
                ) : null}

                {isPeak ? (
                  <text
                    x={x + barWidth / 2}
                    y={y(point.value) - 5}
                    textAnchor="middle"
                    className="fill-text-secondary text-[9px] font-medium tabular-nums"
                  >
                    {compact(point.value)}
                  </text>
                ) : null}

                {index % labelEvery === 0 ? (
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    className="fill-text-muted text-[9px]"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* The baseline, drawn last so columns sit on it rather than over it. */}
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            className="stroke-chart-grid"
            strokeWidth={1}
          />
        </svg>
      )}

      <ChartTable points={points} unit={unit} />
    </figure>
  );
}

/**
 * A rectangle with a rounded data-end and a square baseline.
 *
 * Rounding both ends would detach the column from the axis it is measured
 * against. `rx` on a `<rect>` rounds all four, which is why this is a path.
 */
function roundedTop(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ');
}

/**
 * The numbers, for anybody the picture does not serve.
 *
 * Collapsed by default so it does not compete with the chart, and present on
 * every chart rather than offered as an option — a chart whose values are only
 * available by hovering excludes keyboard and touch users from the data.
 */
export function ChartTable({ points, unit }: { points: ChartPoint[]; unit: string }) {
  return (
    <details className="group">
      <summary className="text-text-muted hover:text-text-secondary cursor-pointer text-xs">
        Show the figures
      </summary>
      <div className="mt-2 max-h-56 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Period
              </th>
              <th scope="col" className="py-1 text-right font-medium capitalize">
                {unit}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border-subtle divide-y">
            {points.map((point, index) => (
              <tr key={`${point.label}-${index}`}>
                <td className="text-text-secondary py-1">{point.caption ?? point.label}</td>
                <td className="py-1 text-right tabular-nums">{compact(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
