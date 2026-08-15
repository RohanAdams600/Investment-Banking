import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { brand, can } from '@ib/core';

import { JurisdictionTable } from '@/features/admin/admin-panels';
import { loadJurisdictions } from '@/features/admin/queries';
import { getActor } from '@/lib/auth/actor';

export const metadata: Metadata = {
  title: 'Jurisdictions',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function JurisdictionsPage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (!can(actor, 'admin:manage_jurisdictions')) redirect('/admin');

  const rows = await loadJurisdictions();

  return (
    <div className="space-y-4">
      <JurisdictionTable rows={rows} />

      <p className="text-text-muted text-sm">
        Business brokerage licensing varies by state, and some states regulate the sale of a
        business as a real estate transaction. Which states you can operate in is a question for
        your own counsel. {brand.name} gives you the switch and records when it was flipped; it does
        not answer the question.
      </p>
    </div>
  );
}
