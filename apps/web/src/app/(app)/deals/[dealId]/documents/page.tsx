import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { can, truncationNotice } from '@ib/core';

import { DocumentList, UploadPanel } from '@/features/documents/vault-panels';
import { listDocuments, listRoomMembers } from '@/features/documents/queries';
import { FirmPicker } from '@/features/firms/firm-picker';
import { resolveFirmScope } from '@/features/firms/firm-scope';
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
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ firm?: string }>;
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

  const { firm: requestedFirm } = await searchParams;

  const [documents, members, scope] = await Promise.all([
    listDocuments(dealId),
    listRoomMembers(dealId),
    resolveFirmScope(requestedFirm),
  ]);

  /*
   * A broker at two brokerages must say which one before uploading.
   *
   * The vault is append-only: a document filed against the wrong firm cannot be
   * moved, only withdrawn, and the other firm's administrators can see it in
   * the meantime. That is worth one deliberate click from the small minority
   * who have a choice to make.
   *
   * Reading is unaffected — the list above is already loaded, and which firm you
   * are acting as does not change what you may open.
   */
  const firmId = scope.firm?.id ?? null;

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

      {/*
        The one truncation notice that is not a nicety. A buyer who cannot see a
        document does not know to ask for it, and "it was in the data room" is a
        sentence that gets said in a dispute.
      */}
      {truncationNotice(documents, 'documents') ? (
        <p className="border-warning/40 bg-warning-subtle text-warning rounded border p-3 text-sm">
          {truncationNotice(documents, 'documents')}
        </p>
      ) : null}

      <DocumentList
        dealId={dealId}
        documents={documents.rows}
        members={members}
        viewerId={actor.userId}
        canRelease={can(actor, 'document:set_permissions')}
      />

      {can(actor, 'document:upload') ? (
        scope.mustChoose ? (
          <FirmPicker
            options={scope.options}
            basePath={`/deals/${dealId}/documents`}
            what="a document you upload"
          />
        ) : (
          <UploadPanel dealId={dealId} firmId={firmId} />
        )
      ) : null}

      <p className="text-text-muted text-sm">
        Every document you open is recorded, and whoever uploaded it can see that record. It says a
        link was issued to you at a time — not that a file was read, and not where it went
        afterwards. No system can tell you that, and this one does not pretend to.
      </p>
    </main>
  );
}
