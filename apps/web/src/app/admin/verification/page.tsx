import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { VerificationQueue } from '@/features/admin/admin-panels';
import { loadVerificationQueue } from '@/features/admin/queries';
import { getActor } from '@/lib/auth/actor';

export const metadata: Metadata = {
  title: 'Verification',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function VerificationPage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (!can(actor, 'admin:verify_users')) redirect('/admin');

  const items = await loadVerificationQueue();

  return (
    <div className="space-y-4">
      <p className="text-text-muted text-sm">
        Pending first. The roles shown next to each account are the point — verifying a private
        equity fund and verifying a first-time buyer are different jobs, and deciding without that
        context is guessing.
      </p>

      <VerificationQueue items={items} />
    </div>
  );
}
