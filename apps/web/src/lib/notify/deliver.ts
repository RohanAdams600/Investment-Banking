import 'server-only';

import { NOTIFICATION_CATEGORY, type NotificationKind } from '@ib/core';

import { emailUnavailableReason, isEmailConfigured, send } from '@/lib/email/mailer';
import { notificationEmail } from '@/lib/email/templates';
import { createServiceRoleClient } from '@/lib/supabase/server';

import { wantsEmail } from './notify';

/**
 * Getting a notification out of the database and into an inbox.
 *
 * ## Why this is separate from `notify()`
 *
 * Writing the row and sending the email fail differently and matter differently.
 * The row is the record — losing it loses the fact that something happened. The
 * email is a courtesy that a provider outage can take away without anybody being
 * worse off than they were last week.
 *
 * So `notify()` stays as it was, and this runs after it. It swallows everything
 * for the same reason `notify()` does: no product decision should hang on
 * whether an email provider was reachable, and a buyer whose NDA request fails
 * because a mailbox bounced will simply click again.
 *
 * ## Every attempt is logged, including the ones that do not happen
 *
 * "Did the seller get the email" is the first question support is asked. An
 * operator should be able to answer it without a provider dashboard, and
 * "skipped because they opted out" is as much of an answer as "sent".
 */

interface DeliverInput {
  recipientId: string;
  kind: NotificationKind;
  title: string;
  /** Some kinds are a title alone — the copy module allows it. */
  body: string | null;
  href: string | null;
  notificationId?: string | null;
}

export async function deliverEmail(input: DeliverInput): Promise<void> {
  const service = createServiceRoleClient();
  const category = NOTIFICATION_CATEGORY[input.kind];

  const record = async (
    outcome: 'sent' | 'failed' | 'skipped',
    detail: string | null,
    providerMessageId: string | null = null,
  ): Promise<void> => {
    // Swallowed: a delivery log that fails must not turn into a failed request.
    // The console line is what an operator would actually chase.
    const { error } = await service.from('email_deliveries').insert({
      recipient_id: input.recipientId,
      notification_id: input.notificationId ?? null,
      kind: input.kind,
      outcome,
      detail,
      provider_message_id: providerMessageId,
    });
    if (error) console.error('[deliver] could not record delivery', error.message);
  };

  try {
    const unavailable = emailUnavailableReason();
    if (unavailable) {
      await record('skipped', unavailable);
      return;
    }

    if (!(await wantsEmail(input.recipientId, input.kind))) {
      await record('skipped', `Recipient has opted out of ${category} emails.`);
      return;
    }

    const [address, token] = await Promise.all([
      emailFor(input.recipientId),
      unsubscribeToken(input.recipientId),
    ]);

    if (!address) {
      await record('skipped', 'No email address on the account.');
      return;
    }
    if (!token) {
      /*
       * No opt-out link means no send. CAN-SPAM does not have a clause for
       * "the token lookup failed", and a message somebody cannot unsubscribe
       * from is worse than a message that never arrived.
       */
      await record('failed', 'Could not mint an unsubscribe token; refused to send without one.');
      return;
    }

    const envelope = notificationEmail({
      title: input.title,
      body: input.body,
      href: input.href,
      category,
      unsubscribeToken: token,
    });

    const result = await send({ ...envelope, to: address });

    if (result.outcome === 'sent') {
      await record('sent', null, result.providerMessageId);
    } else {
      await record(result.outcome, result.detail);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown failure.';
    console.error('[deliver] email delivery failed', { kind: input.kind, detail });
    await record('failed', detail.slice(0, 500));
  }
}

/** Several recipients, one at a time. */
export async function deliverEmails(
  recipientIds: readonly string[],
  input: Omit<DeliverInput, 'recipientId'>,
): Promise<void> {
  if (!isEmailConfigured()) {
    // Still logged, per recipient, so a quiet day is distinguishable from a
    // broken one when somebody looks later.
    await Promise.all(recipientIds.map((recipientId) => deliverEmail({ ...input, recipientId })));
    return;
  }

  for (const recipientId of recipientIds) {
    await deliverEmail({ ...input, recipientId });
  }
}

/**
 * The recipient's address.
 *
 * From `auth.users` with the service role, because the sender is nobody: the
 * person being told about an event usually cannot be read by the person who
 * caused it, which is the same reason `notify()` writes with the service role.
 */
async function emailFor(userId: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

async function unsubscribeToken(userId: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data, error } = await service.rpc('unsubscribe_token_for', { target_user: userId });
  if (error || !data) return null;
  return typeof data === 'string' ? data : null;
}
