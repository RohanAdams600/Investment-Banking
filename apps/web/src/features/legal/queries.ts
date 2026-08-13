import 'server-only';

import type { LegalDocumentKind } from '@ib/core';

import { createClient } from '@/lib/supabase/server';

export interface PublishedTemplate {
  id: string;
  kind: LegalDocumentKind;
  title: string;
  version: number;
}

/**
 * Published legal templates.
 *
 * `published_at is not null` is enforced by the RLS policy on
 * `legal_templates`, and repeated here so the intent is legible at the call
 * site. A draft template must never reach a user: the whole point of the
 * versioning is that the wording someone was shown is the wording counsel
 * approved.
 *
 * Expect this to return nothing for now. `supabase/seed.sql` deliberately seeds
 * no templates, because placeholder legal text plus a consent record pointing at
 * it is worse than having no feature.
 */
export async function listPublishedTemplates(): Promise<PublishedTemplate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('legal_templates')
    .select('id, kind, title, version')
    .not('published_at', 'is', null)
    .is('superseded_at', null)
    .order('version', { ascending: false });

  if (error || !data) return [];

  // `legal_templates.kind` spans platform documents (terms of use, privacy
  // policy) as well as deal documents. Only the deal ones belong here.
  const dealKinds = new Set<string>([
    'nda',
    'loi',
    'asset_purchase_agreement',
    'stock_purchase_agreement',
    'broker_agreement',
  ]);

  return data
    .filter((row) => dealKinds.has(row.kind as string))
    .map((row) => ({
      id: row.id as string,
      kind: row.kind as LegalDocumentKind,
      title: row.title as string,
      version: row.version as number,
    }));
}

export interface DraftSummary {
  id: string;
  kind: LegalDocumentKind;
  title: string;
  updatedAt: string;
  findingCount: number;
  versionCount: number;
}

/**
 * The caller's own drafts.
 *
 * RLS restricts this to drafts they created, so no user filter — the session is
 * the filter. Version counts come from the embedded relation rather than a
 * second query.
 */
export async function listMyDrafts(): Promise<DraftSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('legal_document_drafts')
    .select('id, kind, title, updated_at, review_findings, legal_document_versions(id)')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return data.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as Record<string, any>;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      updatedAt: r.updated_at,
      findingCount: Array.isArray(r.review_findings) ? r.review_findings.length : 0,
      versionCount: Array.isArray(r.legal_document_versions) ? r.legal_document_versions.length : 0,
    };
  });
}

export interface DraftDetail {
  id: string;
  kind: LegalDocumentKind;
  title: string;
  body: string;
  versions: Array<{
    id: string;
    version: number;
    body: string;
    note: string | null;
    createdAt: string;
  }>;
}

/**
 * One draft with its full revision history.
 *
 * Versions come back newest first, which is the order the comparison picker
 * wants — the useful default is "what changed since last time", not "what
 * changed since the beginning".
 */
export async function loadDraft(draftId: string): Promise<DraftDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('legal_document_drafts')
    .select('id, kind, title, body')
    .eq('id', draftId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: versions } = await supabase
    .from('legal_document_versions')
    .select('id, version, body, note, created_at')
    .eq('draft_id', draftId)
    .order('version', { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as Record<string, any>;

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    versions: ((versions ?? []) as Array<Record<string, any>>).map((v) => ({
      id: v.id,
      version: v.version,
      body: v.body,
      note: v.note ?? null,
      createdAt: v.created_at,
    })),
  };
}
