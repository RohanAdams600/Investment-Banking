import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { BuyerProfileForm } from '@/features/matching/buyer-profile-form';
import { loadMyBuyerProfile } from '@/features/matching/queries';
import { getActor } from '@/lib/auth/actor';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Buyer profile',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BuyerProfilePage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');
  if (!can(actor, 'listing:view_full')) redirect('/dashboard');

  const supabase = await createClient();
  const [profile, criteria] = await Promise.all([
    loadMyBuyerProfile(),
    supabase
      .from('acquisition_criteria')
      .select('is_discoverable')
      .is('superseded_at', null)
      .maybeSingle(),
  ]);

  const isDiscoverable =
    (criteria.data as { is_discoverable?: boolean } | null)?.is_discoverable ?? true;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Buyer profile</h1>
        <p className="text-text-muted text-sm">
          How sellers see you. A complete profile gets access requests answered.
        </p>
      </header>

      <BuyerProfileForm profile={profile} isDiscoverable={isDiscoverable} />

      <p className="text-text-muted text-sm">
        Your profile says who you are.{' '}
        <Link href="/tools/buyer-criteria" className="underline underline-offset-4">
          Your criteria
        </Link>{' '}
        say what you want to buy — that is what matching runs on.
      </p>
    </main>
  );
}
