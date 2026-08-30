import { brand } from '@ib/core';

/**
 * Where to send a vulnerability, and the promise that comes with it.
 *
 * RFC 9116. It costs nothing and it decides which of two things happens when a
 * researcher finds a hole: they email you, or they post it. The safe-harbour
 * line is the part that matters — without it, the careful people assume
 * reporting is legally risky and stay quiet, and only the careless ones get in
 * touch.
 *
 * `Expires` is required by the RFC and is deliberately near-term: a stale
 * security.txt pointing at an address nobody reads is worse than none, so this
 * one goes out of date on purpose and forces a review.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + 6);

  const body = [
    `Contact: mailto:${brand.supportEmail}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${brand.url}/.well-known/security.txt`,
    `Policy: ${brand.url}/legal/security`,
    '',
    '# Safe harbour',
    '# We will not pursue legal action against anyone who reports a',
    '# vulnerability in good faith, gives us reasonable time to fix it, and',
    '# does not access, modify or retain data belonging to other people.',
    '#',
    '# Please do not run automated scanning that degrades the service, and do',
    '# not attempt to access a real seller or buyer account. This platform',
    '# holds confidential financial information about private businesses; a',
    '# proof of concept that reads somebody else data is not a proof of',
    '# concept, it is the breach.',
    '',
  ].join('\n');

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
