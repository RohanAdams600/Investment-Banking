import { formatMoneyCompact } from '@ib/core';
import { Card, CardContent, ColumnChart, StatTile, percentChange, type ChartPoint } from '@ib/ui';

import type { ListingFinancialYear } from './types';

/**
 * How the business a buyer is looking at has actually performed.
 *
 * Sits inside the confidential profile, so it is only ever rendered to somebody
 * holding an executed NDA — this adds a picture of figures they can already
 * read as a table, and no new data.
 *
 * ## Two charts rather than one with two axes
 *
 * Revenue and earnings are different scales: a business at $3.4m of revenue and
 * $740k of earnings plotted on one axis makes the earnings line a flat smear
 * against the bottom, and giving each its own axis lets the drawing imply a
 * crossover that is an artefact of where the two scales were pinned. Two
 * charts, one axis each, sharing an x-axis of years.
 *
 * ## It reports and does not judge
 *
 * No "strong growth", no "healthy margin", no rating. These are the seller's
 * own reported figures, unaudited, and the platform has not checked them — the
 * caption says exactly that. A buyer decides what the numbers mean; anything
 * else would be this product forming a view on a specific business at a
 * specific price, which it does not do.
 */
export function PerformanceCharts({ financials }: { financials: ListingFinancialYear[] }) {
  if (financials.length === 0) return null;

  // Oldest first: a trend read left to right is the one people expect, and the
  // query returns newest first for the table above.
  const years = [...financials].sort((a, b) => a.fiscalYear - b.fiscalYear);

  const revenue: ChartPoint[] = years.map((year) => ({
    label: String(year.fiscalYear),
    caption: `Fiscal year ${year.fiscalYear}`,
    value: year.revenueCents,
  }));

  /*
   * Earnings, from whichever measure the seller reported.
   *
   * SDE and EBITDA are not the same figure — SDE adds back one owner's
   * compensation — so mixing them across years would draw a step that is a
   * change of definition rather than a change in the business. Preferring one
   * consistently, and naming which, is the honest way to plot it.
   */
  const basis = years.some((year) => year.ebitdaCents !== null) ? 'ebitda' : 'sde';
  const earnings: ChartPoint[] = years.flatMap((year) => {
    const value = basis === 'ebitda' ? year.ebitdaCents : year.sdeCents;
    // A year the seller left blank is dropped rather than drawn as zero. A
    // zero column reads as "they earned nothing", which is a different claim
    // from "they did not report it".
    if (value === null) return [];
    return [
      {
        label: String(year.fiscalYear),
        caption: `Fiscal year ${year.fiscalYear}`,
        value,
      },
    ];
  });

  const latest = years[years.length - 1];
  const previous = years.length > 1 ? years[years.length - 2] : null;

  const latestEarnings = latest
    ? basis === 'ebitda'
      ? latest.ebitdaCents
      : latest.sdeCents
    : null;

  const margin =
    latest && latestEarnings !== null && latest.revenueCents > 0
      ? (latestEarnings / latest.revenueCents) * 100
      : null;

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div className="space-y-1">
          <h3 className="font-display text-base font-semibold">Performance</h3>
          <p className="text-text-muted max-w-prose text-xs leading-relaxed">
            Figures the seller reported, by fiscal year. They have not been audited or verified by
            this platform — treat them as the starting point for diligence rather than as findings.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label={`Revenue, FY${latest?.fiscalYear ?? ''}`}
            value={latest ? formatMoneyCompact(latest.revenueCents) : '—'}
            delta={
              latest && previous ? percentChange(latest.revenueCents, previous.revenueCents) : null
            }
            deltaLabel="year on year"
          />
          <StatTile
            label={`${basis === 'ebitda' ? 'EBITDA' : 'SDE'}, FY${latest?.fiscalYear ?? ''}`}
            value={latestEarnings !== null ? formatMoneyCompact(latestEarnings) : '—'}
            hint={
              basis === 'sde'
                ? 'Seller’s discretionary earnings — adds back one owner’s compensation.'
                : 'Earnings before interest, tax, depreciation and amortisation.'
            }
          />
          <StatTile
            label="Margin"
            value={margin === null ? '—' : `${margin.toFixed(1)}%`}
            hint={`${basis === 'ebitda' ? 'EBITDA' : 'SDE'} as a share of revenue.`}
          />
        </div>

        <ColumnChart
          points={revenue}
          title="Revenue by year"
          unit="revenue"
          format={formatMoneyCompact}
        />

        {earnings.length > 0 ? (
          <div className="border-border-subtle border-t pt-6">
            <ColumnChart
              points={earnings}
              title={`${basis === 'ebitda' ? 'EBITDA' : 'SDE'} by year`}
              description={
                basis === 'ebitda'
                  ? 'Plotted separately from revenue: the two are different scales, and one axis would flatten this to nothing.'
                  : 'Seller’s discretionary earnings. Not comparable to an EBITDA figure without adjustment.'
              }
              unit="earnings"
              format={formatMoneyCompact}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
