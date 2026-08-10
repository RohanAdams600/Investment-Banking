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
import { createClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{ conversationId: string }>;
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
