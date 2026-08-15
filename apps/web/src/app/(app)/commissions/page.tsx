import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { brand, can, truncationNotice } from '@ib/core';
import { EmptyState } from '@ib/ui';

import {
  CommissionStatement,
  FeeScheduleForm,
  RecordCommissionForm,
} from '@/features/commission/commission-panels';
import { listCommissions, loadAgreement, totalsFor } from '@/features/commission/queries';
import { FirmPicker } from '@/features/firms/firm-picker';
import { resolveFirmScope } from '@/features/firms/firm-scope';
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

  const params = await searchParams;
  const requested = typeof params.firm === 'string' ? params.firm : null;
  const scope = await resolveFirmScope(requested);

  const firms = scope.options;

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

  /*
   * A broker at two firms picks before seeing a fee schedule.
   *
   * This page used to fall back to `firms[0]`, which put one brokerage's name in
   * the header above another's numbers as soon as somebody belonged to two. On a
   * money screen that is not a cosmetic problem — a fee schedule read as the
   * wrong firm's is a fee somebody quotes to a client.
   */
  if (scope.mustChoose) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-6">
        <FirmPicker options={scope.options} basePath="/commissions" what="a fee schedule" />
      </main>
    );
  }

  const firm = scope.firm!;

  const [agreement, records] = await Promise.all([
    loadAgreement(firm.id),
    listCommissions(firm.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Commissions</h1>
        <p className="text-text-muted text-sm">
          {firm.name} · record-keeping only. {brand.name} does not move money.
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

      {/*
        The totals below are summed from what is on this page. If the list is
        capped they are not the firm's totals, and saying "showing the first
        200" without saying that would be the more dangerous half of the truth.
      */}
      {records.truncated ? (
        <p className="border-warning/40 bg-warning-subtle text-warning rounded border p-3 text-sm">
          {truncationNotice(records, 'commission records')} The totals below cover only these
          records, not the firm&rsquo;s full history.
        </p>
      ) : null}

      <CommissionStatement records={records.rows} totals={totalsFor(records.rows)} />

      <FeeScheduleForm firmId={firm.id} agreement={agreement} />

      {agreement ? <RecordCommissionForm firmId={firm.id} /> : null}

      <div className="border-border-subtle space-y-2 rounded-md border p-4">
        <h2 className="text-sm font-medium">For your accountant</h2>
        <p className="text-text-muted text-sm">
          A CSV of every record above, with each amount in both integer cents and dollars — one
          column to sum, one to read. Every accounting package imports it.
        </p>
        <a
          href={`/commissions/export?firm=${firm.id}`}
          className="border-border-default hover:border-border-strong inline-block rounded-md border px-3 py-1.5 text-sm"
          download
        >
          Download CSV
        </a>
        <p className="text-text-muted text-xs">
          These records are your own bookkeeping. They are not a tax filing, not a 1099, and not
          advice about either — {brand.name} does not move money and has no payment rail.
        </p>
      </div>
    </main>
  );
}
