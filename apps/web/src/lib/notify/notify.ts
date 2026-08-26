import 'server-only';

import {
  NOTIFICATION_CATEGORY,
  notificationCopy,
  notificationHref,
  type NotificationContext,
  type NotificationKind,
} from '@ib/core';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Telling somebody something happened.
 *
 * Written with the service role, and that is not a shortcut. The event that
 * produces a notification is usually visible to somebody who cannot see the
 * recipient — a buyer requesting an NDA notifies a seller they have never met,
 * and neither can read the other's `profiles` row at that moment. There is no
 * user connection that could write this.
 *
 * ## Failing silently, on purpose
 *
 * Every function here swallows its errors. Losing a notification is bad; failing
 * a buyer's NDA request because the notifications table was briefly unavailable
 * is worse, and it teaches people to retry until something works. Same reasoning
 * as `recordAuditEvent`, and the same line to wire to alerting.
 *
 * The consequence is that a caller cannot tell whether it worked, which is
 * correct: no product decision should depend on it.
 */

export interface NotifyOptions {
  recipientId: string;
  kind: NotificationKind;
  /** The listing, deal or task this concerns. Used to build the link. */
  entityId?: string | null;
  entityType?: string | null;
  context?: NotificationContext;
}

/**
 * One notification.
 *
 * The copy comes from `@ib/core` rather than from the caller. That is the whole
 * design: the call site has the listing and the buyer in scope, and a template
 * built there is one careless interpolation away from putting a company's legal
 * name in an email.
 */
export async function notify(options: NotifyOptions): Promise<void> {
  const copy = notificationCopy(options.kind, options.context);

  const service = createServiceRoleClient();

  const { data: inserted, error } = await service
    .from('notifications')
    .insert({
      recipient_id: options.recipientId,
      kind: options.kind,
      title: copy.title,
      body: copy.body,
      href: notificationHref(options.kind, options.entityId ?? null),
      entity_type: options.entityType ?? null,
      entity_id: options.entityId ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[notify] failed to record notification', {
      kind: options.kind,
      error: error.message,
    });
  }

  /*
   * The email, after the row.
   *
   * Deliberately awaited rather than fired and forgotten: a serverless function
   * that returns before its own promises settle simply loses them, and a
   * notification nobody receives is the failure this whole change exists to fix.
   * `deliverEmail` swallows everything and is bounded by an 8s transport
   * timeout, so the cost to the request is capped and the benefit is that it
   * actually happens.
   *
   * Imported here rather than at the top because deliver.ts imports wantsEmail
   * from this module, and the cycle is only a problem if it is resolved eagerly.
   */
  const { deliverEmail } = await import('./deliver');
  await deliverEmail({
    recipientId: options.recipientId,
    kind: options.kind,
    title: copy.title,
    body: copy.body,
    href: notificationHref(options.kind, options.entityId ?? null),
    notificationId: inserted?.id ?? null,
  });
}

/**
 * The same thing for several people.
 *
 * One statement rather than a loop, because the caller is usually a broadcast —
 * "a document was released to these four people" — and four round trips inside a
 * request handler is four chances to time out halfway and tell half of them.
 */
export async function notifyMany(
  recipientIds: readonly string[],
  options: Omit<NotifyOptions, 'recipientId'>,
): Promise<void> {
  const unique = [...new Set(recipientIds)].filter(Boolean);
  if (unique.length === 0) return;

  const copy = notificationCopy(options.kind, options.context);
  const href = notificationHref(options.kind, options.entityId ?? null);

  const service = createServiceRoleClient();

  const { error } = await service.from('notifications').insert(
    unique.map((recipientId) => ({
      recipient_id: recipientId,
      kind: options.kind,
      title: copy.title,
      body: copy.body,
      href,
      entity_type: options.entityType ?? null,
      entity_id: options.entityId ?? null,
    })),
  );

  if (error) {
    console.error('[notify] failed to record notifications', {
      kind: options.kind,
      recipients: unique.length,
      error: error.message,
    });
  }

  /*
   * One email each. Sequential rather than parallel: a broadcast to forty people
   * firing forty simultaneous requests is how a provider rate-limits an account,
   * and the notification row — the part that matters — is already written.
   */
  const { deliverEmails } = await import('./deliver');
  await deliverEmails(unique, {
    kind: options.kind,
    title: copy.title,
    body: copy.body,
    href,
  });
}

/**
 * The same, minus anybody who already has one waiting.
 *
 * For events that repeat. A deal room conversation produces forty messages in an
 * afternoon; forty notifications is not forty times as useful as one, it is an
 * inbox somebody turns off. So a recipient who has an unread notification of
 * this kind about this same thing is skipped — the one they already have still
 * points at the right place, and the count on the bell does not lie.
 *
 * Deliberately not a time window. "Unread" is the honest test of whether the
 * previous nudge did its job; five minutes is a guess about it.
 */
export async function notifyCollapsed(
  recipientIds: readonly string[],
  options: Omit<NotifyOptions, 'recipientId'>,
): Promise<void> {
  const unique = [...new Set(recipientIds)].filter(Boolean);
  if (unique.length === 0) return;

  const service = createServiceRoleClient();

  let pending = service
    .from('notifications')
    .select('recipient_id')
    .in('recipient_id', unique)
    .eq('kind', options.kind)
    .is('read_at', null);

  pending = options.entityId
    ? pending.eq('entity_id', options.entityId)
    : pending.is('entity_id', null);

  const { data, error } = await pending;

  if (error) {
    // Failing open. A duplicate notification is a small annoyance; silently
    // telling nobody because a read failed is the outcome this whole feature
    // exists to prevent.
    console.error('[notify] could not check for pending notifications', {
      kind: options.kind,
      error: error.message,
    });
    await notifyMany(unique, options);
    return;
  }

  const alreadyWaiting = new Set(
    ((data ?? []) as { recipient_id: string }[]).map((row) => row.recipient_id),
  );

  await notifyMany(
    unique.filter((id) => !alreadyWaiting.has(id)),
    options,
  );
}

/**
 * Whether this person wants this kind by email.
 *
 * Defaults to yes for somebody with no preferences row, which is the common
 * case and the right default: a marketplace where the first NDA request is
 * missed because notifications were opt-in has lost the one that mattered.
 *
 * Exported for the sender that does not exist yet. It is here rather than in the
 * sender because the rule — which switch governs which kind — belongs with the
 * kinds, and a sender written later should not get to reinvent it.
 */
export async function wantsEmail(recipientId: string, kind: NotificationKind): Promise<boolean> {
  const service = createServiceRoleClient();

  const { data } = await service
    .from('notification_preferences')
    .select('*')
    .eq('user_id', recipientId)
    .maybeSingle();

  if (!data) return true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preferences = data as Record<string, any>;

  switch (NOTIFICATION_CATEGORY[kind]) {
    case 'deal_activity':
      return preferences.email_deal_activity !== false;
    case 'new_matches':
      return preferences.email_new_matches !== false;
    case 'listing_status':
      return preferences.email_listing_status !== false;
    case 'messages':
      return preferences.email_messages !== false;
  }
}
