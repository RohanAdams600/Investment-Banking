import type { Metadata } from 'next';
import { LISTING_STATUS_LABELS, canEditListing } from '@ib/core';
import { Card, CardContent } from '@ib/ui';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { FinancialsEditor } from '@/features/listings/financials-editor';
import { ListingForm } from '@/features/listings/listing-form';
import { NdaQueue } from '@/features/listings/nda-queue';
import { PricingPanel } from '@/features/listings/pricing-panel';
import { ProfileForm } from '@/features/listings/profile-form';
import { listJurisdictions, listNdaRequests, loadListing } from '@/features/listings/queries';
import { StatusControl } from '@/features/listings/status-control';
import { checkOutreachReadiness } from '@/features/matching/actions';
import { MatchedBuyers } from '@/features/matching/matched-buyers';
import { OutreachQueue } from '@/features/matching/outreach-queue';
import {
  listMatchedBuyers,
  listOutreachDrafts,
  loadMatchSummary,
} from '@/features/matching/queries';
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

  // A closed or withdrawn listing is history: NDAs, status entries and
  // eventually commission records point at it, and editing would rewrite what
  // the parties actually agreed. The status trigger refuses the transitions and
  // `canEditListing` is the same rule in application code — asked here so the
  // seller gets an explanation rather than a form whose saves silently fail.
  const editable = canEditListing(actor, {
    id: view.teaser.id,
    ownerUserId: actor.userId,
    firmId: null,
    status: view.teaser.status,
  });

  const [jurisdictions, ndaRequests, summary, buyers, drafts, blockers] = await Promise.all([
    listJurisdictions(),
    listNdaRequests(listingId),
    loadMatchSummary(listingId),
    listMatchedBuyers(listingId),
    listOutreachDrafts(listingId),
    checkOutreachReadiness(),
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

      {!editable ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-text-secondary text-sm">
              This listing is {LISTING_STATUS_LABELS[view.teaser.status].toLowerCase()}, so it can
              no longer be edited. The confidentiality agreements and the record of when it moved
              point at it as it stood. Bringing the business back to market means a new listing.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {editable ? (
        <>
          <ListingForm
            listing={view.teaser}
            jurisdictions={jurisdictions}
            exactFigures={
              view.profile
                ? {
                    revenueCents: view.profile.revenueCents,
                    earningsCents: view.profile.earningsCents,
                    askingPriceCents: view.profile.askingPriceCents,
                  }
                : undefined
            }
          />

          <PricingPanel teaser={view.teaser} profile={view.profile} />

          <ProfileForm listingId={listingId} profile={view.profile} />

          <FinancialsEditor listingId={listingId} years={view.profile?.financials ?? []} />
        </>
      ) : null}

      <NdaQueue requests={ndaRequests} />

      <MatchedBuyers listingId={listingId} summary={summary} buyers={buyers} />

      <OutreachQueue drafts={drafts} blockers={blockers} />
    </main>
  );
}
