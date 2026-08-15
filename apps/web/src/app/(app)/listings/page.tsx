import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search } from 'lucide-react';
import { can, truncationNotice } from '@ib/core';
import { Button, EmptyState } from '@ib/ui';

import { BrowseFilters as Filters } from '@/features/listings/browse-filters';
import { ListingCard } from '@/features/listings/listing-card';
import { browseListings, listJurisdictions } from '@/features/listings/queries';
import type { BrowseFilters } from '@/features/listings/types';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Businesses for sale',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Dollars in the query string, integer cents everywhere below it. */
function toCents(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (cleaned === '') return undefined;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };

  const filters: BrowseFilters = {
    industry: single('industry'),
    jurisdiction: single('jurisdiction'),
    minEarningsCents: toCents(single('minEarnings')),
    maxAskingCents: toCents(single('maxAsking')),
  };

  const [page, jurisdictions] = await Promise.all([browseListings(filters), listJurisdictions()]);

  const notice = truncationNotice(page, 'listings');
  const canList = can(actor, 'listing:create');

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Businesses for sale</h1>
          <p className="text-text-muted text-sm">
            Listings are anonymous until the seller issues you a confidentiality agreement.
          </p>
        </div>

        {canList ? (
          <Button asChild size="sm">
            <Link href="/listings/new">List a business</Link>
          </Button>
        ) : null}
      </header>

      <Filters jurisdictions={jurisdictions} current={filters} />

      {page.rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches yet"
          description="No listings match these filters. Widen them, or check back — new businesses come to market every week."
        />
      ) : (
        <>
          <p className="text-text-muted text-sm" aria-live="polite">
            {page.rows.length} {page.rows.length === 1 ? 'listing' : 'listings'}
            {/*
              Said out loud rather than left to be discovered. A capped list
              that does not mention the cap looks exactly like a complete one.
            */}
            {notice ? <span className="text-warning block">{notice}</span> : null}
          </p>
          <ul className="space-y-3">
            {page.rows.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
