import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CATEGORY_HINTS, CATEGORY_LABELS } from '@ib/core';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { listNotifications, loadNotificationPreferences } from '@/features/notifications/queries';
import { NotificationPreferencesForm, MarkAllRead } from '@/features/notifications/panels';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  const [items, preferences] = await Promise.all([
    listNotifications(),
    loadNotificationPreferences(),
  ]);

  const unread = items.filter((item) => item.readAt === null);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Notifications</h1>
          <p className="text-text-muted text-sm">
            {unread.length === 0
              ? 'Nothing new.'
              : `${unread.length} unread of the last ${items.length}.`}
          </p>
        </div>
        {unread.length > 0 ? <MarkAllRead /> : null}
      </header>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-text-muted text-sm">
              Nothing yet. You will hear when somebody asks to see one of your listings, when a
              document is shared with you, or when a listing you own changes status.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const inner = (
              <div
                className={
                  item.readAt === null
                    ? 'border-primary/30 bg-primary-subtle/30 rounded-md border p-3'
                    : 'border-border-subtle rounded-md border p-3'
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <span className="text-text-muted text-xs tabular-nums">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                {item.body ? <p className="text-text-secondary mt-1 text-xs">{item.body}</p> : null}
              </div>
            );

            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="block">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle>What to email me</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-text-muted text-xs">
            Everything above appears here whatever you choose — this only decides what also reaches
            your inbox. Notifications never contain confidential detail: they say something happened
            and link to where it is, because email is not a private channel.
          </p>

          <NotificationPreferencesForm
            preferences={preferences}
            labels={CATEGORY_LABELS}
            hints={CATEGORY_HINTS}
          />
        </CardContent>
      </Card>

      <p className="text-text-muted text-xs">
        <Badge variant="warning">Not sending yet</Badge> No email provider is configured, so nothing
        leaves the platform. These settings are stored and will be honoured the moment one is.
      </p>
    </main>
  );
}
