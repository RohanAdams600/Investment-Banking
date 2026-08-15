import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ConversationDto, ConversationMemberDto, MessageDto, MessagePage } from './types';
import type { ConversationRole, ConversationType } from './validation';

/**
 * Reads for the messaging feature.
 *
 * Every query here runs as the signed-in user through the anon key, so Row
 * Level Security applies. None of them takes a user id — the caller's identity
 * comes from the session, which is what makes "show me my messages" impossible
 * to turn into "show me theirs" by changing a parameter.
 */

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  profiles: { full_name: string | null } | null;
}

export async function listMessages(
  conversationId: string,
  { before, limit = 50 }: { before?: string; limit?: number } = {},
): Promise<MessagePage> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let query = supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, edited_at, profiles(full_name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    // One extra row, to find out whether another page exists without a second
    // round trip or a count query.
    .limit(limit + 1);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as MessageRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    // Reversed so the caller gets oldest-first, which is reading order. The
    // query is newest-first because that is what the index serves cheaply.
    messages: page.map((row) => toMessageDto(row, user?.id ?? null)).reverse(),
    // The cursor is the oldest row in this page, in the query's newest-first
    // order — so `before=<cursor>` picks up exactly where this page ended.
    nextCursor: hasMore ? (page[page.length - 1]?.created_at ?? null) : null,
  };
}

function toMessageDto(row: MessageRow, currentUserId: string | null): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.profiles?.full_name ?? null,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    isOwn: row.sender_id === currentUserId,
  };
}

export async function listConversations(dealId: string): Promise<ConversationDto[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('deal_conversations')
    .select('id, deal_id, name, type, created_at')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    dealId: row.deal_id as string,
    name: row.name as string,
    type: row.type as ConversationType,
    createdAt: row.created_at as string,
  }));
}

export async function listMembers(conversationId: string): Promise<ConversationMemberDto[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('conversation_members')
    .select('user_id, role, added_at, profiles(full_name)')
    .eq('conversation_id', conversationId)
    .is('removed_at', null)
    .order('added_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { full_name: string | null } | null;
    return {
      userId: row.user_id as string,
      name: profile?.full_name ?? null,
      role: row.role as ConversationRole,
      addedAt: row.added_at as string,
    };
  });
}

export async function getDeal(dealId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('deals')
    .select('id, name')
    .eq('id', dealId)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string };
}
