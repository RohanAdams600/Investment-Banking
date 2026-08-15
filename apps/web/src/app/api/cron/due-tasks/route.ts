import { NextResponse } from 'next/server';

import { notify } from '@/lib/notify/notify';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The one notification nothing else can produce.
 *
 * Every other kind is caused by somebody doing something — a buyer requests an
 * NDA, a reviewer approves a listing — so the action that caused it is also the
 * place that announces it. "A task is due" has no such moment. Time passes and
 * nothing calls anything. It needs a clock.
 *
 * So: a route a scheduler hits. Vercel Cron, GitHub Actions, `curl` from a box
 * somewhere — the platform does not care which, and that is the point of doing
 * it this way rather than baking in one vendor's scheduler.
 *
 * ## The secret
 *
 * This route writes notifications for people who are not the caller, so the
 * caller must not be "anybody who found the URL". `CRON_SECRET` is compared in
 * constant time and, if it is unset, the route refuses outright rather than
 * running unauthenticated — an unset secret is a misconfiguration, not
 * permission.
 *
 * ## What it does not do
 *
 * It does not send email. Nothing in the platform sends email yet; this writes to the
 * inbox and the count on the dashboard. When a sender exists, `wantsEmail()` is
 * the switch it reads and this is the loop it hangs off.
 */

// A clock-driven route: never cached, never prerendered.
export const dynamic = 'force-dynamic';

/**
 * How far ahead counts as "due".
 *
 * A day, so somebody who works mornings hears about the afternoon's tasks while
 * there is still an afternoon. Shorter and the notification arrives after the
 * moment it was useful.
 */
const DUE_WINDOW_HOURS = 24;

/**
 * Length-independent comparison.
 *
 * `a === b` on secrets leaks their length and their common prefix through
 * timing. It is a small leak against a remote attacker and free to close.
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < provided.length; i += 1) {
    difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;

  return secretMatches(bearer, expected);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    // Deliberately the same answer whether the secret is wrong or unset. A
    // caller probing this endpoint learns nothing about which.
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const service = createServiceRoleClient();

  const cutoff = new Date(Date.now() + DUE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  /*
   * Open tasks with a deadline inside the window.
   *
   * `assigned_to` rather than `owner_id`: a task belongs to whoever has to do
   * it, and on a firm's board those are routinely different people. A task
   * nobody is assigned to gets no notification, which is correct — there is no
   * "somebody" to tell.
   */
  const { data, error } = await service
    .from('crm_tasks')
    .select('id, assigned_to, due_at')
    .eq('status', 'open')
    .not('assigned_to', 'is', null)
    .not('due_at', 'is', null)
    .lte('due_at', cutoff)
    .limit(1000);

  if (error) {
    console.error('[cron/due-tasks] could not read tasks', error.message);
    return NextResponse.json({ error: 'Could not read tasks.' }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = (data ?? []) as Record<string, any>[];

  /*
   * One notification per person, not per task.
   *
   * Somebody with eleven overdue tasks does not need eleven doorbells; they
   * need to be told there are eleven. This is also why `notificationCopy` takes
   * a count — the number is the entire content, and it is the only variable the
   * copy will accept.
   */
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const assignee = task.assigned_to as string;
    counts.set(assignee, (counts.get(assignee) ?? 0) + 1);
  }

  let sent = 0;
  for (const [assignee, count] of counts) {
    // Not collapsed against unread: a daily "3 tasks are due" that goes silent
    // on day two because day one was never read is the opposite of what a
    // reminder is for. The scheduler's cadence is the rate limit.
    await notify({
      recipientId: assignee,
      kind: 'task_due',
      entityType: 'crm_task',
      context: { count },
    });
    sent += 1;
  }

  return NextResponse.json({ tasks: tasks.length, notified: sent });
}
