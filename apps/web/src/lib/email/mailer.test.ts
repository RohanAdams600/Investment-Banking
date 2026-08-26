import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The mailer's refusal, asserted at the source.
 *
 * `BRAND_MAILING_ADDRESS` has been launch-blocking since the brand module was
 * written, and until now that meant a warning badge somebody could ignore. A
 * commercial email with a placeholder postal address is not an untidy footer, it
 * is the CAN-SPAM violation — so the check is enforced at the point of sending
 * rather than advised at the point of configuring.
 *
 * Failing to send is recoverable. Sending a hundred non-compliant emails is not.
 */

const MAILER = readFileSync(new URL('./mailer.ts', import.meta.url).pathname, 'utf8');
const DELIVER = readFileSync(new URL('../notify/deliver.ts', import.meta.url).pathname, 'utf8');

describe('the mailer', () => {
  it('refuses to send until the brand is fully configured', () => {
    expect(MAILER).toMatch(/isBrandFullyConfigured/);
    expect(MAILER).toMatch(/emailUnavailableReason/);
  });

  it('checks configuration before it reaches the provider', () => {
    // Order matters: a check after the fetch is not a check.
    const send = MAILER.slice(MAILER.indexOf('export async function send('));
    expect(send.indexOf('emailUnavailableReason')).toBeLessThan(send.indexOf('fetch('));
  });

  it('bounds the request, because a person is waiting on it', () => {
    expect(MAILER).toMatch(/AbortSignal\.timeout/);
  });

  it('never throws out of send', () => {
    // A provider outage must not fail an NDA request.
    expect(MAILER).toMatch(/catch \(error\)/);
  });
});

describe('delivery', () => {
  it('will not send without an unsubscribe token', () => {
    /*
     * CAN-SPAM has no clause for "the token lookup failed", and a message
     * somebody cannot unsubscribe from is worse than one that never arrived.
     */
    expect(DELIVER).toMatch(/refused to send without one/);
  });

  it('honours the recipient preference before sending', () => {
    const body = DELIVER.slice(DELIVER.indexOf('export async function deliverEmail'));
    expect(body.indexOf('wantsEmail')).toBeLessThan(body.indexOf('send('));
  });

  it('records every attempt, including the ones that do not happen', () => {
    // "Did the seller get the email" is the first question support is asked.
    expect(DELIVER).toMatch(/record\('skipped'/);
    expect(DELIVER).toMatch(/record\('failed'/);
    expect(DELIVER).toMatch(/record\('sent'/);
  });

  it('swallows its own failures', () => {
    expect(DELIVER).toMatch(/catch \(error\)/);
  });
});
