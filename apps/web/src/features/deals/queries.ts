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

/**
 * Firms the caller is actually a **member** of.
 *
 * Goes through `firm_members` rather than reading `firms` directly, and that is
 * not a stylistic preference — reading `firms` returns the wrong answer.
 *
 * `firms` has two SELECT policies since 0018, and they are OR'd:
 * `firms_select_members` admits your own, and
 * `firms_select_listing_representative` admits any firm behind a live listing,
 * so a buyer can see who is representing a business. That second policy is
 * correct and load-bearing. It also means `select * from firms` answers "firms I
 * can see", which stopped being the same thing as "firms I belong to" the day it
 * shipped — and nothing caught it, because there were no live listings yet.
 *
 * The consequence was a broker being offered a rival brokerage as a place to
 * file a deal, and the commissions page putting a rival's name in its header
 * before showing an empty statement. No data leaked — every downstream policy
 * still required membership — but the page was lying about whose it was.
 *
 * `firm_members` has one policy and it is the membership itself, so this cannot
 * drift the same way.
 */
export async function listMyFirms(): Promise<FirmOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('firm_members')
    .select('firm_id, firms(id, name)')
    .order('firm_id');

  if (error || !data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as Array<{ firms: any }>;

  return rows
    .map((row) => (Array.isArray(row.firms) ? row.firms[0] : row.firms))
    .filter((firm): firm is { id: string; name: string } => Boolean(firm?.id))
    .map((firm) => ({ id: firm.id, name: firm.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
