'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import {
  STEP_UP_ACTIONS,
  StepUpRequiredError,
  requireStepUp,
  stepUpPrompt,
} from '@/lib/auth/assurance';
import { createClient } from '@/lib/supabase/server';
import type { MfaActionState } from './types';

/**
 * Multi-factor enrolment, backed by Supabase Auth's TOTP factors.
 *
 * Enrolment is a three-step handshake and it matters that it is:
 *
 *   1. `enroll` creates an **unverified** factor and returns the secret and a
 *      QR code.
 *   2. The user scans it and types a code from their authenticator.
 *   3. `challenge` + `verify` proves the clock and secret agree, and only then
 *      does the factor become active.
 *
 * Skipping step 3 and marking the factor active on enrolment would lock people
 * out of their accounts whenever a QR scan silently failed. The unverified
 * factor is deliberately left in place on a failed verification so the user can
 * retry with the same secret rather than rescanning.
 */

const verifySchema = z.object({
  factorId: z.string().uuid('That enrolment is no longer valid. Start again.'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});

const unenrollSchema = z.object({
  factorId: z.string().uuid(),
});

export interface EnrollResult {
  factorId: string;
  /** `otpauth://` URI as an SVG data URL, for rendering the QR code. */
  qrCode: string;
  /** The shared secret, for manual entry when a camera is unavailable. */
  secret: string;
  error: string | null;
}

export async function beginMfaEnrollment(): Promise<EnrollResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    // Shown in the authenticator app's account list.
    friendlyName: `Authenticator (${new Date().toISOString().slice(0, 10)})`,
  });

  if (error || !data) {
    return {
      factorId: '',
      qrCode: '',
      secret: '',
      error: error?.message ?? 'Could not start enrolment.',
    };
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    error: null,
  };
}

export async function verifyMfaEnrollment(
  _prev: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const parsed = verifySchema.safeParse({
    factorId: formData.get('factorId'),
    code: formData.get('code'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.', notice: null };
  }

  const supabase = await createClient();

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });

  if (challengeError || !challenge) {
    return { error: 'Could not verify that code. Start enrolment again.', notice: null };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });

  if (verifyError) {
    // The unverified factor is left in place on purpose so the user can retry
    // with the same secret instead of rescanning the QR code.
    return {
      error: 'That code was not accepted. Check your device clock and try again.',
      notice: null,
    };
  }

  await recordAuditEvent({
    action: 'mfa.enrolled',
    entityType: 'auth_factor',
    entityId: parsed.data.factorId,
  });

  revalidatePath('/settings/security');
  return { error: null, notice: 'Two-factor authentication is on.' };
}

export async function unenrollMfa(
  _prev: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const parsed = unenrollSchema.safeParse({ factorId: formData.get('factorId') });
  if (!parsed.success) {
    return { error: 'Invalid request.', notice: null };
  }

  const supabase = await createClient();

  /*
   * Removing a second factor is exactly the action an attacker with a stolen
   * session would want, so it requires that the current session actually *used*
   * the second factor — not merely that the account has one.
   *
   * Through `requireStepUp` rather than the inline check this used to carry.
   * Two copies of "did this session complete a challenge" is one copy too many,
   * and it is a rule easy to write backwards: `nextLevel` says the account has
   * MFA enrolled, which a stolen session's account also does.
   *
   * This is the one call site that blocks unconditionally, and correctly —
   * somebody with no second factor has nothing to remove.
   */
  try {
    await requireStepUp(STEP_UP_ACTIONS.mfaRemoval);
  } catch (thrown) {
    if (thrown instanceof StepUpRequiredError) {
      return { error: stepUpPrompt(STEP_UP_ACTIONS.mfaRemoval), notice: null };
    }
    throw thrown;
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  if (error) {
    return { error: 'Could not remove that factor.', notice: null };
  }

  await recordAuditEvent({
    action: 'mfa.unenrolled',
    entityType: 'auth_factor',
    entityId: parsed.data.factorId,
  });

  revalidatePath('/settings/security');
  return { error: null, notice: 'Two-factor authentication removed.' };
}
