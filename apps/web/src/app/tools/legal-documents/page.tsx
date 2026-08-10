import type { Metadata } from 'next';

import { DocumentWorkbench } from '@/features/legal/document-workbench';
import { listPublishedTemplates } from '@/features/legal/queries';
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
  const templates = isSupabaseConfigured() ? await listPublishedTemplates() : [];

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

      <DocumentWorkbench templates={templates} />
    </main>
  );
}
