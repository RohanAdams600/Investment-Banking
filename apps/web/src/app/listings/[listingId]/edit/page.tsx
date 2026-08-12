import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { FinancialsEditor } from '@/features/listings/financials-editor';
import { ListingForm } from '@/features/listings/listing-form';
import { NdaQueue } from '@/features/listings/nda-queue';
import { ProfileForm } from '@/features/listings/profile-form';
import { listJurisdictions, listNdaRequests, loadListing } from '@/features/listings/queries';
import { StatusControl } from '@/features/listings/status-control';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Manage listing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const { listingId } = await params;
  const view = await loadListing(listingId);

  if (!view) notFound();

  // Same 404 for "not yours" as for "does not exist". Every write on this page
  // is refused by RLS anyway; this is so a buyer who guesses the URL learns
  // nothing from the difference.
  if (!view.controls) notFound();

  const [jurisdictions, ndaRequests] = await Promise.all([
    listJurisdictions(),
    listNdaRequests(listingId),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <p className="text-text-muted text-sm">
        <Link href="/listings/mine" className="underline underline-offset-4">
          Back to my listings
        </Link>
      </p>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Manage listing</h1>
        <p className="text-text-muted text-sm">{view.teaser.headline}</p>
      </header>

      <StatusControl listingId={listingId} status={view.teaser.status} history={view.history} />

      <ListingForm listing={view.teaser} jurisdictions={jurisdictions} />

      <ProfileForm listingId={listingId} profile={view.profile} />

      <FinancialsEditor listingId={listingId} years={view.profile?.financials ?? []} />

      <NdaQueue requests={ndaRequests} />
    </main>
  );
}
