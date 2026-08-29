import { BarChart, Card, CardContent, ColumnChart, StatTile, percentChange } from '@ib/ui';

import type { ListingAnalytics } from './queries';

/**
 * How a listing is doing, for the person whose business it is.
 *
 * Four tiles and two charts, in that order, because the tiles answer the
 * question somebody opened the page with — is anything happening — and the
 * charts answer the one they ask next.
 *
 * ## The tiles are honest about a zero baseline
 *
 * Week-over-week is null in the first fortnight, and `StatTile` renders nothing
 * rather than an invented percentage. On a platform where every listing starts
 * at zero views that is not an edge case, it is the first thing every seller
 * sees.
 *
 * ## What it does not report
 *
 * No unique visitors, no returning visitors, no geography, no identities. The
 * table this reads has three columns and none of them is a person — see
 * `queries.ts`. A seller asking "who looked" is asking something this platform
 * deliberately cannot answer, and the note under the chart says so rather than
 * leaving them to assume the feature is merely missing.
 */
export function ListingAnalytics({ analytics }: { analytics: ListingAnalytics }) {
  const weekOnWeek = percentChange(analytics.views7, analytics.viewsPrevious7);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Views, last 30 days"
          value={analytics.views30}
          hint="Page views of your public teaser."
        />
        <StatTile
          label="Views, last 7 days"
          value={analytics.views7}
          delta={weekOnWeek}
          deltaLabel="vs the previous 7 days"
        />
        <StatTile
          label="Access requests"
          value={analytics.requestsTotal}
          hint={
            analytics.requestsOpen > 0
              ? `${analytics.requestsOpen} waiting on you.`
              : 'None waiting on you.'
          }
        />
        <StatTile
          label="Agreements in force"
          value={analytics.ndasActive}
          hint="Buyers who can currently see your financials."
        />
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          <ColumnChart
            points={analytics.viewsByDay}
            title="Views a day"
            description="Page views of your teaser, counted per day. No visitor is identified — this platform stores no record of who looked, only how many times."
            unit="views"
          />

          <div className="border-border-subtle border-t pt-6">
            <ColumnChart
              points={analytics.requestsByWeek}
              title="Access requests a week"
              description="Buyers asking to see the confidential half. Grouped by week because requests arrive in ones and twos, and a daily chart of that reads as nothing happening."
              unit="requests"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Re-exported so a page importing the analytics does not also have to know
 * where the shared chart primitives live.
 */
export { BarChart };
