'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import type { MfaActionState, SessionSummary } from './types';

const revokeSchema = z.object({
  sessionId: z.string().uuid(),
});

/**
 * Reads the caller's own sessions.
 *
 * Goes through `list_my_sessions()`, a SECURITY DEFINER function filtered on
 * `auth.uid()`, rather than the service role. The app therefore never holds a
 * credential capable of reading anybody else's sessions in order to show
 * someone their own.
 */
export async function listSessions(): Promise<SessionSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_my_sessions');

  if (error || !data) return [];

  return (data as SessionRow[]).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.refreshed_at,
    userAgent: row.user_agent,
    ipAddress: row.ip,
    assuranceLevel: row.aal,
    isCurrent: row.is_current,
  }));
}

interface SessionRow {
  id: string;
  created_at: string;
  refreshed_at: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
  is_current: boolean;
}

export async function revokeSession(
  _prev: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const parsed = revokeSchema.safeParse({ sessionId: formData.get('sessionId') });
  if (!parsed.success) {
    return { error: 'Invalid request.', notice: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('revoke_session', {
    target_session_id: parsed.data.sessionId,
  });

  if (error) {
    return { error: 'Could not sign out that device.', notice: null };
  }

  // The function returns false when the id matched nothing the caller owns.
  // Reported as "no longer active" rather than "not yours", so the response
  // does not confirm whether a session id exists for somebody else.
  if (data !== true) {
    return { error: null, notice: 'That session is no longer active.' };
  }

  await recordAuditEvent({
    action: 'session.revoked',
    entityType: 'auth_session',
    entityId: parsed.data.sessionId,
  });

  revalidatePath('/settings/security');
  return { error: null, notice: 'Signed out on that device.' };
}

export async function revokeOtherSessions(): Promise<MfaActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('revoke_other_sessions');

  if (error) {
    return { error: 'Could not sign out the other devices.', notice: null };
  }

  const count = typeof data === 'number' ? data : 0;

  await recordAuditEvent({
    action: 'session.revoked_others',
    entityType: 'auth_session',
    metadata: { revoked: count },
  });

  revalidatePath('/settings/security');
  return {
    error: null,
    notice:
      count === 0
        ? 'No other sessions were active.'
        : `Signed out ${count} other ${count === 1 ? 'session' : 'sessions'}.`,
  };
}
