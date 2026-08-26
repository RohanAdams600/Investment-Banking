import 'server-only';

import { brand, isBrandFullyConfigured } from '@ib/core';

/**
 * Sending an email.
 *
 * ## It refuses when the brand is not configured
 *
 * `BRAND_MAILING_ADDRESS` and `BRAND_SUPPORT_EMAIL` have been launch-blocking
 * since the brand module was written, on the grounds that a placeholder in a
 * footer is a wrong disclosure rather than an untidy one. Until now that was a
 * warning badge somebody could ignore.
 *
 * A commercial email with no physical postal address is the CAN-SPAM violation,
 * not a rough edge. So the check moves from advisory to enforced at exactly the
 * point it starts to matter: this module will not send at all until the address
 * is real. Failing to send is recoverable. Sending a hundred non-compliant
 * emails is not.
 *
 * ## Unconfigured is silent, not broken
 *
 * With no provider key, `send()` reports `skipped` rather than throwing. A
 * developer running locally should not have signups fail because they have no
 * mail provider, and the delivery log records the skip so nobody later wonders
 * whether it went out.
 */

export type SendOutcome =
  | { outcome: 'sent'; providerMessageId: string | null }
  | { outcome: 'skipped'; detail: string }
  | { outcome: 'failed'; detail: string };

export interface Envelope {
  to: string;
  subject: string;
  /** The message. Plain text is the source of truth; the HTML is derived. */
  text: string;
  html: string;
}

function apiKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  return key && key.trim() !== '' ? key : null;
}

/**
 * The From address.
 *
 * Deliberately built from the configured support address rather than a separate
 * variable. One fewer thing to set, and it means replies reach a mailbox
 * somebody reads — a no-reply address on a platform handling the sale of a
 * business is an invitation to be ignored.
 */
function fromAddress(): string {
  return `${brand.name} <${brand.supportEmail}>`;
}

export function isEmailConfigured(): boolean {
  return apiKey() !== null && isBrandFullyConfigured;
}

/** Why sending is unavailable, for the delivery log and for preflight. */
export function emailUnavailableReason(): string | null {
  if (!isBrandFullyConfigured) {
    return 'Brand is not fully configured. A commercial email needs a real support address and a physical mailing address before it may be sent.';
  }
  if (!apiKey()) return 'No RESEND_API_KEY, so nothing is sent.';
  return null;
}

export async function send(envelope: Envelope): Promise<SendOutcome> {
  const unavailable = emailUnavailableReason();
  if (unavailable) return { outcome: 'skipped', detail: unavailable };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [envelope.to],
        subject: envelope.subject,
        text: envelope.text,
        html: envelope.html,
      }),
      /*
       * Bounded, because this runs inside a request that a person is waiting on.
       * A provider having a slow morning must not turn into a buyer watching a
       * spinner while their NDA request hangs.
       */
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        outcome: 'failed',
        detail: `Provider returned ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    return { outcome: 'sent', providerMessageId: data?.id ?? null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown transport failure.';
    return { outcome: 'failed', detail: detail.slice(0, 300) };
  }
}
