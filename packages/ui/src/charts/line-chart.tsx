import { cn } from '../lib/cn';

import { ChartTable, type ChartPoint } from './column-chart';
import { axisFor, compact } from './scale';

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
  /**
   * `mark` is the series the reader is meant to follow; `context` supports it.
   *
   * Two roles rather than a list of colours, because this palette cannot carry
   * two categorical hues — it is warm and near-achromatic by design, and two
   * hues drawn from it measure below the separation floor a full-colour reader
   * needs. So a two-series chart here is emphasis, not category: one accent,
   * one neutral. See the `chart-context` token for the measurements.
   */
  role: 'mark' | 'context';
}

/**
 * Change over time, as a line.
 *
 * ## When this rather than columns
 *
 * Columns say "separate tallies"; a line says "one thing moving". Use it when
 * the reader's question is about direction and rate — is this growing, and is
 * it growing faster than that — rather than about the size of each period.
 *
 * ## Two series on one axis is only honest if they share units
 *
 * A revenue line and an earnings line on one axis flattens the smaller one; on
 * two axes it invents a crossover wherever the scales were pinned. The only
 * legitimate way to compare them in one frame is to index both to a common
 * base, which is what the caller does before handing them here — every series
 * arrives already on the same scale, and this component does not rescale
 * anything.
 */
export function LineChart({
  series,
  title,
  description,
  unit = '',
  format = compact,
  baseline,
  className,
}: {
  series: ChartSeries[];
  title: string;
  description?: string;
  unit?: string;
  format?: (value: number) => string;
  /** A reference line — 100 on an indexed chart, say. Drawn behind the data. */
  baseline?: number;
  className?: string;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  const max = all.reduce((highest, value) => Math.max(highest, value), 0);
  const { ceiling, ticks } = axisFor(max);

  const longest = series.reduce((most, s) => Math.max(most, s.points.length), 0);

  const WIDTH = 720;
  const HEIGHT = 210;
  const PAD = { top: 14, right: 56, bottom: 24, left: 44 };

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    longest <= 1 ? PAD.left + plotW / 2 : PAD.left + (index / (longest - 1)) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / ceiling) * plotH;

  const labels = series[0]?.points ?? [];
  const labelEvery = Math.max(1, Math.ceil(labels.length / 6));

  if (all.length === 0) {
    return (
      <figure className={cn('space-y-3', className)}>
        <Caption title={title} description={description} />
        <div className="border-chart-grid text-text-muted flex h-[120px] items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
          Not enough history to draw a trend yet.
        </div>
      </figure>
    );
  }

  return (
    <figure className={cn('space-y-3', className)}>
      <Caption title={title} description={description} />

      {/*
        A legend, always, for two or more series. Identity never rests on colour
        alone: the swatch sits beside a name, and each line is labelled at its
        end as well.
      */}
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-block h-0.5 w-4 rounded-full',
                  s.role === 'mark' ? 'bg-chart-mark' : 'bg-chart-context',
                )}
                aria-hidden
              />
              <span className="text-text-secondary text-xs">{s.name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`${title}. ${series
          .map((s) => `${s.name} from ${format(s.points[0]?.value ?? 0)} to ${format(s.points[s.points.length - 1]?.value ?? 0)}`)
          .join('; ')}. The figures are in the table below.`}
        className="overflow-visible"
      >
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
              {format(tick)}
            </text>
          </g>
        ))}

        {/* The reference line, drawn before the data so it never sits on top. */}
        {baseline !== undefined && baseline <= ceiling ? (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(baseline)}
            y2={y(baseline)}
            className="stroke-text-muted"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        ) : null}

        {series.map((s) => {
          const stroke = s.role === 'mark' ? 'stroke-chart-mark' : 'stroke-chart-context';
          const fill = s.role === 'mark' ? 'fill-chart-mark' : 'fill-chart-context';
          const path = s.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`)
            .join(' ');
          const last = s.points[s.points.length - 1];

          return (
            <g key={s.name}>
              <path d={path} className={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

              {s.points.map((point, index) => (
                <circle
                  key={`${point.label}-${index}`}
                  cx={x(index)}
                  cy={y(point.value)}
                  r={4}
                  className={fill}
                  /* A ring in the surface colour, so a marker stays legible
                     where two lines cross. Part of the hit target too. */
                  stroke="rgb(var(--color-surface))"
                  strokeWidth={2}
                >
                  <title>{`${s.name} — ${point.caption ?? point.label}: ${format(point.value)} ${unit}`}</title>
                </circle>
              ))}

              {/* Labelled at the end rather than at every point. */}
              {last ? (
                <text
                  x={x(s.points.length - 1) + 8}
                  y={y(last.value) + 3}
                  className="fill-text-secondary text-[9px] font-medium tabular-nums"
                >
                  {format(last.value)}
                </text>
              ) : null}
            </g>
          );
        })}

        {labels.map((point, index) =>
          index % labelEvery === 0 ? (
            <text
              key={`${point.label}-${index}`}
              x={x(index)}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-text-muted text-[9px]"
            >
              {point.label}
            </text>
          ) : null,
        )}

        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="stroke-chart-grid"
          strokeWidth={1}
        />
      </svg>

      {series.map((s) => (
        <div key={s.name}>
          {series.length > 1 ? (
            <p className="text-text-muted mb-1 text-xs font-medium">{s.name}</p>
          ) : null}
          <ChartTable points={s.points} unit={unit || 'value'} format={format} />
        </div>
      ))}
    </figure>
  );
}

function Caption({ title, description }: { title: string; description?: string }) {
  return (
    <figcaption className="space-y-1">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {description ? <p className="text-text-muted text-xs">{description}</p> : null}
    </figcaption>
  );
}
