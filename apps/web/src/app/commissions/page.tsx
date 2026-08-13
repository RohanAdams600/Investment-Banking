import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { can } from '@ib/core';
import { EmptyState } from '@ib/ui';

import {
  CommissionStatement,
  FeeScheduleForm,
  RecordCommissionForm,
} from '@/features/commission/commission-panels';
import { listCommissions, loadAgreement, totalsFor } from '@/features/commission/queries';
import { listMyFirms } from '@/features/deals/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Commissions',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  // `commission:configure` is a broker capability. The RLS policies require
  // owner or admin of the firm on top of it, so this is the outer gate only.
  if (!can(actor, 'commission:view_own')) redirect('/dashboard');

  const firms = await listMyFirms();

  if (firms.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <EmptyState
          icon={Receipt}
          title="Commissions belong to a firm"
          description="Fees are recorded against a brokerage rather than an individual, so this page needs you to be a member of one. A firm is created when you first list a business on a client's behalf."
        />
      </main>
    );
  }

  const params = await searchParams;
  const requested = typeof params.firm === 'string' ? params.firm : null;
  const firm = firms.find((f) => f.id === requested) ?? firms[0]!;

  const [agreement, records] = await Promise.all([
    loadAgreement(firm.id),
    listCommissions(firm.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Commissions</h1>
        <p className="text-text-muted text-sm">
          {firm.name} · record-keeping only. Cairn does not move money.
        </p>
      </header>

      {firms.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Firms">
          {firms.map((option) => (
            <Link
              key={option.id}
              href={`/commissions?firm=${option.id}`}
              className={
                option.id === firm.id
                  ? 'border-primary bg-primary-subtle rounded-md border px-3 py-1.5 text-sm'
                  : 'border-border-default hover:border-border-strong rounded-md border px-3 py-1.5 text-sm'
              }
            >
              {option.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <CommissionStatement records={records} totals={totalsFor(records)} />

      <FeeScheduleForm firmId={firm.id} agreement={agreement} />

      {agreement ? <RecordCommissionForm firmId={firm.id} /> : null}

      <p className="text-text-muted text-sm">
        These records are for your own bookkeeping and are not tax advice. Export and reconciliation
        for your accountant is not built yet.
      </p>
    </main>
  );
}
