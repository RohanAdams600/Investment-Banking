import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { brand, isBrandFullyConfigured } from '@ib/core';
import { Card, CardContent } from '@ib/ui';

import {
  PLATFORM_DOCUMENT_SLUGS,
  PLATFORM_DOCUMENT_TITLES,
  isPlatformDocumentSlug,
  loadPlatformDocument,
} from '@/features/legal/platform-documents';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>;
}): Promise<Metadata> {
  const { kind } = await params;
  if (!isPlatformDocumentSlug(kind)) return { title: 'Legal' };
  return { title: PLATFORM_DOCUMENT_TITLES[kind] };
}

export function generateStaticParams() {
  return Object.keys(PLATFORM_DOCUMENT_SLUGS).map((kind) => ({ kind }));
}

/**
 * Terms, privacy, and the two disclosures.
 *
 * The text comes from `legal_templates` — versioned, published by an
 * administrator, and captured by id and version in `consent_records` when
 * somebody agrees to it. That indirection has been in the schema since 0004 and
 * this is the page that finally uses it.
 *
 * ## Why there is no fallback text
 *
 * The obvious thing to do with an unpublished document is ship a reasonable
 * draft and mark it provisional. That would be worse than what this page does,
 * for one specific reason: somebody will rely on it. A visitor who reads
 * plausible terms and signs up has agreed to something, and the something is
 * text nobody with a licence has read. So the page says the document is not
 * ready, and means it.
 */
export default async function LegalPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isPlatformDocumentSlug(kind)) notFound();

  const title = PLATFORM_DOCUMENT_TITLES[kind];
  const document = isSupabaseConfigured() ? await loadPlatformDocument(kind) : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <p className="text-text-muted text-sm">
        <Link href="/" className="underline underline-offset-4">
          {brand.name}
        </Link>
      </p>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {document ? (
          <p className="text-text-muted text-sm">
            Version {document.version} · published{' '}
            {new Date(document.publishedAt).toLocaleDateString()}
          </p>
        ) : null}
      </header>

      {document ? (
        // Plain text, preserving the author's line breaks. Never
        // dangerouslySetInnerHTML: this is a document an administrator pasted
        // in, and rendering it as markup would make the legal page the one place
        // in the product that executes what somebody typed.
        <div className="text-text-secondary whitespace-pre-wrap text-sm leading-relaxed">
          {document.body}
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-3 py-6">
            <h2 className="text-base font-medium">Not published yet</h2>
            <p className="text-text-secondary text-sm">
              This document has not been reviewed by counsel and published, so there is nothing here
              to read. We have deliberately not put a draft in its place — plausible legal text that
              nobody with a licence has read is worse than an empty page, because somebody would
              rely on it.
            </p>
            <p className="text-text-muted text-sm">
              {isBrandFullyConfigured ? (
                <>
                  Questions in the meantime:{' '}
                  <a href={`mailto:${brand.supportEmail}`} className="underline underline-offset-4">
                    {brand.supportEmail}
                  </a>
                  .
                </>
              ) : (
                'The platform is not open for business yet.'
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
