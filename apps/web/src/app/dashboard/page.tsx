import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@ib/ui';
import { CircleUser } from 'lucide-react';

import { signOut } from '@/features/auth/actions';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

// Reads the session, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/**
 * Placeholder dashboard.
 *
 * Role-scoped portals arrive in step 4. What this page does today is close the
 * loop on step 2: it proves a session survives the middleware, that `getActor()`
 * assembles roles and memberships through RLS, and that sign-out works.
 */
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

  return (
    <main className="py-18 mx-auto max-w-2xl space-y-6 px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-text-muted text-sm">Role-scoped portals arrive in step 4.</p>
        </div>

        <form action={signOut}>
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform roles</CardTitle>
        </CardHeader>
        <CardContent>
          {actor.platformRoles.length === 0 ? (
            // The expected state for a new account: registration grants nothing
            // until onboarding. See supabase/migrations/0007.
            <p className="text-text-muted text-sm">
              No roles yet. Onboarding — role selection and consent — is still to be built.
            </p>
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
