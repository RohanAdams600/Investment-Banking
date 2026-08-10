import { NextResponse } from 'next/server';

import { requireConversationMember } from '@/features/messaging/authorization';
import { listMembers } from '@/features/messaging/queries';
import {
  enforceRateLimit,
  parseBody,
  requireUser,
  toErrorResponse,
} from '@/features/messaging/route-helpers';
import { addMemberSchema, removeMemberSchema, uuidSchema } from '@/features/messaging/validation';
import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

/** Any active member may see who else is in the room. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    await requireUser();
    await requireConversationMember(conversationId);

    return NextResponse.json({ members: await listMembers(conversationId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Add a member. Bankers and admins only.
 *
 * Widening a deal room is a disclosure decision about somebody else's
 * confidential information, which is why a buyer sitting in the room cannot do
 * it however convenient that would be.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    const user = await requireUser();
    await requireConversationMember(conversationId, { administer: true });
    await enforceRateLimit('membershipChange', user.id, conversationId);

    const { userId, role } = await parseBody(request, addMemberSchema);

    const supabase = await createClient();

    // Upsert rather than insert: a previously removed member has a row with
    // `removed_at` set, and re-adding them clears it. A plain insert would hit
    // the primary key and fail for exactly the person most likely to be
    // re-added.
    const { error } = await supabase.from('conversation_members').upsert(
      {
        conversation_id: conversationId,
        user_id: userId,
        role,
        added_by: user.id,
        removed_at: null,
        removed_by: null,
      },
      { onConflict: 'conversation_id,user_id' },
    );

    if (error) throw error;

    await recordAuditEvent({
      action: 'conversation.member_added',
      entityType: 'deal_conversation',
      entityId: conversationId,
      metadata: { member: userId, role },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Remove a member.
 *
 * Sets `removed_at` rather than deleting the row, so the record of who could
 * read this room, and when, survives — which is the question that gets asked
 * when a confidentiality dispute arises.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    const user = await requireUser();
    await requireConversationMember(conversationId, { administer: true });
    await enforceRateLimit('membershipChange', user.id, conversationId);

    const { userId } = await parseBody(request, removeMemberSchema);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('conversation_members')
      .update({ removed_at: new Date().toISOString(), removed_by: user.id })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .select('user_id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'That person is not in this conversation.' },
        { status: 404 },
      );
    }

    await recordAuditEvent({
      action: 'conversation.member_removed',
      entityType: 'deal_conversation',
      entityId: conversationId,
      metadata: { member: userId },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
