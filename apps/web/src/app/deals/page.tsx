import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { can } from '@ib/core';
import { Badge, Button, Card, CardContent, EmptyState } from '@ib/ui';

import { listDeals } from '@/features/deals/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Deals',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const deals = await listDeals();
  const canCreate = can(actor, 'deal:create');

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Deals</h1>
          <p className="text-text-muted text-sm">Only deals you are a party to appear here.</p>
        </div>

        {canCreate ? (
          <Button asChild size="sm">
            <Link href="/deals/new">Open a deal</Link>
          </Button>
        ) : null}
      </header>

      {deals.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No deals yet"
          description={
            canCreate
              ? 'Open one to start a deal room and invite the other side.'
              : 'Deals you are invited to will appear here.'
          }
          action={
            canCreate ? (
              <Button asChild size="sm">
                <Link href="/deals/new">Open a deal</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Card className="hover:border-border-default transition-colors">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <Link href={`/deals/${deal.id}/messages`} className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">{deal.name}</p>
                    <p className="text-text-muted text-xs">
                      Opened {new Date(deal.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/deals/${deal.id}/documents`}
                      className="text-text-secondary hover:text-text-primary text-xs underline underline-offset-4"
                    >
                      Documents
                    </Link>
                    <Badge>
                      {deal.conversationCount} {deal.conversationCount === 1 ? 'room' : 'rooms'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
