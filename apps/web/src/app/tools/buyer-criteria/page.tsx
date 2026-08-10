import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { CriteriaForm } from '@/features/criteria/criteria-form';
import { loadCriteria } from '@/features/criteria/queries';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Acquisition criteria',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BuyerCriteriaPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const initial = await loadCriteria();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">What are you looking to buy?</h1>
        <p className="text-text-secondary max-w-2xl text-sm">
          These answers rank every listing you see. Your criteria are private — sellers see that you
          matched, never the thresholds you set.
        </p>
      </header>

      <CriteriaForm initial={initial ?? undefined} />
    </main>
  );
}
