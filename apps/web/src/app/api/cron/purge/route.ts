import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The scheduled deletion of expired confidential data.
 *
 * Separate from `cron/due-tasks` because the two fail differently and should
 * not share a schedule: a missed reminder is an inconvenience, a purge that
 * silently stops running is a growing pile of the most sensitive rows in the
 * schema. Worth its own route so it has its own logs and its own alarm.
 *
 * Idempotent — running it twice deletes nothing the second time, because the
 * rows it selects on are the rows it removes.
 */
export const dynamic = 'force-dynamic';

/** Length-independent comparison; `a === b` on a secret leaks its prefix. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < provided.length; i += 1) {
    difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;

  /*
   * An unset secret refuses rather than runs. This route deletes data; "not
   * configured" must never mean "open to anyone who found the URL".
   */
  if (!expected) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }

  const header = request.headers.get('authorization');
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const service = createServiceRoleClient();

  /*
   * `dry_run` lets a scheduler be pointed at this safely before it is armed,
   * and lets an operator see what is about to go without taking it.
   */
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';

  if (dryRun) {
    const { data, error } = await service.rpc('confidential_purge_preview', {
      retention_days: 90,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ dryRun: true, wouldPurge: data ?? [] });
  }

  const { data, error } = await service.rpc('purge_expired_confidential_data', {
    retention_days: 90,
  });

  if (error) {
    console.error('[cron/purge] failed', error.message);
    return NextResponse.json({ error: 'Purge failed.' }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;

  // Logged even when it removes nothing, so "the job is alive" and "there was
  // nothing to do" are distinguishable in a log a month from now.
  console.log('[cron/purge] complete', JSON.stringify(result ?? {}));

  return NextResponse.json({ ok: true, ...(result ?? {}) }, { headers: { 'cache-control': 'no-store' } });
}
