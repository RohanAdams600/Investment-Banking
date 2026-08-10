'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import { SELECTABLE_ROLES } from './roles';
import type { OnboardingState } from './roles';

/**
 * Records the roles a new user chose for themselves.
 *
 * `admin` is excluded from the schema, and the RLS policy on `user_roles`
 * refuses it independently. Two layers for the same rule, because this is the
 * one insert in the product where a client asking for the wrong value would
 * hand itself every administrative capability.
 */
const selectionSchema = z.object({
  roles: z
    .array(z.enum(SELECTABLE_ROLES as [string, ...string[]]))
    .min(1, 'Choose at least one — you can add others later.')
    .max(SELECTABLE_ROLES.length),
});

export async function saveRoles(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = selectionSchema.safeParse({ roles: formData.getAll('roles') });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose at least one.', notice: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to continue.', notice: null };

  // Upsert rather than insert: someone returning to this screen to add a role
  // should not hit a primary key violation on the ones they already hold.
  const { error } = await supabase.from('user_roles').upsert(
    parsed.data.roles.map((role) => ({ user_id: user.id, role })),
    { onConflict: 'user_id,role', ignoreDuplicates: true },
  );

  if (error) {
    return { error: 'Could not save your selection.', notice: null };
  }

  await recordAuditEvent({
    action: 'onboarding.roles_selected',
    entityType: 'user_roles',
    entityId: user.id,
    metadata: { roles: parsed.data.roles },
  });

  redirect('/dashboard');
}
