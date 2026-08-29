'use server';

import { revalidatePath } from 'next/cache';
import { VERIFICATION_VALID_DAYS } from '@ib/core';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * Submitting funding evidence, and deciding on it.
 *
 * ## Everything goes through the caller's own client
 *
 * No service role anywhere in this file. The trigger on `buyer_verifications`
 * is what stops a buyer approving themselves and an operator rewriting a
 * buyer's claim, and it reads `auth.uid()` — a privileged client would carry no
 * session, take the buyer branch, and be refused for the wrong reason.
 *
 * ## The reviewer is a person
 *
 * There is no automatic approval path here and there must not be one. A status
 * a machine awards is a status a buyer can engineer, and a seller reads this
 * badge as evidence that somebody looked.
 */

export interface VerificationState {
  error: string | null;
  ok: boolean;
}

export const emptyVerificationState: VerificationState = { error: null, ok: false };

const EVIDENCE_KINDS = [
  'cash',
  'sba_preapproval',
  'lender_commitment',
  'committed_fund',
  'search_fund',
  'seller_financing_sought',
  'other',
] as const;

const CAPACITY_BANDS = [
  'under_250k',
  'from_250k_to_1m',
  'from_1m_to_5m',
  'from_5m_to_25m',
  'over_25m',
] as const;

const submitSchema = z.object({
  evidenceKind: z.enum(EVIDENCE_KINDS),
  capacityBand: z.enum(CAPACITY_BANDS),
  evidenceNote: z
    .string()
    .trim()
    .max(2000, 'Keep this under 2000 characters.')
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * Create or correct the caller's own submission.
 *
 * Upserts on `buyer_id`, which is unique. A buyer editing a pending submission
 * and a buyer submitting for the first time are the same action from their side
 * of it, and the trigger already refuses an edit once a decision has been made.
 */
export async function submitVerification(
  _state: VerificationState,
  formData: FormData,
): Promise<VerificationState> {
  if (!isSupabaseConfigured()) {
    return { error: 'Verification is unavailable — the database is not configured.', ok: false };
  }

  const parsed = submitSchema.safeParse({
    evidenceKind: formData.get('evidenceKind'),
    capacityBand: formData.get('capacityBand'),
    evidenceNote: formData.get('evidenceNote'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.', ok: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to submit verification.', ok: false };

  /*
   * A person submits this once and corrects it perhaps twice. A client looping
   * on it is either broken or probing the trigger for which columns it will
   * accept, and neither is worth serving at speed.
   */
  const budget = await checkRateLimit('verificationSubmission', user.id);
  if (!budget.allowed) {
    return { error: 'That has been submitted too many times. Try again later.', ok: false };
  }

  const { error } = await supabase.from('buyer_verifications').upsert(
    {
      buyer_id: user.id,
      evidence_kind: parsed.data.evidenceKind,
      capacity_band: parsed.data.capacityBand,
      evidence_note: parsed.data.evidenceNote,
    },
    { onConflict: 'buyer_id' },
  );

  if (error) {
    // The trigger's message is written for a person and is more useful than
    // anything this layer could substitute for it.
    return { error: error.message, ok: false };
  }

  revalidatePath('/settings/verification');
  return { error: null, ok: true };
}

/** Withdraw a submission. The one status change a buyer may make about themselves. */
export async function withdrawVerification(
  _state: VerificationState,
  _formData: FormData,
): Promise<VerificationState> {
  if (!isSupabaseConfigured()) {
    return { error: 'Verification is unavailable — the database is not configured.', ok: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to withdraw.', ok: false };

  const { error } = await supabase
    .from('buyer_verifications')
    .update({ status: 'withdrawn' })
    .eq('buyer_id', user.id);

  if (error) return { error: error.message, ok: false };

  revalidatePath('/settings/verification');
  return { error: null, ok: true };
}

const decideSchema = z.object({
  buyerId: z.string().uuid(),
  decision: z.enum(['verified', 'rejected']),
  reviewNote: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * An operator's decision.
 *
 * `reviewed_by` and `reviewed_at` are not sent — the trigger takes them from
 * the session, so a decision cannot be recorded against another operator no
 * matter what this action posts.
 */
export async function decideVerification(
  _state: VerificationState,
  formData: FormData,
): Promise<VerificationState> {
  if (!isSupabaseConfigured()) {
    return { error: 'Verification is unavailable — the database is not configured.', ok: false };
  }

  const parsed = decideSchema.safeParse({
    buyerId: formData.get('buyerId'),
    decision: formData.get('decision'),
    reviewNote: formData.get('reviewNote'),
  });

  if (!parsed.success) {
    return { error: 'That decision could not be recorded.', ok: false };
  }

  const supabase = await createClient();

  /*
   * An expiry is required on a verified row by a check constraint, and it is
   * set here rather than offered as a field. A reviewer choosing how long their
   * own review stands is a reviewer who will eventually choose "forever".
   */
  const expiresAt =
    parsed.data.decision === 'verified'
      ? new Date(Date.now() + VERIFICATION_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const { error } = await supabase
    .from('buyer_verifications')
    .update({
      status: parsed.data.decision,
      review_note: parsed.data.reviewNote,
      expires_at: expiresAt,
    })
    .eq('buyer_id', parsed.data.buyerId);

  if (error) return { error: error.message, ok: false };

  revalidatePath('/admin/funding');
  return { error: null, ok: true };
}
