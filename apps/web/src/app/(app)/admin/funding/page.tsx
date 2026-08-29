import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { ReviewQueue } from '@/features/verification/review-queue';
import { verificationQueue } from '@/features/verification/queries';
import { getActor } from '@/lib/auth/actor';

export const metadata: Metadata = {
  title: 'Buyer funding',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Reviewing buyer funding evidence.
 *
 * Reuses `admin:verify_users`, because this is the same job as identity
 * verification performed by the same person — a second capability would be a
 * second thing to grant and a second thing to forget to revoke.
 */
export default async function BuyerFundingPage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (!can(actor, 'admin:verify_users')) redirect('/admin');

  const items = await verificationQueue();

  return (
    <div className="space-y-4">
      <p className="text-text-muted max-w-prose text-sm leading-relaxed">
        Ask each buyer for the document they describe, read it, then record the outcome. Sellers
        read a confirmation here as evidence that a person looked — so it is worth the phone call,
        and there is deliberately no way to clear this queue without one.
      </p>

      <ReviewQueue items={items} />
    </div>
  );
}
