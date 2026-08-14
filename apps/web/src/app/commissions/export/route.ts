import { NextResponse, type NextRequest } from 'next/server';
import { can, commissionCsv, exportFilename } from '@ib/core';

import { listCommissions } from '@/features/commission/queries';
import { listMyFirms } from '@/features/deals/queries';
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

  const firms = await listMyFirms();
  if (firms.length === 0) {
    return new NextResponse('Commissions belong to a firm.', { status: 404 });
  }

  const requested = request.nextUrl.searchParams.get('firm');
  const firm = requested ? firms.find((f) => f.id === requested) : firms[0];

  // Not "fall back to the first firm". A request naming a firm the caller does
  // not belong to is a request to answer with a refusal, not with somebody
  // else's numbers.
  if (!firm) return new NextResponse('Not your firm.', { status: 403 });

  const records = await listCommissions(firm.id);

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
