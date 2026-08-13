import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import { can } from '@ib/core';
import { AIDisclaimer, Button, EmptyState } from '@ib/ui';

import { MatchCard } from '@/features/matching/match-card';
import { countExcludedMatches, listMatches } from '@/features/matching/queries';
import { RefreshMatchesButton } from '@/features/matching/refresh-button';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Matches',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  // Matching is for the buy side. Sellers see demand for their own listing on
  // its manage page instead, as counts.
  if (!can(actor, 'listing:view_full')) redirect('/listings');

  const params = await searchParams;
  const showFiltered = params.filtered === '1';

  const [matches, excludedCount] = await Promise.all([
    listMatches(showFiltered),
    countExcludedMatches(),
  ]);

  const visible = showFiltered ? matches : matches.filter((m) => !m.excluded);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Matches</h1>
          <p className="text-text-muted text-sm">
            Listings ranked against the criteria you saved, best first.
          </p>
        </div>
        <RefreshMatchesButton />
      </header>

      <AIDisclaimer variant="match">
        These particular scores are calculated, not inferred — a fixed weighting of industry, size,
        geography, structure and quality, with the reasoning shown on every result. They rank fit
        for your review and are not a valuation or a recommendation to buy any business at any
        price.
      </AIDisclaimer>

      {visible.length === 0 ? (
        <EmptyState
          icon={Target}
          title={excludedCount > 0 ? 'Everything was filtered out' : 'No matches yet'}
          description={
            excludedCount > 0
              ? `${excludedCount} ${excludedCount === 1 ? 'listing' : 'listings'} scored but fell outside limits you set. Widening them may surface something.`
              : 'Set your acquisition criteria, then refresh. New listings are scored as they come to market.'
          }
          action={
            <Button asChild size="sm">
              <Link href={excludedCount > 0 ? '/matches?filtered=1' : '/tools/buyer-criteria'}>
                {excludedCount > 0 ? 'Show what was filtered out' : 'Set your criteria'}
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-text-muted text-sm" aria-live="polite">
              {visible.length} {visible.length === 1 ? 'match' : 'matches'}
            </p>

            {excludedCount > 0 ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={showFiltered ? '/matches' : '/matches?filtered=1'}>
                  {showFiltered
                    ? 'Hide filtered out'
                    : `Show ${excludedCount} filtered out by your limits`}
                </Link>
              </Button>
            ) : null}
          </div>

          <ul className="space-y-3">
            {visible.map((match) => (
              <li key={match.teaser.id}>
                <MatchCard match={match} />
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-text-muted text-sm">
        Scores use figures sellers have not published. You see the ranking and the reasoning; the
        underlying numbers stay confidential until a seller issues you an NDA.{' '}
        <Link href="/tools/buyer-criteria" className="underline underline-offset-4">
          Adjust your criteria
        </Link>
        .
      </p>
    </main>
  );
}
