import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { DealSummary, FirmOption } from './types';

/**
 * Deals the caller can reach.
 *
 * No user filter: the RLS policy on `deals` admits only deals the caller sits
 * in a conversation on, so "my deals" and "deals I can see" are the same query.
 */
export async function listDeals(): Promise<DealSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('deals')
    .select('id, name, created_at, deal_conversations(id)')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    // Counts only the conversations RLS admits, which is the number that
    // matters — rooms on this deal the caller is not in should not be hinted at.
    conversationCount: Array.isArray(row.deal_conversations) ? row.deal_conversations.length : 0,
  }));
}

/** Firms the caller belongs to, for optionally attributing a deal. */
export async function listMyFirms(): Promise<FirmOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.from('firms').select('id, name').order('name');

  if (error || !data) return [];
  return data.map((row) => ({ id: row.id as string, name: row.name as string }));
}
