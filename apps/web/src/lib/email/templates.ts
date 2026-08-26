import 'server-only';

import { brand } from '@ib/core';

import type { Envelope } from './mailer';

/**
 * What a notification email looks like.
 *
 * ## Why there is almost nothing in here
 *
 * The copy comes from `notificationCopy()` in `@ib/core`, where the only
 * variable a message may carry is a count. That is 0026's design and it pays off
 * exactly here: no company name, no buyer's name, no listing headline ever
 * reaches this file, so an email cannot leak the confidential half of a listing
 * by templating enthusiasm.
 *
 * It also means the escaping below is defence in depth rather than the only
 * thing standing between a seller's legal name and an inbox. It is still done,
 * because "no user content reaches here" is a property of another module that
 * somebody could change.
 *
 * ## Plain text is the source of truth
 *
 * The HTML is generated from the same strings. A layout that only works in HTML
 * is a layout that half of business owners — who read mail in Outlook with
 * images off — will see as a blank rectangle.
 */

const CATEGORY_LABELS: Record<string, string> = {
  deal_activity: 'deal activity',
  new_matches: 'new matches',
  listing_status: 'listing updates',
  messages: 'messages',
};

export interface NotificationEmailInput {
  title: string;
  body: string | null;
  /** Path within the site, e.g. `/listings/abc`. Never an absolute URL. */
  href: string | null;
  category: string;
  unsubscribeToken: string;
}

/** Escapes the five characters that can change the meaning of HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Everything but the recipient.
 *
 * The address is supplied by the sender, which is the only place that knows it —
 * this module deliberately never sees who the message is for.
 */
export function notificationEmail(input: NotificationEmailInput): Omit<Envelope, 'to'> {
  const site = brand.url.replace(/\/$/, '');
  const link = input.href ? `${site}${input.href}` : site;
  const unsubscribe = `${site}/unsubscribe?t=${encodeURIComponent(input.unsubscribeToken)}&c=${encodeURIComponent(input.category)}`;
  const categoryLabel = CATEGORY_LABELS[input.category] ?? 'these';

  const text = [
    input.title,
    ...(input.body ? ['', input.body] : []),
    '',
    link,
    '',
    '—',
    `${brand.legalName}`,
    brand.mailingAddress,
    '',
    `Stop receiving emails about ${categoryLabel}: ${unsubscribe}`,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#151C28;max-width:520px;margin:0 auto;padding:24px">
  <p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5B6675;margin:0 0 20px">${escapeHtml(brand.name)}</p>
  <h1 style="font-size:19px;font-weight:600;margin:0 0 12px;line-height:1.3">${escapeHtml(input.title)}</h1>
  ${input.body ? `<p style="margin:0 0 20px;color:#3A4860">${escapeHtml(input.body)}</p>` : ''}
  <p style="margin:0 0 28px">
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#1E3A5F;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-size:14px">Open ${escapeHtml(brand.name)}</a>
  </p>
  <hr style="border:0;border-top:1px solid #E2DCD0;margin:0 0 16px">
  <p style="font-size:12px;color:#5B6675;margin:0 0 6px">${escapeHtml(brand.legalName)}<br>${escapeHtml(brand.mailingAddress)}</p>
  <p style="font-size:12px;color:#5B6675;margin:0">
    <a href="${escapeHtml(unsubscribe)}" style="color:#5B6675">Stop receiving emails about ${escapeHtml(categoryLabel)}</a>
  </p>
</div>`.trim();

  return { subject: input.title, text, html };
}
