import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { ReviewQueue } from '@/features/admin/admin-panels';
import { loadReviewQueue } from '@/features/admin/queries';
import { getActor } from '@/lib/auth/actor';

export const metadata: Metadata = {
  title: 'Listing review',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ListingReviewPage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (!can(actor, 'listing:review')) redirect('/admin');

  const items = await loadReviewQueue();

  return (
    <div className="space-y-4">
      <p className="text-text-muted text-sm">
        Listings a seller has submitted, oldest first. Approving publishes the anonymised teaser to
        the market; sending one back returns it to draft with your note attached.
      </p>

      <ReviewQueue items={items} />
    </div>
  );
}
