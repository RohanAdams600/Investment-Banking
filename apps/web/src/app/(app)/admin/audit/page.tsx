import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { loadAuditLog } from '@/features/admin/queries';
import { getActor } from '@/lib/auth/actor';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** The action namespaces worth filtering by, in the order an operator asks for them. */
const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'listing.', label: 'Listings' },
  { value: 'user.', label: 'Accounts' },
  { value: 'nda.', label: 'NDAs' },
  { value: 'jurisdiction.', label: 'Jurisdictions' },
  { value: 'fee_agreement.', label: 'Fees' },
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (!can(actor, 'admin:view_audit_log')) redirect('/admin');

  const params = await searchParams;
  const active = typeof params.action === 'string' ? params.action : '';

  const entries = await loadAuditLog({ action: active || null });

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="Filter by action">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value || 'all'}
            href={filter.value ? `/admin/audit?action=${filter.value}` : '/admin/audit'}
            className={
              filter.value === active
                ? 'border-primary bg-primary-subtle rounded-md border px-3 py-1.5 text-sm'
                : 'border-border-default hover:border-border-strong rounded-md border px-3 py-1.5 text-sm'
            }
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-text-muted text-xs">
            Append-only. There is no policy and no grant that would let anybody edit or delete a row
            here, including you — an audit log an administrator can rewrite is worse than none,
            because it still looks like evidence.
          </p>

          {entries.length === 0 ? (
            <p className="text-text-muted text-sm">Nothing recorded under this filter.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="border-border-subtle flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-0"
                >
                  <div>
                    <p className="font-mono text-xs">{entry.action}</p>
                    <p className="text-text-muted text-xs">
                      {entry.actorEmail ?? 'system'}
                      {entry.entityId ? ` · ${entry.entityType} ${entry.entityId.slice(0, 8)}` : ''}
                    </p>
                  </div>
                  <span className="text-text-muted text-xs tabular-nums">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-text-muted text-xs">
            Showing the most recent 200 entries. Export for a regulator or an incident review is not
            built yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
