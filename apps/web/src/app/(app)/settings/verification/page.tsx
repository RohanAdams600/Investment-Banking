import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { VerificationForm } from '@/features/verification/verification-form';
import { myVerification } from '@/features/verification/queries';
import { getActor } from '@/lib/auth/actor';

export const metadata: Metadata = {
  title: 'Funding verification',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * A buyer's own verification.
 *
 * Not gated on a buyer role. Advisors acquire on behalf of clients and sellers
 * buy other businesses, and a role check here would turn a trust signal into a
 * permissions puzzle for exactly the people most likely to transact.
 */
export default async function VerificationSettingsPage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  const current = await myVerification();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Funding verification</h1>
        <p className="text-text-secondary text-sm leading-relaxed">
          Optional, and it changes how quickly sellers respond to you.
        </p>
      </header>

      <VerificationForm current={current} />
    </div>
  );
}
