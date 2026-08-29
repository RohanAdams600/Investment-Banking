import 'server-only';

import { headers } from 'next/headers';

/**
 * The caller's address, for limiting things that have no account behind them.
 *
 * ## Read only the header the platform sets
 *
 * `x-forwarded-for` is a list a client can prepend to. Trusting its first entry
 * means an attacker sets a new one per request and every address-keyed limit
 * becomes decoration. So the platform's own header is preferred, and where
 * `x-forwarded-for` is used at all it is the **last** entry — the one the edge
 * appended, which is the only value in the chain a client could not choose.
 *
 * Vercel sets `x-vercel-forwarded-for`; other proxies vary, and a deployment
 * behind something else should add its header here rather than loosening the
 * rule.
 *
 * ## The fallback is one shared bucket, deliberately
 *
 * With no trustworthy header every caller keys to `unknown`, so the limit binds
 * all anonymous traffic together and is far too strict. That is the correct
 * failure: a limiter that silently stops limiting is worse than one that is
 * briefly annoying, and the condition is loud enough to notice in testing.
 *
 * Never stored. This value keys a counter and is not written to any table —
 * an address is personal data in several jurisdictions this will operate in,
 * and the interest table deliberately holds no record of who submitted from
 * where.
 */
export async function clientAddress(): Promise<string> {
  const list = await headers();

  const platform = list.get('x-vercel-forwarded-for') ?? list.get('cf-connecting-ip');
  if (platform?.trim()) return platform.trim();

  const forwarded = list.get('x-forwarded-for');
  if (forwarded?.trim()) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    // The last hop, not the first. See above.
    const appended = hops[hops.length - 1];
    if (appended) return appended;
  }

  return 'unknown';
}
