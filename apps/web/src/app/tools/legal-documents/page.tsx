import type { Metadata } from 'next';

import Link from 'next/link';
import { DOCUMENT_LABELS } from '@ib/core';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { DocumentWorkbench } from '@/features/legal/document-workbench';
import { listMyDrafts, listPublishedTemplates } from '@/features/legal/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Legal documents',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function LegalDocumentsPage() {
  // Templates come from the database when it is configured; the review side of
  // the workbench works either way, which is why this degrades rather than
  // redirecting.
  const [templates, drafts] = isSupabaseConfigured()
    ? await Promise.all([listPublishedTemplates(), listMyDrafts()])
    : [[], []];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Legal documents</h1>
        <p className="text-text-secondary max-w-2xl text-sm">
          A checklist of terms that commonly matter in lower-middle-market deals, run against your
          draft. It raises questions for your attorney — it does not review documents, and it cannot
          tell you whether one is sound.
        </p>
      </header>

      {drafts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your documents</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {drafts.map((draft) => (
                <li key={draft.id}>
                  <Link
                    href={`/tools/legal-documents/${draft.id}`}
                    className="border-border-subtle hover:border-border-default block rounded-md border p-3 transition-colors"
                  >
                    <span className="block text-sm font-medium">{draft.title}</span>
                    <span className="text-text-muted block text-xs">
                      {DOCUMENT_LABELS[draft.kind]}
                      {draft.versionCount > 0
                        ? ` · ${draft.versionCount} ${draft.versionCount === 1 ? 'revision' : 'revisions'}`
                        : ''}
                      {draft.findingCount > 0
                        ? ` · ${draft.findingCount} ${draft.findingCount === 1 ? 'question' : 'questions'} raised`
                        : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <DocumentWorkbench templates={templates} />
    </main>
  );
}
