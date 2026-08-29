import { NextResponse } from 'next/server';
import { isBrandFullyConfigured, unconfiguredBrandFields } from '@ib/core';

import { isAiConfigured } from '@/lib/ai/router';
import { isSharedRateLimiterConfigured } from '@/lib/rate-limit';
import { isCspEnforced } from '@/lib/security/csp';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * Is this deployment actually working.
 *
 * The question a deploy leaves you with is not "did the build pass" — the build
 * passed on a machine with no secrets. It is "does this instance have what it
 * needs", and the honest way to answer it is to make one real query rather than
 * to check that a variable is non-empty.
 *
 * ## What it deliberately does not say
 *
 * No version, no commit hash, no environment name, no error detail. This
 * endpoint is unauthenticated because a load balancer has to reach it, and an
 * unauthenticated endpoint that names your database host or your build is a free
 * reconnaissance page. Every value here is a boolean about *this deployment's
 * own configuration*, which tells an attacker nothing they could not learn by
 * trying to sign in.
 *
 * The database probe reads `jurisdictions`, which is public reference data and
 * the one table an anonymous caller is allowed to read. A probe against
 * something confidential would be a probe that has to run with elevated rights.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, boolean> = {
    supabaseConfigured: isSupabaseConfigured(),
    databaseReachable: false,
    brandConfigured: isBrandFullyConfigured,
    aiConfigured: isAiConfigured(),
    cspEnforced: isCspEnforced(),
    /*
     * Whether the limits in lib/rate-limit.ts bind anything. Without a shared
     * store they are an in-process counter that resets on every cold start, and
     * the application gives no other sign of it — so it is reported here, where
     * a deploy check can read it, as well as failing a strict preflight.
     */
    rateLimitsEnforced: isSharedRateLimiterConfigured(),
    indexingAllowed: process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true',
  };

  if (checks.supabaseConfigured) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.from('jurisdictions').select('code').limit(1);
      checks.databaseReachable = !error;
    } catch {
      checks.databaseReachable = false;
    }
  }

  /*
   * Only two things make this unhealthy.
   *
   * A missing AI key is not a failure — every feature degrades to its
   * deterministic half by design, and returning 503 for it would take the site
   * down for something that costs a rationale paragraph. Same for the CSP flag
   * and indexing: they are deployment decisions, reported so a deploy check can
   * see them, not conditions.
   */
  const healthy = checks.supabaseConfigured && checks.databaseReachable;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      notConfigured: unconfiguredBrandFields,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
