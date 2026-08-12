import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { listMyFirms } from '@/features/deals/queries';
import { ListingForm } from '@/features/listings/listing-form';
import { listJurisdictions } from '@/features/listings/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'List a business',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewListingPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  // The RLS insert policy refuses this too. Redirecting here is so a buyer does
  // not fill in a long form and only then be told no.
  if (!can(actor, 'listing:create')) redirect('/listings');

  const [jurisdictions, firms] = await Promise.all([listJurisdictions(), listMyFirms()]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">List a business</h1>
        <p className="text-text-muted text-sm">
          This starts as a draft, visible only to you. You will add the confidential details next,
          then submit it for review.
        </p>
      </header>

      <ListingForm jurisdictions={jurisdictions} firms={firms} />

      <p className="text-text-muted text-sm">
        <Link href="/listings/mine" className="underline underline-offset-4">
          Back to my listings
        </Link>
      </p>
    </main>
  );
}
