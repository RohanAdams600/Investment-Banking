import 'server-only';

import { headers } from 'next/headers';

import { createClient, createServiceRoleClient } from './supabase/server';

/**
 * Writes to the platform audit log.
 *
 * Uses the service role, because `authenticated` has no INSERT grant on
 * `audit_log` and must not have one — a client that can write the audit log can
 * forge history, and a forgeable audit log is worse than none because it looks
 * like evidence.
 *
 * The actor is read from the session rather than accepted as an argument, so a
 * caller cannot attribute an action to somebody else.
 */

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  firmId?: string | null;
  /**
   * Context. Never put document contents, financial statement bodies,
   * credentials, tokens, or message bodies in here — this table is broadly
   * readable by admins and is exported.
   */
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requestHeaders = await headers();

  // `x-forwarded-for` is a list; the client address is the first entry. Behind
  // Vercel this is set by the platform, but it is still attacker-influenced on
  // a self-hosted deployment, so it is recorded as a hint, never trusted as an
  // access-control input.
  const forwardedFor = requestHeaders.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || null;

  const service = createServiceRoleClient();

  const { error } = await service.from('audit_log').insert({
    actor_user_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    firm_id: event.firmId ?? null,
    metadata: event.metadata ?? {},
    ip_address: ip,
    user_agent: requestHeaders.get('user-agent'),
  });

  if (error) {
    // Deliberately not rethrown. A failed audit write must not roll back the
    // user's action — losing the record is bad, but failing a document upload
    // because the log was briefly unavailable is worse, and the alternative
    // trains people to retry until it works.
    //
    // This is the line to wire to alerting: a silent gap in the audit log is
    // exactly what an incident review will need and not find.
    console.error('[audit] failed to record event', {
      action: event.action,
      entityType: event.entityType,
      error: error.message,
    });
  }
}
