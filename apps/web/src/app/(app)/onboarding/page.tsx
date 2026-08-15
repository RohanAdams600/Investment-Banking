import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { brand } from '@ib/core';

import { RolePicker } from '@/features/onboarding/role-picker';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Getting started',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">What brings you to {brand.name}?</h1>
        <p className="text-text-secondary text-sm">
          This decides what you can do here. A new account starts with no access at all until you
          choose — nothing is assumed on your behalf.
        </p>
      </header>

      <RolePicker existing={[...actor.platformRoles]} />
    </main>
  );
}
