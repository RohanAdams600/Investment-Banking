import { NextResponse } from 'next/server';

import { getConversationMembership } from '@/features/messaging/authorization';
import { listConversations } from '@/features/messaging/queries';
import {
  enforceRateLimit,
  parseBody,
  requireUser,
  toErrorResponse,
} from '@/features/messaging/route-helpers';
import { createConversationSchema, uuidSchema } from '@/features/messaging/validation';
import { recordAuditEvent } from '@/lib/audit';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{ dealId: string }>;
}

/**
 * Conversations in a deal that the caller can actually see.
 *
 * No membership check here beyond the session: the SELECT policy on
 * `deal_conversations` already limits rows to rooms the caller sits in, so a
 * deal they are not part of returns an empty list rather than an error.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const dealId = uuidSchema.parse((await params).dealId);
    await requireUser();

    return NextResponse.json({ conversations: await listConversations(dealId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Create a conversation in a deal.
 *
 * There is no INSERT policy or grant on `deal_conversations`, so this is one of
 * the few places the service role is used. The authorization it replaces is
 * done here explicitly: the caller must already be a banker or admin in some
 * conversation on this deal.
 *
 * That rule leaves a bootstrap gap — the first conversation on a brand-new deal
 * has no prior room to be a banker in. Opening a deal is an internal operation
 * that will arrive with the deal-creation flow, and it seeds the first room and
 * its banker together. Until then the first conversation is seeded server-side,
 * the same way the first `admin` role is.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const dealId = uuidSchema.parse((await params).dealId);
    const user = await requireUser();
    await enforceRateLimit('membershipChange', user.id, dealId);

    const input = await parseBody(request, createConversationSchema);

    // Read as the caller, so RLS decides which conversations they can see.
    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from('deal_conversations')
      .select('id')
      .eq('deal_id', dealId);

    if (readError) throw readError;

    let canCreate = false;
    for (const row of existing ?? []) {
      const membership = await getConversationMembership(row.id as string);
      if (membership.canAdminister) {
        canCreate = true;
        break;
      }
    }

    if (!canCreate) {
      // 404 rather than 403: a deal the caller has no room in should not be
      // confirmed to exist.
      return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });
    }

    // Privileged from here. The check above is what authorises it.
    const service = createServiceRoleClient();

    const { data: conversation, error: insertError } = await service
      .from('deal_conversations')
      .insert({ deal_id: dealId, name: input.name, type: input.type, created_by: user.id })
      .select('id, deal_id, name, type, created_at')
      .single();

    if (insertError) throw insertError;

    // The creator joins as banker in the same request. A conversation with no
    // members is invisible to everyone including its author, since every policy
    // keys on membership.
    const { error: memberError } = await service.from('conversation_members').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'banker',
      added_by: user.id,
    });

    if (memberError) throw memberError;

    await recordAuditEvent({
      action: 'conversation.created',
      entityType: 'deal_conversation',
      entityId: conversation.id as string,
      metadata: { deal_id: dealId, type: input.type },
    });

    return NextResponse.json(
      {
        id: conversation.id,
        dealId: conversation.deal_id,
        name: conversation.name,
        type: conversation.type,
        createdAt: conversation.created_at,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
