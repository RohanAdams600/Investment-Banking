import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { loadPlatformStats } from '@/features/admin/queries';

export const metadata: Metadata = {
  title: 'Platform operations',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The overview.
 *
 * Counts, and nothing per-person or per-listing. A dashboard that answers "how
 * many businesses are on the market" does not need to answer "which", and the
 * function behind this returns only the former — an operator who wants the
 * detail has to go to the screen where that detail is actually their business.
 */
export default async function AdminOverviewPage() {
  const stats = await loadPlatformStats();

  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not available</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-muted text-sm">
            Platform counts are restricted to operations accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const cards = [
    { label: 'On the market', value: stats.liveListings, href: null },
    { label: 'Awaiting review', value: stats.pendingReview, href: '/admin/review' },
    { label: 'Accounts', value: stats.totalUsers, href: '/admin/verification' },
    { label: 'Unverified', value: stats.unverifiedUsers, href: '/admin/verification' },
    { label: 'States open', value: stats.activeJurisdictions, href: '/admin/jurisdictions' },
  ];

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {cards.map((card) => {
          const body = (
            <>
              <dt className="text-text-muted text-xs">{card.label}</dt>
              <dd className="font-mono text-2xl tabular-nums">{card.value}</dd>
            </>
          );

          return card.href ? (
            <Link
              key={card.label}
              href={card.href}
              className="border-border-subtle hover:border-border-default rounded-md border p-4 transition-colors"
            >
              {body}
            </Link>
          ) : (
            <div key={card.label} className="border-border-subtle rounded-md border p-4">
              {body}
            </div>
          );
        })}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>What this role can and cannot do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-text-secondary">
            Operations accounts can verify people and firms, review listings before they reach the
            market, open and close jurisdictions, and read the audit log.
          </p>
          <p className="text-text-secondary">
            They cannot open a deal room, download a document, or read the confidential half of a
            listing — not by policy on this page, but because the database refuses. Reviewing a
            listing shows you whether the seller completed it, never what it says.
          </p>
          <p className="text-text-muted text-xs">
            Where an investigation genuinely needs document access, that should be a separate and
            individually audited elevation rather than a permission this role carries all the time.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
