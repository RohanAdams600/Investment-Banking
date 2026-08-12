import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bookmark } from 'lucide-react';
import { Button, EmptyState } from '@ib/ui';

import { ListingCard } from '@/features/listings/listing-card';
import { listWatchlist } from '@/features/listings/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Watchlist',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const listings = await listWatchlist();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Watchlist</h1>
        <p className="text-text-muted text-sm">
          Private to you. Sellers are not told who has saved their listing.
        </p>
      </header>

      {listings.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Save a listing while you browse and it will be here when you come back."
          action={
            <Button asChild size="sm">
              <Link href="/listings">Browse listings</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {listings.map((listing) => (
            <li key={listing.id}>
              <ListingCard listing={listing} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
