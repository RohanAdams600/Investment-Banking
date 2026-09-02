import 'server-only';

import type { AlertFrequency, SavedSearch } from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Reading a buyer's saved searches.
 *
 * Every query here goes through the caller's own client, so the policy on
 * `saved_searches` is what decides the result rather than a `where user_id =`
 * this file could get wrong. That matters more here than elsewhere: a saved
 * search is a statement about what somebody intends to buy, and the table has
 * no admin path at all by design.
 */

interface Row {
  id: string;
  label: string;
  q: string | null;
  industry: string | null;
  jurisdiction_code: string | null;
  min_earnings_cents: string | number | null;
  max_asking_cents: string | number | null;
  frequency: AlertFrequency;
  last_notified_at: string | null;
  created_at: string;
}

/*
 * `bigint` arrives as a string from PostgREST.
 *
 * Postgres bigints exceed what a JSON number can hold exactly, so the driver
 * plays safe and hands back text. Cents in this product are comfortably inside
 * the safe range — a business is not sold for more than nine quadrillion — so
 * the conversion is sound here, and doing it once at the boundary keeps every
 * caller from having to remember that a money column might be a string.
 */
function cents(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function toSavedSearch(row: Row): SavedSearch {
  return {
    id: row.id,
    label: row.label,
    q: row.q,
    industry: row.industry,
    jurisdictionCode: row.jurisdiction_code,
    minEarningsCents: cents(row.min_earnings_cents),
    maxAskingCents: cents(row.max_asking_cents),
    frequency: row.frequency,
    lastNotifiedAt: row.last_notified_at ? new Date(row.last_notified_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('saved_searches')
    .select(
      'id, label, q, industry, jurisdiction_code, min_earnings_cents, max_asking_cents, frequency, last_notified_at, created_at',
    )
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as Row[]).map(toSavedSearch);
}

export interface SavedSearchMatch {
  slug: string;
  headline: string;
  industry: string | null;
  jurisdictionName: string | null;
  publishedAt: Date | null;
}

/**
 * What one saved search would surface right now.
 *
 * Shown on the management page so a buyer can see whether a search is doing
 * anything before they wait a day to find out. `since` is left null here
 * deliberately: this is "what does this match", not "what have I not been told
 * about", and answering the second question on a page would advance nothing
 * while looking like it had.
 */
export async function savedSearchMatches(searchId: string, limit = 5): Promise<SavedSearchMatch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('saved_search_matches', {
    p_search_id: searchId,
    p_since: null,
    p_limit: limit,
  });

  if (error || !data) return [];

  return (data as Array<Record<string, string | null>>).map((row) => ({
    slug: row.slug ?? '',
    headline: row.headline ?? '',
    industry: row.industry ?? null,
    jurisdictionName: row.jurisdiction_name ?? null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  }));
}
