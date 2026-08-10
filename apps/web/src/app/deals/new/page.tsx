import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { NewDealForm } from '@/features/deals/new-deal-form';
import { listMyFirms } from '@/features/deals/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Open a deal',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewDealPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  // Checked here so a buyer is not shown a form the database will refuse.
  // `create_deal()` re-checks it, which is the control — this is courtesy.
  if (!can(actor, 'deal:create')) redirect('/deals');

  const firms = await listMyFirms();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Open a deal</h1>
        <p className="text-text-muted text-sm">
          A deal is the container for its conversations, documents and eventually its commission
          record.
        </p>
      </header>

      <NewDealForm firms={firms} />
    </main>
  );
}
