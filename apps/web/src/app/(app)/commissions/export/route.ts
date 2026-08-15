import { NextResponse, type NextRequest } from 'next/server';
import { can, commissionCsv, exportFilename } from '@ib/core';

import { listCommissions } from '@/features/commission/queries';
import { resolveFirmScope } from '@/features/firms/firm-scope';
import { recordAuditEvent } from '@/lib/audit';
import { getActor } from '@/lib/auth/actor';

/**
 * The commission export, as a file.
 *
 * A route handler rather than a server action, because the deliverable is a
 * download and an action returns a value. The browser gets a `Content-
 * Disposition` and saves it.
 *
 * The firm is read from the caller's own memberships and the records come back
 * through RLS, so the query string cannot be pointed at another brokerage's
 * book — a `?firm=` a caller does not belong to yields no memberships match and
 * a 403, and even a bug there would return zero rows.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return new NextResponse('Sign in first.', { status: 401 });

  if (!can(actor, 'commission:view_own')) {
    return new NextResponse('Your role does not include commission records.', { status: 403 });
  }

  const scope = await resolveFirmScope(request.nextUrl.searchParams.get('firm'));

  if (scope.options.length === 0) {
    return new NextResponse('Commissions belong to a firm.', { status: 404 });
  }

  /*
   * Two refusals rather than a fallback.
   *
   * Naming a firm the caller does not belong to is answered with 403, not with
   * somebody else's file. Naming none while belonging to several is answered
   * with 400 — the alternative is guessing, and a CSV of the wrong brokerage's
   * fees is the kind of thing that gets forwarded to an accountant before
   * anybody notices the filename.
   */
  if (!scope.firm) {
    return new NextResponse(
      scope.mustChoose
        ? 'You belong to more than one firm. Add ?firm=<id> to say which.'
        : 'Not your firm.',
      { status: scope.mustChoose ? 400 : 403 },
    );
  }

  const firm = scope.firm;

  const page = await listCommissions(firm.id);

  /*
   * A truncated export is worse than a failed one.
   *
   * Everywhere else in the product a capped list shows a notice and the reader
   * decides what to do. A CSV has no notice: it opens in Excel, gets summed,
   * and the total is quietly wrong — and this particular total is what a
   * brokerage reconciles its revenue against. So the export refuses rather than
   * hands over a file that looks complete.
   *
   * The 200 cap is generous for a first year and this is a real ceiling, not a
   * hypothetical one. When a firm hits it, the fix is a paginated export, not a
   * bigger number.
   */
  if (page.truncated) {
    return NextResponse.json(
      {
        error: `This firm has more than ${page.limit} commission records, which is more than one export can carry. Rather than hand you a file that is silently short, nothing was written. Get in touch and we will pull the full set.`,
      },
      { status: 409 },
    );
  }

  const records = page.rows;

  await recordAuditEvent({
    action: 'commission.exported',
    entityType: 'firm',
    entityId: firm.id,
    firmId: firm.id,
    // A count, not the figures. Exporting is worth recording because it is the
    // moment the numbers leave the platform.
    metadata: { records: records.length },
  });

  const csv = commissionCsv(records);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // `charset=utf-8` because a waived reason can contain anything somebody
      // typed, and Excel guesses wrong without it.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(firm.name)}"`,
      // A file of what a brokerage earned is not something to leave in a shared
      // cache.
      'cache-control': 'no-store, private',
    },
  });
}
