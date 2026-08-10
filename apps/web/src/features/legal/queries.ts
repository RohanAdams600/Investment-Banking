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
