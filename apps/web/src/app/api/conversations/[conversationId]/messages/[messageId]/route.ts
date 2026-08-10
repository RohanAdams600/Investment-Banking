import { NextResponse } from 'next/server';

import { requireConversationMember } from '@/features/messaging/authorization';
import {
  enforceRateLimit,
  parseBody,
  requireUser,
  toErrorResponse,
} from '@/features/messaging/route-helpers';
import { messageBodySchema, uuidSchema } from '@/features/messaging/validation';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ conversationId: string; messageId: string }>;
}

const patchSchema = z.object({ body: messageBodySchema });

/** Edit. Only the sender's own message; the policy and a trigger both enforce it. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { conversationId: rawConversation, messageId: rawMessage } = await params;
    const conversationId = uuidSchema.parse(rawConversation);
    const messageId = uuidSchema.parse(rawMessage);

    const user = await requireUser();
    await requireConversationMember(conversationId);
    await enforceRateLimit('editMessage', user.id, conversationId);

    const { body } = await parseBody(request, patchSchema);

    const supabase = await createClient();

    // The `sender_id` filter is redundant with the RLS policy and kept anyway:
    // it makes the intent legible at the call site, and it means a future
    // policy change cannot quietly widen what this route does.
    const { data, error } = await supabase
      .from('messages')
      .update({ body })
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .eq('sender_id', user.id)
      .select('id, body, edited_at')
      .maybeSingle();

    if (error) throw error;

    // Nothing matched: the message is not theirs, is withdrawn, or does not
    // exist. Reported the same way for all three, so the response does not
    // confirm which.
    if (!data) {
      return NextResponse.json({ error: 'Message not found.' }, { status: 404 });
    }

    return NextResponse.json({ id: data.id, body: data.body, editedAt: data.edited_at });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Withdraw.
 *
 * Goes through `withdraw_message()` rather than an UPDATE, because the SELECT
 * policy requires `deleted_at is null` and Postgres checks that policy against
 * the *new* row — so a client-side soft delete produces a row the author could
 * not see and is refused. See the note in 0012_messaging_rls.sql.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { conversationId: rawConversation, messageId: rawMessage } = await params;
    const conversationId = uuidSchema.parse(rawConversation);
    const messageId = uuidSchema.parse(rawMessage);

    const user = await requireUser();
    await requireConversationMember(conversationId);
    await enforceRateLimit('editMessage', user.id, conversationId);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('withdraw_message', {
      target_message_id: messageId,
    });

    if (error) throw error;

    if (data !== true) {
      return NextResponse.json({ error: 'Message not found.' }, { status: 404 });
    }

    // The audit entry comes from the trigger on the underlying update.
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
