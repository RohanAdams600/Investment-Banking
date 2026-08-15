import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import { can } from '@ib/core';
import { Button, EmptyState } from '@ib/ui';

import { ListingCard } from '@/features/listings/listing-card';
import { listFirmListings, listMyListings } from '@/features/listings/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'My listings',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function MyListingsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const canManageForClient = can(actor, 'listing:manage_for_client');

  const [mine, firmListings] = await Promise.all([
    listMyListings(),
    canManageForClient ? listFirmListings() : Promise.resolve([]),
  ]);

  const canCreate = can(actor, 'listing:create');

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">My listings</h1>
          <p className="text-text-muted text-sm">
            Drafts are visible only to you until you publish them.
          </p>
        </div>

        {canCreate ? (
          <Button asChild size="sm">
            <Link href="/listings/new">List a business</Link>
          </Button>
        ) : null}
      </header>

      {mine.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No listings yet"
          description={
            canCreate
              ? 'Start a draft. Nothing is visible to buyers until you publish it.'
              : 'Only sellers and brokers can bring a business to market.'
          }
          action={
            canCreate ? (
              <Button asChild size="sm">
                <Link href="/listings/new">List a business</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {mine.map((listing) => (
            <li key={listing.id}>
              <ListingCard listing={listing} showStatus />
            </li>
          ))}
        </ul>
      )}

      {firmListings.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Managed through your firm</h2>
          <p className="text-text-muted text-sm">
            Listings a colleague brought in that you can act on as a broker.
          </p>
          <ul className="space-y-3">
            {firmListings.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} showStatus />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
