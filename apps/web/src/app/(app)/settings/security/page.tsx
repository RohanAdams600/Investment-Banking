import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { MfaPanel } from '@/features/security/mfa-panel';
import { SessionList } from '@/features/security/session-list';
import { listSessions } from '@/features/security/session-actions';
import type { MfaFactorSummary } from '@/features/security/types';
import { getAssuranceState } from '@/lib/auth/assurance';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Security',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in');

  const [{ data: factorData }, assurance, sessions] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    getAssuranceState(),
    listSessions(),
  ]);

  const factors: MfaFactorSummary[] = (factorData?.all ?? []).map((factor) => ({
    id: factor.id,
    friendlyName: factor.friendly_name ?? null,
    status: factor.status,
    createdAt: factor.created_at,
  }));

  return (
    <main className="py-18 mx-auto max-w-2xl space-y-6 px-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Security</h1>
        <p className="text-text-muted text-sm">
          Two-factor authentication and the devices signed in to your account.
        </p>
      </div>

      <MfaPanel factors={factors} sessionIsAal2={assurance.current === 'aal2'} />
      <SessionList sessions={sessions} />
    </main>
  );
}
