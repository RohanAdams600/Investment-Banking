import 'server-only';

import type { NotificationKind } from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Reads for the inbox.
 *
 * Through the user's client. The policy is `recipient_id = auth.uid()` and
 * nothing else — not even an administrator's branch, because what a person has
 * been told is between them and the platform, and there is no support case that
 * needs reading somebody's inbox rather than asking them.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface InboxItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(limit = 50): Promise<InboxItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, title, body, href, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body ?? null,
    href: row.href ?? null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  }));
}

/**
 * The number on the bell.
 *
 * Its own function rather than `listNotifications().filter(...)`, because this
 * runs on every page and the list does not. Counting server-side keeps the
 * header query to one integer instead of fifty rows.
 */
export async function unreadCount(): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('unread_notification_count');
  if (error) return 0;

  return Number(data ?? 0);
}

export interface NotificationPreferences {
  dealActivity: boolean;
  newMatches: boolean;
  listingStatus: boolean;
  messages: boolean;
  digest: boolean;
}

/**
 * What this person wants emailed.
 *
 * Everything on for somebody with no row, matching the column defaults. A
 * marketplace where notifications are opt-in is one where the first NDA request
 * is missed, and the first one is the one that matters.
 */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  const supabase = await createClient();

  const { data } = await supabase.from('notification_preferences').select('*').maybeSingle();

  const row = (data ?? {}) as Row;

  return {
    dealActivity: row.email_deal_activity !== false,
    newMatches: row.email_new_matches !== false,
    listingStatus: row.email_listing_status !== false,
    messages: row.email_messages !== false,
    digest: row.email_digest === true,
  };
}
