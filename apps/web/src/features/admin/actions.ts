'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertCan } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { notify } from '@/lib/notify/notify';
import { getActor } from '@/lib/auth/actor';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Writes for the admin panel.
 *
 * Two gates on every one of these, and they are not redundant. `assertCan`
 * gives a person who is not an operator a clear answer instead of a silent
 * no-op, which matters because a policy that matches zero rows and an action
 * that succeeded look identical from the browser. The policy underneath is what
 * actually decides.
 *
 * Every action here writes an audit entry, and that is not decoration: these
 * are the operations where the platform acts on somebody else's account or
 * somebody else's listing, and "who approved this" is the first question anyone
 * will ask afterwards.
 */

export interface AdminState {
  error: string | null;
  message?: string | null;
}

export const emptyAdminState: AdminState = { error: null, message: null };

function fail(error: string): AdminState {
  return { error, message: null };
}

// ---------------------------------------------------------------------------
// Listing review
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  listingId: z.string().uuid('Not a valid listing.'),
  decision: z.enum(['live', 'draft', 'withdrawn']),
  reason: z
    .string()
    .trim()
    .max(1000, 'Keep the note under 1000 characters.')
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * Approve, return, or pull a listing.
 *
 * Returning one to draft without saying why is the failure mode this form
 * exists to prevent, so a rejection requires a reason and an approval does not.
 * The seller reads it on their own listing; the market never sees it.
 */
export async function reviewListing(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  try {
    assertCan(actor, 'listing:review');
  } catch {
    return fail('Listing review is a platform operations task.');
  }

  const parsed = reviewSchema.safeParse({
    listingId: formData.get('listingId'),
    decision: formData.get('decision'),
    reason: typeof formData.get('reason') === 'string' ? formData.get('reason') : undefined,
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const { listingId, decision, reason } = parsed.data;

  if (decision !== 'live' && reason === null) {
    return fail('Say why. The seller needs something they can act on.');
  }

  const supabase = await createClient();

  const { data: moved, error } = await supabase.rpc('change_listing_status', {
    target_listing_id: listingId,
    new_status: decision,
    reason,
  });

  if (error) {
    return fail(
      error.code === '42501'
        ? 'A listing can only be moderated by changing its status.'
        : 'Could not record that decision.',
    );
  }

  if (Number(moved ?? 0) === 0) {
    // The policy matched nothing. Almost always because somebody else already
    // reviewed it and it is no longer in the queue.
    return fail('That listing has already moved on.');
  }

  await recordAuditEvent({
    action: decision === 'live' ? 'listing.approved' : 'listing.returned',
    entityType: 'listing',
    entityId: listingId,
    // The reason stays on the status history row. It was written for the seller.
    metadata: { decision },
  });

  /*
   * Tell the seller, without repeating the reason.
   *
   * A returned listing is the case where somebody is definitely waiting to hear,
   * and the reason is the useful part — but it is also the part that says the
   * quiet thing out loud ("the headline names the business"). The notification
   * points at the listing, where the reason already is.
   */
  const seller = await sellerOf(listingId);
  if (seller) {
    await notify({
      recipientId: seller,
      kind: decision === 'live' ? 'listing_approved' : 'listing_returned',
      entityId: listingId,
      entityType: 'listing',
    });
  }

  revalidatePath('/admin/review');
  revalidatePath('/admin');
  return {
    error: null,
    message: decision === 'live' ? 'Published to the market.' : 'Sent back to the seller.',
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const verificationSchema = z.object({
  userId: z.string().uuid('Not a valid account.'),
  status: z.enum(['unverified', 'pending', 'verified', 'rejected']),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * Set somebody's verification status.
 *
 * One column. The route sends only that column, and a trigger compares the
 * whole row to make sure — because the day somebody writes a second route is
 * the day trusting the route stops working. `verified_at` is stamped by the
 * database rather than sent from here, so "verified on" means when it happened.
 */
export async function setVerification(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  try {
    assertCan(actor, 'admin:verify_users');
  } catch {
    return fail('Verification is a platform operations task.');
  }

  const parsed = verificationSchema.safeParse({
    userId: formData.get('userId'),
    status: formData.get('status'),
    note: typeof formData.get('note') === 'string' ? formData.get('note') : undefined,
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  if (parsed.data.userId === actor.userId) {
    // The trigger refuses this too. Caught here so the message says what
    // happened rather than surfacing a policy error.
    return fail('Verification is not something you grant yourself.');
  }

  if (parsed.data.status === 'rejected' && parsed.data.note === null) {
    return fail('Record why this was rejected.');
  }

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('profiles')
    .update({ verification_status: parsed.data.status }, { count: 'exact' })
    .eq('id', parsed.data.userId);

  if (error) {
    return fail(
      error.code === '42501'
        ? 'An administrator may only change a verification status.'
        : 'Could not update that account.',
    );
  }

  if (count === 0) return fail('That account is no longer available.');

  await recordAuditEvent({
    action: 'user.verification_changed',
    entityType: 'user',
    entityId: parsed.data.userId,
    // The note is the operator's own record of a decision about a person, and
    // the audit log is the right home for it — unlike a rejection reason, it is
    // not shown to the account holder.
    metadata: { status: parsed.data.status, note: parsed.data.note },
  });

  revalidatePath('/admin/verification');
  revalidatePath('/admin');
  return { error: null, message: `Marked ${parsed.data.status}.` };
}

// ---------------------------------------------------------------------------
// Jurisdictions
// ---------------------------------------------------------------------------

const jurisdictionSchema = z.object({
  code: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'Not a valid jurisdiction code.'),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

/**
 * Turn a jurisdiction on or off.
 *
 * This is a switch, and it is worth being blunt about what it does not do:
 * turning New York on does not make the platform compliant in New York. It
 * records that the operator has done that work. Nothing in the platform verifies a
 * licence, and no screen should ever imply otherwise.
 */
export async function setJurisdiction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  try {
    assertCan(actor, 'admin:manage_jurisdictions');
  } catch {
    return fail('Jurisdictions are managed by platform operations.');
  }

  const parsed = jurisdictionSchema.safeParse({
    code: formData.get('code'),
    isActive: formData.get('isActive'),
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('jurisdictions')
    .update({ is_active: parsed.data.isActive }, { count: 'exact' })
    .eq('code', parsed.data.code);

  if (error) return fail('Could not change that jurisdiction.');
  if (count === 0) return fail('No such jurisdiction, or you cannot change it.');

  await recordAuditEvent({
    action: parsed.data.isActive ? 'jurisdiction.opened' : 'jurisdiction.closed',
    entityType: 'jurisdiction',
    entityId: parsed.data.code,
    metadata: { isActive: parsed.data.isActive },
  });

  revalidatePath('/admin/jurisdictions');
  revalidatePath('/admin');
  return {
    error: null,
    message: parsed.data.isActive
      ? `${parsed.data.code} is open. Your own licensing work is what makes that true.`
      : `${parsed.data.code} is closed to new business.`,
  };
}

/**
 * Whose listing it is.
 *
 * Service role, because an administrator cannot read `listings.seller_id` for a
 * listing they do not control — 0016 restricts a non-controller to the status
 * column. The id is used only to address a notification; nothing read here
 * reaches its text.
 */
async function sellerOf(listingId: string): Promise<string | null> {
  const service = createServiceRoleClient();

  const { data } = await service
    .from('listings')
    .select('seller_id')
    .eq('id', listingId)
    .maybeSingle();

  return (data as { seller_id?: string } | null)?.seller_id ?? null;
}
