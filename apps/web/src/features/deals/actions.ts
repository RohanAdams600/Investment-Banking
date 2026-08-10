'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import type { DealActionState } from './types';

/**
 * Opening a deal.
 *
 * Goes through `create_deal()` rather than inserting, because the deal, its
 * first conversation and the creator's membership have to exist together — a
 * deal without a room, or a room without a member, is invisible to everybody
 * including its author. The function also re-checks authorisation, so this
 * action is convenience rather than the control.
 */
const createDealSchema = z.object({
  name: z.string().trim().min(1, 'Give the deal a name.').max(200),
  conversationName: z.string().trim().min(1).max(200).default('Buyer and seller'),
  conversationType: z.enum(['buyer_seller', 'internal', 'diligence']).default('buyer_seller'),
  firmId: z.string().uuid().optional().nullable(),
});

export async function createDeal(
  _prev: DealActionState,
  formData: FormData,
): Promise<DealActionState> {
  const firmId = formData.get('firmId');

  const parsed = createDealSchema.safeParse({
    name: formData.get('name'),
    conversationName: formData.get('conversationName') || undefined,
    conversationType: formData.get('conversationType') || undefined,
    firmId: typeof firmId === 'string' && firmId !== '' ? firmId : null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the values entered.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to open a deal.' };

  const limit = await checkRateLimit('membershipChange', user.id);
  if (!limit.allowed) {
    return { error: 'Too many deals opened just now. Try again shortly.' };
  }

  const { data, error } = await supabase.rpc('create_deal', {
    deal_name: parsed.data.name,
    first_conversation_name: parsed.data.conversationName,
    conversation_kind: parsed.data.conversationType,
    owning_firm_id: parsed.data.firmId,
  });

  if (error) {
    // The function raises 42501 with a readable message for the two cases a
    // user can actually act on — wrong role, or a firm they do not belong to.
    // Anything else is not theirs to debug.
    const message =
      error.code === '42501' ? error.message.replace(/^.*?:\s*/, '') : 'Could not open that deal.';
    return { error: message };
  }

  await recordAuditEvent({
    action: 'deal.created',
    entityType: 'deal',
    entityId: data as string,
    firmId: parsed.data.firmId,
  });

  redirect(`/deals/${data as string}/messages`);
}
