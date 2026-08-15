import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DOCUMENT_LABELS } from '@ib/core';

import { loadDraft } from '@/features/legal/queries';
import { RevisionPanel } from '@/features/legal/revision-panel';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Revise document',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function DraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  if (!isSupabaseConfigured()) redirect('/tools/legal-documents');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  const { draftId } = await params;
  const draft = await loadDraft(draftId);

  // RLS restricts drafts to their creator, so a draft belonging to somebody
  // else is indistinguishable from one that does not exist.
  if (!draft) notFound();

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <p className="text-text-muted text-sm">
        <Link href="/tools/legal-documents" className="underline underline-offset-4">
          Back to legal documents
        </Link>
      </p>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{draft.title}</h1>
        <p className="text-text-muted text-sm">
          {DOCUMENT_LABELS[draft.kind]} ·{' '}
          {draft.versions.length === 0
            ? 'No revisions yet'
            : `${draft.versions.length} ${draft.versions.length === 1 ? 'revision' : 'revisions'}`}
        </p>
      </header>

      <RevisionPanel
        draftId={draft.id}
        kind={draft.kind}
        currentBody={draft.body}
        versions={draft.versions}
      />
    </main>
  );
}
