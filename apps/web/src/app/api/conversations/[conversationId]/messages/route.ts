import { NextResponse } from 'next/server';

import { requireConversationMember } from '@/features/messaging/authorization';
import { listMessages } from '@/features/messaging/queries';
import {
  enforceRateLimit,
  parseBody,
  requireUser,
  toErrorResponse,
} from '@/features/messaging/route-helpers';
import { listMessagesSchema, sendMessageSchema, uuidSchema } from '@/features/messaging/validation';
import { notifyCollapsed } from '@/lib/notify/notify';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

/**
 * Tell the room, except the person who just spoke.
 *
 * Service role, because the sender cannot read every member's row — a member
 * removed from another conversation, an advisor added by the other side. The
 * only thing read here is a list of ids, and none of it reaches the text: the
 * notification says "a new message" and links to the deal.
 *
 * The link needs the deal, not the conversation, so a second read. Worth it —
 * `/deals/<conversation-id>/messages` is a 404 delivered by email.
 *
 * Failures are swallowed. A message that was written, stored and broadcast has
 * succeeded; refusing the request because a notification did not insert would
 * make people send it twice.
 */
async function notifyConversation(conversationId: string, senderId: string): Promise<void> {
  try {
    const service = createServiceRoleClient();

    const { data: conversation } = await service
      .from('deal_conversations')
      .select('deal_id')
      .eq('id', conversationId)
      .maybeSingle();

    const dealId = (conversation as { deal_id?: string } | null)?.deal_id ?? null;
    if (!dealId) return;

    const { data: members } = await service
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .is('removed_at', null);

    const recipients = ((members ?? []) as { user_id: string }[])
      .map((row) => row.user_id)
      .filter((id) => id !== senderId);

    await notifyCollapsed(recipients, {
      kind: 'message_received',
      entityId: dealId,
      entityType: 'deal',
    });
  } catch (error) {
    console.error('[messages] could not notify the room', error);
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    await requireUser();
    await requireConversationMember(conversationId);

    const url = new URL(request.url);
    const query = listMessagesSchema.parse({
      before: url.searchParams.get('before') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    const page = await listMessages(conversationId, query);
    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    const user = await requireUser();
    await requireConversationMember(conversationId);
    await enforceRateLimit('sendMessage', user.id, conversationId);

    const { body } = await parseBody(request, sendMessageSchema);

    const supabase = await createClient();

    // `sender_id` is taken from the session, never from the request body.
    // Accepting it as input would make impersonation a matter of editing JSON —
    // and while the RLS policy would still refuse it, the API should not be
    // shaped so that the database is the only thing standing in the way.
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: user.id, body })
      .select('id, conversation_id, sender_id, body, created_at, edited_at')
      .single();

    if (error) throw error;

    // The audit entry and the realtime broadcast both come from database
    // triggers, so neither depends on this handler remembering to fire them.
    // The notification does, because it is a product decision rather than a
    // record: it collapses, it respects a preference, and neither of those
    // belongs in a trigger.
    await notifyConversation(conversationId, user.id);

    return NextResponse.json(
      {
        id: data.id,
        conversationId: data.conversation_id,
        senderId: data.sender_id,
        senderName: null,
        body: data.body,
        createdAt: data.created_at,
        editedAt: data.edited_at,
        isOwn: true,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
