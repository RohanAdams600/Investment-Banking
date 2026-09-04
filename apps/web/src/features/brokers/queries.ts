import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Reading the public broker directory.
 *
 * Everything here goes through `public.broker_directory`, a view over published
 * profiles only that deliberately carries neither the firm id nor the contact
 * address. That view is the access control — this file adds no `where
 * is_published` of its own, because a filter in application code is one
 * refactor away from being dropped and the view cannot be.
 */

export interface BrokerCard {
  slug: string;
  name: string;
  kind: string;
  isVerified: boolean;
  headline: string | null;
  industries: string[];
  jurisdictions: string[];
}

export interface BrokerProfile extends BrokerCard {
  about: string | null;
  website: string | null;
  establishedYear: number | null;
}

interface Row {
  slug: string;
  name: string;
  kind: string;
  verification_status: string;
  headline: string | null;
  about: string | null;
  industries: string[] | null;
  jurisdictions: string[] | null;
  website: string | null;
  established_year: number | null;
}

function toProfile(row: Row): BrokerProfile {
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    /*
     * A boolean rather than the raw status.
     *
     * `pending` and `rejected` are operator state, and rendering either beside
     * somebody's name on a public page tells a stranger something about their
     * standing that they did not publish — it would be a claim we are making
     * about them, not one they made.
     */
    isVerified: row.verification_status === 'verified',
    headline: row.headline,
    about: row.about,
    industries: row.industries ?? [],
    jurisdictions: row.jurisdictions ?? [],
    website: row.website,
    establishedYear: row.established_year,
  };
}

const COLUMNS =
  'slug, name, kind, verification_status, headline, about, industries, jurisdictions, website, established_year';

/** The directory, newest first, optionally narrowed. */
export async function listBrokers(filter?: {
  industry?: string;
  jurisdiction?: string;
}): Promise<BrokerCard[]> {
  const supabase = await createClient();

  let query = supabase
    .from('broker_directory')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200);

  // `contains` on a text[]; the partial GIN indexes cover both of these.
  if (filter?.industry) query = query.contains('industries', [filter.industry]);
  if (filter?.jurisdiction) query = query.contains('jurisdictions', [filter.jurisdiction]);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as Row[]).map(toProfile);
}

export async function brokerProfile(slug: string): Promise<BrokerProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('broker_directory')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;
  return toProfile(data as unknown as Row);
}

/** Slugs for the sitemap. */
export async function brokerIndex(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('broker_directory').select('slug').limit(1000);
  if (error || !data) return [];
  return (data as { slug: string }[]).map((r) => r.slug);
}
