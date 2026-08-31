import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@ib/ui';
import { CircleUser } from 'lucide-react';

import { signOut } from '@/features/auth/actions';
import { unreadCount } from '@/features/notifications/queries';
import { accountState } from '@/features/onboarding/queries';
import { NextSteps } from '@/features/onboarding/next-steps';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

// Reads the session, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/**
 * The dashboard.
 *
 * Role-scoped by capability rather than by role name. `can(actor, 'listing:create')`
 * survives a reorganisation of the role model; `roles.includes('seller')` does
 * not, and would have to be found and changed in every page the day a new
 * sell-side role appears.
 *
 * Hiding a link is not access control — every destination re-checks, and the
 * database refuses regardless. This is about not offering somebody a door that
 * will not open for them.
 */
interface DashboardLink {
  href: string;
  label: string;
  hint: string;
  /**
   * Whether to offer it. Not access control — every destination re-checks and
   * the database refuses regardless.
   */
  show: boolean;
  /** A count worth interrupting for. Omitted where there is nothing to count. */
  count?: number;
}

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="py-18 mx-auto max-w-2xl px-6">
        <EmptyState
          icon={CircleUser}
          title="Supabase is not configured"
          description="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local. See docs/environment.md."
        />
      </main>
    );
  }

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  // A new account holds no roles and can therefore do nothing. Sending them to
  // the picker is the difference between deny-by-default being a safe posture
  // and being a dead end.
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  // Returns 0 if the notifications migration has not been applied, because the
  // RPC is missing and the query errors. That is the behaviour we want: a
  // dashboard that renders without a feature beats one that 500s with it.
  const unread = await unreadCount();

  /*
   * What this person should do next, computed from their own rows.
   *
   * Rendered above everything else on the page: the dashboard's fourteen cards
   * are useful once somebody knows the product, and useless on the day they
   * sign up, which is the day most people decide whether to come back.
   */
  const state = await accountState([...actor.platformRoles]);

  const links: DashboardLink[] = [
    {
      href: '/notifications',
      label: 'Notifications',
      hint: 'What has happened since you were last here',
      show: true,
      count: unread,
    },
    {
      href: '/listings',
      label: 'Businesses for sale',
      hint: 'Browse the market',
      show: can(actor, 'listing:view_teaser'),
    },
    {
      href: '/listings/mine',
      label: 'My listings',
      hint: 'Drafts, live listings and access requests',
      show: can(actor, 'listing:create'),
    },
    {
      href: '/matches',
      label: 'Matches',
      hint: 'Listings ranked against your criteria',
      show: can(actor, 'listing:view_full'),
    },
    {
      href: '/buyer-profile',
      label: 'Buyer profile',
      hint: 'How sellers see you',
      show: can(actor, 'listing:view_full'),
    },
    {
      href: '/watchlist',
      label: 'Watchlist',
      hint: 'Listings you saved',
      show: can(actor, 'listing:view_full'),
    },
    {
      href: '/deals',
      label: 'Deals',
      hint: 'Deal rooms you are a party to',
      show: can(actor, 'deal_room:access'),
    },
    {
      href: '/tools/valuation',
      label: 'Valuation estimate',
      hint: 'What a business might be worth',
      show: true,
    },
    {
      href: '/tools/buyer-criteria',
      label: 'Acquisition criteria',
      hint: 'What you are looking to buy',
      show: can(actor, 'listing:view_full'),
    },
    {
      href: '/tools/legal-documents',
      label: 'Legal documents',
      hint: 'Questions to take to counsel',
      show: true,
    },
    {
      href: '/crm',
      label: 'Pipeline',
      hint: 'Contacts, leads and what to do today',
      show: can(actor, 'crm:manage'),
    },
    {
      href: '/commissions',
      label: 'Commissions',
      hint: 'Fee schedule and what you have earned',
      show: can(actor, 'commission:view_own'),
    },
    {
      href: '/admin',
      label: 'Platform operations',
      hint: 'Review, verification and jurisdictions',
      show: can(actor, 'admin:view_platform_analytics'),
    },
    {
      href: '/settings/security',
      label: 'Security',
      hint: 'Two-factor and active sessions',
      show: true,
    },
    {
      href: '/settings/agents',
      label: 'Connected agents',
      hint: 'Give an AI agent read and draft access',
      show: true,
    },
  ];

  return (
    <main className="py-18 mx-auto max-w-2xl space-y-6 px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-text-muted text-sm">Everything you can reach, in one place.</p>
        </div>

        <form action={signOut}>
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      {/*
        Above the grid of destinations, and rendering nothing once setup is
        finished. The fourteen cards below are useful to somebody who already
        knows the product and useless on the day they sign up — which is the day
        most people decide whether to come back.
      */}
      <NextSteps state={state} />

      <Card>
        <CardHeader>
          <CardTitle>Where to go</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {links
            .filter((link) => link.show)
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="border-border-subtle hover:border-border-default block rounded-md border p-3 transition-colors"
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {link.label}
                  {/* Absent rather than zero: a badge reading "0" is worse than
                      no badge, because it draws the eye to nothing. */}
                  {link.count ? (
                    <Badge variant="primary">{link.count > 99 ? '99+' : link.count}</Badge>
                  ) : null}
                </span>
                <span className="text-text-muted block text-xs">{link.hint}</span>
              </Link>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform roles</CardTitle>
        </CardHeader>
        <CardContent>
          {actor.platformRoles.length === 0 ? (
            // The expected state for a new account: registration grants nothing
            // until onboarding. See supabase/migrations/0007.
            <p className="text-text-muted text-sm">No roles yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {actor.platformRoles.map((role) => (
                <Badge key={role} variant="primary">
                  {role.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firm memberships</CardTitle>
        </CardHeader>
        <CardContent>
          {actor.firmMemberships.length === 0 ? (
            <p className="text-text-muted text-sm">Not a member of any firm.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {actor.firmMemberships.map((membership) => (
                <li key={membership.firmId} className="flex items-center justify-between">
                  <span className="font-mono text-xs">{membership.firmId}</span>
                  <Badge>{membership.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
