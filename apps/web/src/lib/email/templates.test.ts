import { describe, expect, it } from 'vitest';

import { brand } from '@ib/core';

import { escapeHtml, notificationEmail } from './templates';

/**
 * What every commercial email must carry.
 *
 * CAN-SPAM's requirements are short and absolute: a physical postal address and
 * a working opt-out in every message. Neither is a design preference and neither
 * survives a redesign by accident, so both are asserted here.
 *
 * The wording of the copy is not tested — that lives in `@ib/core` and is
 * covered there. What is tested is the envelope around it.
 */

const base = {
  title: 'A buyer has requested access',
  body: 'Review who they are before deciding.',
  href: '/listings/abc',
  category: 'deal_activity',
  unsubscribeToken: '11111111-2222-3333-4444-555555555555',
};

describe('notification email', () => {
  it('carries a physical mailing address in both parts', () => {
    // The requirement that is easiest to lose and least visible when it is gone.
    const mail = notificationEmail(base);
    expect(mail.text).toContain(brand.mailingAddress);
    expect(mail.html).toContain(brand.mailingAddress);
  });

  it('carries an unsubscribe link in both parts', () => {
    const mail = notificationEmail(base);
    expect(mail.text).toContain(base.unsubscribeToken);
    expect(mail.html).toContain(base.unsubscribeToken);
    expect(mail.text).toMatch(/unsubscribe\?t=/);
  });

  it('scopes the opt-out to one category', () => {
    // "Stop emailing me about new matches" and "stop emailing me entirely" are
    // different requests. Treating them as one gets you the second.
    const mail = notificationEmail({ ...base, category: 'new_matches' });
    expect(mail.text).toContain('c=new_matches');
    expect(mail.text).toMatch(/new matches/);
  });

  it('builds absolute links, because an inbox has no base URL', () => {
    const mail = notificationEmail(base);
    expect(mail.text).toContain(`${brand.url.replace(/\/$/, '')}/listings/abc`);
    expect(mail.text).not.toMatch(/href="\/listings/);
  });

  it('works as plain text alone', () => {
    /*
     * Half of the people this product is for read mail in Outlook with images
     * and styles stripped. A message whose meaning only survives in the HTML is
     * a blank rectangle to them.
     */
    const mail = notificationEmail(base);
    expect(mail.text).toContain(base.title);
    expect(mail.text).toContain(base.body);
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });

  it('handles a notification with no body', () => {
    const mail = notificationEmail({ ...base, body: null });
    expect(mail.text).toContain(base.title);
    expect(mail.html).toContain(base.title);
  });

  it('escapes anything that reaches the HTML', () => {
    /*
     * Defence in depth. `notificationCopy()` allows no variable but a count, so
     * no user content should reach here at all — but "no user content reaches
     * here" is a property of a different module that somebody could change, and
     * this is the file where changing it would matter.
     */
    const mail = notificationEmail({
      ...base,
      title: '<script>alert(1)</script>',
      body: 'Tom & Jerry\'s "deal"',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&amp;');
    expect(mail.html).toContain('&quot;');
  });

  it('escapes the five characters that change meaning', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('does not put the unsubscribe token in the subject', () => {
    // Subjects end up in notification previews, screenshots and support tickets.
    const mail = notificationEmail(base);
    expect(mail.subject).not.toContain(base.unsubscribeToken);
    expect(mail.subject).toBe(base.title);
  });
});
