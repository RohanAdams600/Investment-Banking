import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { can } from '@ib/core';

import { DocumentList, UploadPanel } from '@/features/documents/vault-panels';
import { listDocuments, listRoomMembers } from '@/features/documents/queries';
import { getDeal } from '@/features/messaging/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Deal documents',
  // A data room is confidential by definition.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function DealDocumentsPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const { dealId } = await params;

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  // RLS decides. A deal the caller has no room in reads as absent, which is the
  // same answer a deal that does not exist gives — deliberately, so a URL
  // cannot be used to confirm that a deal exists.
  const deal = await getDeal(dealId);
  if (!deal) notFound();

  const [documents, members] = await Promise.all([listDocuments(dealId), listRoomMembers(dealId)]);

  // The firm the uploader is acting for. A broker in one firm is the common
  // case; somebody in several picks the first, which is wrong often enough that
  // it needs a selector before this ships to a multi-firm user.
  const firmId = actor.firmMemberships[0]?.firmId ?? null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Documents</h1>
        <p className="text-text-muted text-sm">
          {deal.name} ·{' '}
          <Link href={`/deals/${dealId}/messages`} className="underline underline-offset-4">
            Messages
          </Link>
        </p>
      </header>

      <DocumentList
        dealId={dealId}
        documents={documents}
        members={members}
        viewerId={actor.userId}
        canRelease={can(actor, 'document:set_permissions')}
      />

      {can(actor, 'document:upload') ? <UploadPanel dealId={dealId} firmId={firmId} /> : null}

      <p className="text-text-muted text-sm">
        Every document you open is recorded, and whoever uploaded it can see that record. It says a
        link was issued to you at a time — not that a file was read, and not where it went
        afterwards. No system can tell you that, and this one does not pretend to.
      </p>
    </main>
  );
}
