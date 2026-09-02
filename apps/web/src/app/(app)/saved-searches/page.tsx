import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BellOff, BellRing, Search } from 'lucide-react';
import {
  INDUSTRY_PROFILES,
  describeSearch,
  formatMoneyCompact,
  pageTitle,
  type IndustryKey,
} from '@ib/core';
import { Card, CardContent } from '@ib/ui';

import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { SearchControls } from '@/features/search/search-controls';
import { listSavedSearches, savedSearchMatches } from '@/features/search/queries';

export const metadata: Metadata = {
  title: pageTitle('Saved searches'),
};

/**
 * Everything a buyer has told the market to watch for.
 *
 * ## Why each one shows its current matches
 *
 * A saved search is a promise about the future, and a page of promises is
 * impossible to evaluate. Showing what each one matches *today* turns it into
 * something checkable: a search returning nothing is either too narrow or
 * genuinely early, and a buyer can tell which by reading the sentence
 * underneath the name. Without this the first sign that a search was mis-set is
 * a month of silence.
 *
 * ## And its filters, in words
 *
 * "Earning $5,000 or more" is obviously a mis-typed field in a way that a form
 * showing `500000` in a cents column is not. The sentence is the cheapest bug
 * report this feature will ever get.
 */
export default async function SavedSearchesPage() {
  /*
   * The page gates itself. `(app)/layout.tsx` deliberately does not — see the
   * note there — so an unguarded page renders its own empty state to a stranger
   * and reads as "you have no saved searches" rather than "you are not signed
   * in". The database would refuse either way; this is about not lying.
   */
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  const searches = await listSavedSearches();

  const matches = await Promise.all(
    searches.map(async (search) => ({
      id: search.id,
      listings: await savedSearchMatches(search.id),
    })),
  );
  const matchesById = new Map(matches.map((m) => [m.id, m.listings]));

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Saved searches</h1>
        <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
          Describe what you are waiting for once, and hear when it arrives. Alerts are batched into
          a daily or weekly email — never the moment a listing goes live, because that would publish
          the exact minute a business came to market to everybody watching.
        </p>
      </header>

      {searches.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-10">
            <h2 className="font-display text-xl font-semibold">Nothing saved yet.</h2>
            <p className="text-text-secondary max-w-xl text-sm leading-relaxed">
              Most of what a buyer wants is not listed today. Set your filters on the market and
              save the search — you will hear when something matches instead of checking back.
            </p>
            <Link
              href="/listings"
              className="text-accent inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
            >
              <Search className="h-4 w-4" aria-hidden />
              Search the market
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {searches.map((search) => {
            const listings = matchesById.get(search.id) ?? [];

            return (
              <li key={search.id}>
                <Card>
                  <CardContent className="space-y-4 py-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <h2 className="font-display text-lg font-semibold">{search.label}</h2>
                        <p className="text-text-secondary text-sm">
                          {describeSearch(search, {
                            money: formatMoneyCompact,
                            industry: (key) => INDUSTRY_PROFILES[key as IndustryKey]?.label ?? key,
                          })}
                        </p>
                      </div>

                      <span
                        className={
                          search.frequency === 'off'
                            ? 'text-text-muted flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.14em]'
                            : 'text-accent flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.14em]'
                        }
                      >
                        {search.frequency === 'off' ? (
                          <BellOff className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <BellRing className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {search.frequency === 'off' ? 'Paused' : search.frequency}
                      </span>
                    </div>

                    <div className="border-border-subtle border-t pt-4">
                      <h3 className="text-text-muted mb-2 font-mono text-[11px] uppercase tracking-[0.16em]">
                        Matching now
                      </h3>

                      {listings.length === 0 ? (
                        <p className="text-text-muted text-sm">
                          Nothing on the market matches this yet. That is what the alert is for.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {listings.map((listing) => (
                            <li key={listing.slug} className="text-sm">
                              <Link
                                href={`/businesses-for-sale/${listing.slug}`}
                                className="hover:text-accent font-medium underline-offset-4 hover:underline"
                              >
                                {listing.headline}
                              </Link>
                              {listing.jurisdictionName ? (
                                <span className="text-text-muted">
                                  {' '}
                                  · {listing.jurisdictionName}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <SearchControls
                      id={search.id}
                      frequency={search.frequency}
                      label={search.label}
                    />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
