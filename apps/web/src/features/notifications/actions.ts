'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

export interface NotificationState {
  error: string | null;
  message?: string | null;
}

export const emptyNotificationState: NotificationState = { error: null, message: null };

/**
 * Mark everything read.
 *
 * Through the RPC rather than an update from here. The obvious client version is
 * `update notifications set read_at = now() where read_at is null`, and without
 * a recipient predicate that is a request to mark *everybody's* notifications
 * read. RLS would refuse the rows, so it would be harmless — but it would also
 * be a statement whose safety depends entirely on a policy, and this one does
 * not need to.
 */
export async function markAllRead(): Promise<NotificationState> {
  const supabase = await createClient();

  const { error } = await supabase.rpc('mark_notifications_read', {});
  if (error) return { error: 'Could not mark those read.', message: null };

  revalidatePath('/notifications');
  return { error: null, message: null };
}

const preferencesSchema = z.object({
  dealActivity: z.boolean(),
  newMatches: z.boolean(),
  listingStatus: z.boolean(),
  messages: z.boolean(),
  digest: z.boolean(),
});

export async function saveNotificationPreferences(
  _prev: NotificationState,
  formData: FormData,
): Promise<NotificationState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in first.', message: null };

  // An unchecked checkbox sends nothing at all, which is why every field is read
  // as "was it present" rather than parsed from a value. A form that omitted one
  // would otherwise silently keep the old setting.
  const parsed = preferencesSchema.safeParse({
    dealActivity: formData.get('dealActivity') !== null,
    newMatches: formData.get('newMatches') !== null,
    listingStatus: formData.get('listingStatus') !== null,
    messages: formData.get('messages') !== null,
    digest: formData.get('digest') !== null,
  });

  if (!parsed.success) return { error: 'Could not save those settings.', message: null };

  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: user.id,
      email_deal_activity: parsed.data.dealActivity,
      email_new_matches: parsed.data.newMatches,
      email_listing_status: parsed.data.listingStatus,
      email_messages: parsed.data.messages,
      email_digest: parsed.data.digest,
    },
    { onConflict: 'user_id' },
  );

  if (error) return { error: 'Could not save those settings.', message: null };

  revalidatePath('/notifications');
  return { error: null, message: 'Saved.' };
}
