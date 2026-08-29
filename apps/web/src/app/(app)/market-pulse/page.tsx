import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can, formatMoneyCompact } from '@ib/core';
import { BarChart, Card, CardContent, ColumnChart, StatTile, percentChange } from '@ib/ui';

import { marketTrends } from '@/features/analytics/market';
import { browseListings } from '@/features/listings/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Market pulse',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * What the market is doing, for a buyer.
 *
 * ## The thing this page refuses to show
 *
 * A "trending businesses" list ranked by views. That is the obvious build, and
 * it would require reading `listing_view_days` for listings the caller does not
 * control — a table whose policy exists specifically to stop that, because a
 * buyer who knows how many people looked at a business negotiates with it. A
 * quiet listing becomes an opening bid, and the seller who chose this platform
 * for its confidentiality never agreed to that.
 *
 * So the page answers the question underneath "what is trending" — where is the
 * activity — at the level of the market rather than the listing: what is coming
 * to market, in which sectors, at what size. Nothing on it is derived from a row
 * the caller could not already read, which is what makes it safe by
 * construction rather than by this file being careful.
 */
export default async function MarketPulsePage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (!can(actor, 'listing:view_teaser')) redirect('/dashboard');

  const page = isSupabaseConfigured() ? await browseListings() : null;
  const trends = marketTrends(page?.rows ?? []);

  const weekOnWeek = percentChange(trends.newThisWeek, trends.newPreviousWeek);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Market pulse</h1>
        <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
          What is coming to market and where. Aggregated across every live listing you can browse —
          no figure here describes an individual business.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Live listings" value={trends.liveTotal} />
        <StatTile
          label="New this week"
          value={trends.newThisWeek}
          delta={weekOnWeek}
          deltaLabel="vs last week"
        />
        <StatTile
          label="Median asking price"
          value={
            trends.medianAskingCents === null
              ? '—'
              : formatMoneyCompact(trends.medianAskingCents)
          }
          hint="Midpoint of each stated range. Informational only — not a valuation of anything."
        />
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          <ColumnChart
            points={trends.newByWeek}
            title="New listings a week"
            description="When businesses came to market over the last twelve weeks."
            unit="listings"
          />

          <div className="border-border-subtle border-t pt-6">
            <BarChart
              points={trends.bySector}
              title="Where the market is"
              description="Live listings by sector. Sectors with nothing in them are left out rather than drawn at zero."
              unit="listings"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-6">
          <h2 className="font-display text-base font-semibold">
            Why there is no popularity ranking
          </h2>
          <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
            You will not find a list of the most-viewed businesses here, and that is deliberate. How
            many people have looked at a listing is visible to its seller and to nobody else — a
            buyer who knew a business had been sitting quietly would negotiate with that, and every
            seller on this marketplace was told their information stays theirs to release.
          </p>
          <p className="text-text-muted max-w-2xl text-sm leading-relaxed">
            The same rule protects you when you sell. Nothing on this page comes from a record you
            could not already read yourself.
          </p>
          <p className="pt-1">
            <Link href="/listings" className="text-accent text-sm underline underline-offset-4">
              Browse the market
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
