import 'server-only';

import type { ChartPoint } from '@ib/ui';

import { createClient } from '@/lib/supabase/server';

/**
 * The numbers a seller manages by.
 *
 * ## Nothing here is a new permission
 *
 * Every figure is aggregated from rows the caller could already read:
 * `listing_view_days` is readable only by whoever controls the listing, and
 * `listing_ndas` admits the seller to requests on their own listing and a buyer
 * to their own. So a buyer calling any of this gets their own sliver rather
 * than an error, and there is no privileged client anywhere in the file.
 *
 * That is why there is no migration behind this feature. An analytics endpoint
 * that needed one would be an endpoint deciding for itself who may see what.
 *
 * ## What is deliberately not counted
 *
 * Nothing identifies a viewer. `listing_view_days` has three columns and none
 * of them is a person — no unique visitors, no returning visitors, no
 * geography. Browsing a marketplace of confidential deals should not create a
 * record of who looked, and a page-view tally is the weaker measure that
 * respects that.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface ListingAnalytics {
  /** One point per day for the last 30 days, including days with no views. */
  viewsByDay: ChartPoint[];
  /** Access requests per week over the last 8 weeks. */
  requestsByWeek: ChartPoint[];
  views30: number;
  views7: number;
  viewsPrevious7: number;
  requestsTotal: number;
  requestsOpen: number;
  ndasActive: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-08-29`, in UTC, matching how `listing_view_days.day` is stored. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function listingAnalytics(listingId: string): Promise<ListingAnalytics> {
  const supabase = await createClient();

  const since = new Date(Date.now() - 29 * DAY_MS);

  const [viewRows, ndaRows] = await Promise.all([
    supabase
      .from('listing_view_days')
      .select('day, views')
      .eq('listing_id', listingId)
      .gte('day', isoDay(since))
      .order('day', { ascending: true }),
    supabase
      .from('listing_ndas')
      .select('status, requested_at, expires_at, revoked_at')
      .eq('listing_id', listingId)
      .order('requested_at', { ascending: true }),
  ]);

  const tally = new Map<string, number>();
  for (const row of (viewRows.data ?? []) as Row[]) {
    tally.set(row.day as string, Number(row.views ?? 0));
  }

  /*
   * Every day in the window, not only the days with rows.
   *
   * The table stores nothing for a day nobody looked, so plotting the rows as
   * they come back silently closes the gaps and turns three views spread over a
   * fortnight into three consecutive busy days. The absence is the information.
   */
  const viewsByDay: ChartPoint[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * DAY_MS);
    const key = isoDay(date);
    viewsByDay.push({
      label: date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      caption: date.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
      value: tally.get(key) ?? 0,
    });
  }

  const sum = (points: ChartPoint[]) => points.reduce((total, point) => total + point.value, 0);

  const ndas = (ndaRows.data ?? []) as Row[];
  const now = Date.now();

  const requestsByWeek = weeklyBuckets(
    ndas.map((row) => new Date(row.requested_at as string)),
    8,
  );

  return {
    viewsByDay,
    requestsByWeek,
    views30: sum(viewsByDay),
    views7: sum(viewsByDay.slice(-7)),
    viewsPrevious7: sum(viewsByDay.slice(-14, -7)),
    requestsTotal: ndas.length,
    requestsOpen: ndas.filter((row) => row.status === 'requested').length,
    ndasActive: ndas.filter(
      (row) =>
        row.status === 'signed' &&
        !row.revoked_at &&
        (!row.expires_at || new Date(row.expires_at as string).getTime() > now),
    ).length,
  };
}

/**
 * Dates into the last `count` weekly buckets, oldest first.
 *
 * Weeks rather than days because access requests arrive in ones and twos: a
 * daily chart of a number that is almost always zero is thirty pixels of
 * nothing with an occasional spike, which reads as "no activity" when the truth
 * is "steady activity, thinly spread".
 */
export function weeklyBuckets(dates: Date[], count: number): ChartPoint[] {
  const buckets: ChartPoint[] = [];
  const now = Date.now();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const end = now - offset * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    const startDate = new Date(start);

    buckets.push({
      label: startDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      caption: `Week of ${startDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`,
      value: dates.filter((date) => {
        const time = date.getTime();
        return time > start && time <= end;
      }).length,
    });
  }

  return buckets;
}
