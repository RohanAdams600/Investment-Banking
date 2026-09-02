import { NextResponse } from 'next/server';
import { isDue, type AlertFrequency } from '@ib/core';

import { deliverEmail } from '@/lib/notify/deliver';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The scheduled half of saved searches.
 *
 * A saved search with no send is a bookmark. This is the run that turns it into
 * the feature: once a day, every search that is due and has something new
 * behind it produces one email.
 *
 * ## Why the cursor advances only on a successful send
 *
 * `last_notified_at` is a high-water mark, and the tempting implementation
 * advances it for every search the run touches. That loses listings: a send
 * that fails after the cursor moved means the buyer is never told about the one
 * business they were waiting for, and neither they nor we would ever know. So
 * the cursor moves only behind a delivery that reported success, and a failed
 * run repeats tomorrow rather than skipping a day of the market.
 *
 * The cost of that choice is a duplicate email if delivery succeeds and the
 * update then fails. That is the right way round: a buyer who gets told twice
 * is annoyed, and a buyer who is never told loses a deal.
 *
 * ## One email per search, not per listing
 *
 * A buyer with a broad search on a busy day would otherwise get nine messages.
 * The email says how many and links to the page; the page shows what they are.
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

interface DueRow {
  id: string;
  user_id: string;
  label: string;
  frequency: AlertFrequency;
  last_notified_at: string | null;
}

/*
 * Bounded per run.
 *
 * A run that tries to email every buyer on the platform in one invocation hits
 * the function timeout somewhere in the middle, and what it leaves behind is
 * indeterminate: some cursors advanced, some not, and no way to tell which
 * without reading the delivery log. A cap makes the leftover explicit — the
 * response says how many were skipped, and the next run picks them up, because
 * the query orders by the cursor and the unsent ones sort first.
 */
const MAX_PER_RUN = 200;

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;

  /*
   * An unset secret refuses rather than runs. This route sends mail on behalf
   * of the platform; "not configured" must never mean "open to anyone who
   * found the URL".
   */
  if (!expected) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }

  const header = request.headers.get('authorization');
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';

  const service = createServiceRoleClient();
  const now = new Date();

  const { data, error } = await service
    .from('saved_searches')
    .select('id, user_id, label, frequency, last_notified_at')
    .neq('frequency', 'off')
    .order('last_notified_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN + 1);

  if (error) {
    return NextResponse.json({ error: 'Could not read saved searches.' }, { status: 500 });
  }

  const rows = (data ?? []) as DueRow[];
  const overflow = rows.length > MAX_PER_RUN;
  const batch = rows.slice(0, MAX_PER_RUN);

  let considered = 0;
  let sent = 0;
  let empty = 0;
  let failed = 0;

  for (const row of batch) {
    const lastNotifiedAt = row.last_notified_at ? new Date(row.last_notified_at) : null;

    /*
     * Due-ness is decided in TypeScript, by a pure function with its own tests,
     * rather than in the query's `where`. The rule has an hour of slack in it
     * for scheduler drift, and a subtlety like that expressed as an interval
     * literal inside a filter is one nobody reviews and nobody can test.
     */
    if (!isDue({ frequency: row.frequency, lastNotifiedAt }, now)) continue;
    considered += 1;

    const { data: matches, error: matchError } = await service.rpc('saved_search_matches', {
      p_search_id: row.id,
      p_since: lastNotifiedAt?.toISOString() ?? null,
      p_limit: 25,
    });

    if (matchError) {
      failed += 1;
      continue;
    }

    const count = (matches ?? []).length;

    if (count === 0) {
      /*
       * Nothing new, so no email — and no cursor move either.
       *
       * Advancing here would look harmless and would quietly narrow the window
       * every day the market is quiet, so a listing published minutes after a
       * silent run would fall between two cursors and never be reported.
       */
      empty += 1;
      continue;
    }

    if (dryRun) {
      sent += 1;
      continue;
    }

    /*
     * `deliverEmail` is the only path that sends. It checks the recipient's
     * category preference, mints an unsubscribe token, refuses to send without
     * one, and records the outcome — none of which should be reimplemented here
     * for a second kind of email.
     */
    let delivered = false;
    try {
      await deliverEmail({
        recipientId: row.user_id,
        kind: 'saved_search_match',
        title:
          count === 1
            ? `A business matching “${row.label}”`
            : `${count} businesses matching “${row.label}”`,
        body: 'Open your saved searches to see what came up.',
        href: '/saved-searches',
      });
      delivered = true;
    } catch {
      failed += 1;
    }

    if (!delivered) continue;

    const { error: cursorError } = await service
      .from('saved_searches')
      .update({ last_notified_at: now.toISOString() })
      .eq('id', row.id);

    if (cursorError) {
      // The email went. A repeat tomorrow is the acceptable failure here.
      failed += 1;
      continue;
    }

    sent += 1;
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned: batch.length,
    due: considered,
    sent,
    nothingNew: empty,
    failed,
    /*
     * Reported rather than logged. A scheduler that keeps hitting the cap means
     * the run needs to be more frequent or the cap raised, and that is a
     * decision for whoever reads the response — not something to discover from
     * a graph of send volume months later.
     */
    moreWaiting: overflow,
  });
}

/*
 * Vercel Cron issues a GET.
 *
 * A GET that mutates is the wrong shape by every convention, and the
 * convention exists to stop a crawler or a link prefetch from triggering an
 * action nobody asked for. Neither can happen here: the route refuses without a
 * bearer secret that only the scheduler holds, and refuses outright when that
 * secret is unset. The alternative — keeping POST-only — is a job that silently
 * never runs on the platform this deploys to, which is the failure this
 * exists to avoid.
 *
 * POST stays for a scheduler that can send one, and for running it by hand.
 */
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
