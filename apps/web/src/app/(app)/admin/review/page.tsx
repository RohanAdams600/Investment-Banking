import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, truncationNotice } from '@ib/core';

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

      {/*
        A review queue that quietly stops at 100 is a queue where the oldest
        submissions are the ones nobody sees — the ordering is oldest-first, so
        a cap hides the newest, but a backlog past 100 means the operator needs
        to know the shape of it rather than just work the top.
      */}
      {items.truncated ? (
        <p className="border-warning/40 bg-warning-subtle text-warning rounded border p-3 text-sm">
          {truncationNotice(items, 'submissions')} The backlog is longer than one screen of work.
        </p>
      ) : null}

      <ReviewQueue items={items.rows} />
    </div>
  );
}
