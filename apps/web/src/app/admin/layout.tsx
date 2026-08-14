import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * The gate on every admin screen.
 *
 * A layout rather than a check repeated in five pages, because the version that
 * gets forgotten is the sixth page somebody adds next month. This is still not
 * the access control — the policies are — but it is the difference between an
 * operator seeing a panel and a buyer seeing an empty one.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  // Checked against the narrowest capability every admin screen needs. Each
  // page re-checks its own, because "can see the panel" and "can verify a
  // person" are not the same permission and should not become the same check.
  if (!can(actor, 'admin:view_platform_analytics')) redirect('/dashboard');

  const tabs = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/review', label: 'Listing review', show: can(actor, 'listing:review') },
    { href: '/admin/verification', label: 'Verification', show: can(actor, 'admin:verify_users') },
    {
      href: '/admin/jurisdictions',
      label: 'Jurisdictions',
      show: can(actor, 'admin:manage_jurisdictions'),
    },
    { href: '/admin/audit', label: 'Audit log', show: can(actor, 'admin:view_audit_log') },
  ].filter((tab) => tab.show !== false);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Platform operations</h1>
        <p className="text-text-muted text-sm">
          Verification, listing review and jurisdictions. This role does not carry access to any
          deal room, document, or confidential business profile.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Admin sections">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="border-border-default hover:border-border-strong rounded-md border px-3 py-1.5 text-sm"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
