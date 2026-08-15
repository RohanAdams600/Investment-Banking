import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * The platform's own legal documents — terms, privacy policy, disclosures.
 *
 * Distinct from `listPublishedTemplates()`, which serves the *deal* documents a
 * broker drafts. These are the ones a visitor reads before signing up, and the
 * ones a regulator asks for.
 *
 * They come from `legal_templates` rather than from a React component, and that
 * choice has been in the schema since 0004: the text somebody agreed to has to
 * be reproducible years later, and a string in a component that has since been
 * edited cannot do that. `consent_records` stores the template id and version at
 * acceptance for the same reason.
 *
 * The table has been readable and unread for a long time. This is the surface
 * that finally uses it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** The slugs the public routes accept, mapped to what the enum calls them. */
export const PLATFORM_DOCUMENT_SLUGS = {
  terms: 'terms_of_use',
  privacy: 'privacy_policy',
  licensing: 'broker_licensing_disclosure',
  'not-securities': 'not_a_securities_offering',
} as const;

export type PlatformDocumentSlug = keyof typeof PLATFORM_DOCUMENT_SLUGS;

export const PLATFORM_DOCUMENT_TITLES: Record<PlatformDocumentSlug, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  licensing: 'Broker licensing disclosure',
  'not-securities': 'This is not a securities offering',
};

export function isPlatformDocumentSlug(value: string): value is PlatformDocumentSlug {
  return value in PLATFORM_DOCUMENT_SLUGS;
}

export interface PlatformDocument {
  title: string;
  body: string;
  version: number;
  publishedAt: string;
}

/**
 * The published document, or null.
 *
 * Null is the expected answer today and will stay so until counsel has reviewed
 * something and an administrator has published it. That is not a bug and the
 * page says so plainly rather than rendering placeholder legal text — a terms
 * page containing invented terms is worse than an empty one, because somebody
 * will rely on it.
 *
 * Read through the anonymous client, because a visitor deciding whether to sign
 * up has not signed up. The RLS policy admits only published, unsuperseded rows
 * to `anon`, so a draft counsel is still marking up cannot appear here.
 */
export async function loadPlatformDocument(
  slug: PlatformDocumentSlug,
): Promise<PlatformDocument | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('legal_templates')
    .select('title, body, version, published_at')
    .eq('kind', PLATFORM_DOCUMENT_SLUGS[slug])
    .not('published_at', 'is', null)
    .is('superseded_at', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = data as Row;

  return {
    title: row.title,
    body: row.body,
    version: row.version,
    publishedAt: row.published_at,
  };
}
