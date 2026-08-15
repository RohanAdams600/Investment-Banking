import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import type { ConversationRole } from './validation';

/**
 * Server-side membership checks.
 *
 * These are the *first* line. Row Level Security is the second, and it is the
 * one that actually holds — every query below runs as the signed-in user, so a
 * bug here fails closed rather than open.
 *
 * They exist because RLS alone gives poor answers to the API layer. A query
 * filtered to nothing is indistinguishable from a conversation that is empty,
 * and both come back as 200 with `[]`. Checking membership explicitly is what
 * lets a route return 403 for "not yours" and 404 for "no such thing", which is
 * the difference between a usable API and one that silently does nothing.
 */

export interface MembershipResult {
  isMember: boolean;
  role: ConversationRole | null;
  canAdminister: boolean;
}

const NOT_A_MEMBER: MembershipResult = { isMember: false, role: null, canAdminister: false };

export const getConversationMembership = cache(
  async (conversationId: string): Promise<MembershipResult> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NOT_A_MEMBER;

    // Reads through RLS as the caller. The `removed_at is null` filter is
    // repeated here rather than assumed — the policies enforce it, and so does
    // this, because a membership row that exists is not a membership that is
    // live.
    const { data, error } = await supabase
      .from('conversation_members')
      .select('role')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .is('removed_at', null)
      .maybeSingle();

    if (error || !data) return NOT_A_MEMBER;

    const role = data.role as ConversationRole;
    return {
      isMember: true,
      role,
      // Buyers and sellers sit in the room; they do not decide who else does.
      canAdminister: role === 'banker' || role === 'admin',
    };
  },
);

export class MessagingError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MessagingError';
    this.status = status;
  }
}

/**
 * Guard for every messaging route.
 *
 * Returns 404 rather than 403 for a conversation the caller cannot see. On this
 * product that distinction leaks: "you may not read this conversation" confirms
 * a conversation with that id exists, and conversation ids appear in URLs that
 * get pasted into email. Members get 403 when they lack the *role* for an
 * action, because by then they already know the room exists.
 */
export async function requireConversationMember(
  conversationId: string,
  options: { administer?: boolean } = {},
): Promise<MembershipResult> {
  const membership = await getConversationMembership(conversationId);

  if (!membership.isMember) {
    throw new MessagingError(404, 'Conversation not found.');
  }

  if (options.administer && !membership.canAdminister) {
    throw new MessagingError(403, 'Only a banker or admin can change who is in this conversation.');
  }

  return membership;
}
