'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  INDUSTRY_PROFILES,
  brand,
  composeOutreach,
  formatBand,
  outreachBlockers,
  unconfiguredBrandFields,
  type FitReason,
  type IndustryKey,
  type OutreachInput,
} from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { recomputeMatchesForBuyer, recomputeMatchesForListing } from './recompute';
import type { OutreachActionState } from './types';

/**
 * Matching and outreach actions.
 *
 * The recompute functions run with the service role and are reached only from
 * here, never from a route the client controls the arguments of — a buyer must
 * not be able to trigger a rescore of somebody else's listing, and the two
 * exported recompute actions derive their subject from the session or from a
 * listing the caller demonstrably controls.
 */

const uuidSchema = z.string().uuid('Not a valid identifier.');

function fail(error: string): OutreachActionState {
  return { error, message: null };
}

/**
 * The sender details every commercial message needs.
 *
 * `mailingAddress` ships with a development placeholder, and a placeholder in
 * the footer of a real email is not untidy — it is a false disclosure. So an
 * unconfigured address is reported as *absent* rather than passed through, and
 * `outreachBlockers()` then refuses the message for the right reason.
 *
 * The opt-out link is derived from the site URL rather than configured
 * separately; there is one unsubscribe endpoint and it belongs to the brand.
 */
function senderDisclosures(): Pick<OutreachInput, 'senderPostalAddress' | 'unsubscribeUrl'> {
  const addressConfigured = !unconfiguredBrandFields.includes('mailingAddress');

  return {
    senderPostalAddress: addressConfigured ? brand.mailingAddress : undefined,
    unsubscribeUrl: `${brand.url.replace(/\/$/, '')}/unsubscribe`,
  };
}

// ---------------------------------------------------------------------------
// Recompute
// ---------------------------------------------------------------------------

/** Rescores the signed-in buyer against the market. Subject is the session. */
export async function refreshMyMatches(): Promise<OutreachActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to refresh your matches.');

  const limit = await checkRateLimit('recomputeMatches', user.id);
  if (!limit.allowed) return fail('Matches were refreshed recently. Try again in a few minutes.');

  const scored = await recomputeMatchesForBuyer(user.id);

  revalidatePath('/matches');
  return {
    error: null,
    message: scored === 0 ? 'No listings to score yet.' : `Scored ${scored} listings.`,
  };
}

/**
 * Rescores every buyer against one listing.
 *
 * Authorisation is not taken on trust: the caller's own client reads the
 * listing first, so RLS decides whether they may see it, and control is checked
 * before the service role is used for anything.
 */
export async function refreshListingMatches(listingId: string): Promise<OutreachActionState> {
  const id = uuidSchema.safeParse(listingId);
  if (!id.success) return fail('Not a valid listing.');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to refresh matches.');

  // `controls_listing` in the database, asked through the user's own client.
  const { data: controls } = await supabase.rpc('match_summary', { target_listing_id: id.data });
  if (!controls) return fail('You do not have permission to do that for this listing.');

  const limit = await checkRateLimit('recomputeMatches', user.id, id.data);
  if (!limit.allowed) return fail('Matches were refreshed recently. Try again in a few minutes.');

  const scored = await recomputeMatchesForListing(id.data);

  revalidatePath(`/listings/${id.data}/edit`);
  return { error: null, message: `Scored ${scored} buyers.` };
}

// ---------------------------------------------------------------------------
// Buyer identity
// ---------------------------------------------------------------------------

/** Dollars in the form, integer cents in the database. */
const moneyField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Math.round(Number(value) * 100)))
  .refine((value) => value === null || (Number.isSafeInteger(value) && value >= 0), {
    message: 'Enter a positive amount.',
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value));

const buyerProfileSchema = z
  .object({
    entityName: optionalText(300),
    headline: optionalText(200),
    bio: optionalText(4000),
    fundingSource: optionalText(200),
    linkedinUrl: optionalText(500),
    website: optionalText(500),
    capitalLow: moneyField,
    capitalHigh: moneyField,
    priorAcquisitions: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : Number(value)))
      .refine(
        (value) => value === null || (Number.isInteger(value) && value >= 0 && value < 10_000),
        {
          message: 'Enter a whole number.',
        },
      ),
    isDiscoverable: z.boolean(),
  })
  .refine(
    (data) =>
      data.capitalLow === null || data.capitalHigh === null || data.capitalHigh >= data.capitalLow,
    { message: 'The top of the range must be at least the bottom.', path: ['capitalHigh'] },
  );

/**
 * Saves the buyer's identity and their consent to be found.
 *
 * `is_discoverable` lives on the criteria row rather than the profile, because
 * it governs matching rather than identity — a buyer with no criteria has
 * nothing to be discovered through.
 */
export async function saveBuyerProfile(
  _prev: OutreachActionState,
  formData: FormData,
): Promise<OutreachActionState> {
  const parsed = buyerProfileSchema.safeParse({
    entityName: formData.get('entityName') ?? '',
    headline: formData.get('headline') ?? '',
    bio: formData.get('bio') ?? '',
    fundingSource: formData.get('fundingSource') ?? '',
    linkedinUrl: formData.get('linkedinUrl') ?? '',
    website: formData.get('website') ?? '',
    capitalLow: formData.get('capitalLow') ?? '',
    capitalHigh: formData.get('capitalHigh') ?? '',
    priorAcquisitions: formData.get('priorAcquisitions') ?? '',
    isDiscoverable: formData.get('isDiscoverable') === 'on',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to save your profile.');

  const input = parsed.data;

  const { error } = await supabase.from('buyer_profiles').upsert(
    {
      user_id: user.id,
      entity_name: input.entityName,
      headline: input.headline,
      bio: input.bio,
      funding_source: input.fundingSource,
      linkedin_url: input.linkedinUrl,
      website: input.website,
      capital_available_low_cents: input.capitalLow,
      capital_available_high_cents: input.capitalHigh,
      prior_acquisitions: input.priorAcquisitions,
    },
    { onConflict: 'user_id' },
  );

  if (error) return fail('Could not save your profile.');

  // Only touches the live criteria row. A buyer with none yet has nothing to
  // set, and will get the default when they save criteria.
  await supabase
    .from('acquisition_criteria')
    .update({ is_discoverable: input.isDiscoverable })
    .eq('user_id', user.id)
    .is('superseded_at', null);

  revalidatePath('/buyer-profile');
  return { error: null, message: 'Profile saved.' };
}

// ---------------------------------------------------------------------------
// Outreach
// ---------------------------------------------------------------------------

/**
 * Generates a personalised draft for one matched buyer.
 *
 * Everything the message can say comes from the teaser and the buyer's own
 * redacted match reasons. The confidential profile is never read here — see the
 * note on `OutreachInput` in packages/core, whose shape has no field for it.
 *
 * Nothing is sent. The row is created as `draft`, and the database refuses any
 * other starting state.
 */
const generateSchema = z.object({
  listingId: uuidSchema,
  recipientId: uuidSchema,
});

export async function generateOutreachDraft(
  _prev: OutreachActionState,
  formData: FormData,
): Promise<OutreachActionState> {
  const parsed = generateSchema.safeParse({
    listingId: formData.get('listingId'),
    recipientId: formData.get('recipientId'),
  });

  if (!parsed.success) return fail('Not a valid recipient.');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to draft outreach.');

  const limit = await checkRateLimit('outreachDraft', user.id);
  if (!limit.allowed) {
    return fail('Too many drafts generated just now. Try again shortly.');
  }

  // Read through the user's client: if they do not control the listing, RLS
  // returns nothing and the draft is never composed.
  const { data: listing } = await supabase
    .from('listings')
    .select(
      'id, headline, industry, jurisdiction_code, earnings_band_low_cents, earnings_band_high_cents, jurisdictions ( name )',
    )
    .eq('id', parsed.data.listingId)
    .maybeSingle();

  if (!listing) return fail('That listing is not available.');

  const row = listing as Record<string, unknown>;
  const jurisdiction = Array.isArray(row.jurisdictions)
    ? (row.jurisdictions[0] as { name?: string } | undefined)
    : (row.jurisdictions as { name?: string } | null);

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', parsed.data.recipientId)
    .maybeSingle();

  const composed = composeOutreach({
    headline: row.headline as string,
    industryLabel:
      INDUSTRY_PROFILES[row.industry as IndustryKey]?.label ?? (row.industry as string),
    location: jurisdiction?.name,
    earningsBand: formatBand(
      {
        lowCents: (row.earnings_band_low_cents as number | null) ?? null,
        highCents: (row.earnings_band_high_cents as number | null) ?? null,
      },
      '',
    ),
    recipientName: (profile as { full_name?: string } | null)?.full_name ?? null,
    senderName: user.email ?? 'The seller',
    brandName: brand.name,
    ...senderDisclosures(),
  });

  const { error } = await supabase.from('outreach_drafts').insert({
    listing_id: parsed.data.listingId,
    recipient_id: parsed.data.recipientId,
    created_by: user.id,
    subject: composed.subject,
    body: composed.body,
    generated_by: 'composeOutreach',
  });

  if (error) return fail('Could not create that draft.');

  await recordAuditEvent({
    action: 'outreach.drafted',
    entityType: 'listing',
    entityId: parsed.data.listingId,
  });

  revalidatePath(`/listings/${parsed.data.listingId}/edit`);
  return { error: null, message: 'Draft created. Read it, then approve it to send.' };
}

/** Edits a draft before approval. */
export async function updateOutreachDraft(
  _prev: OutreachActionState,
  formData: FormData,
): Promise<OutreachActionState> {
  const id = uuidSchema.safeParse(formData.get('draftId'));
  const body = z.string().trim().min(1).max(10_000).safeParse(formData.get('body'));
  const subject = z
    .string()
    .trim()
    .max(300)
    .safeParse(formData.get('subject') ?? '');

  if (!id.success) return fail('Not a valid draft.');
  if (!body.success) return fail('The message cannot be empty.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('outreach_drafts')
    .update(
      { body: body.data, subject: subject.success ? subject.data || null : null },
      { count: 'exact' },
    )
    .eq('id', id.data);

  if (error) {
    // The trigger raises this when the draft was already approved. Editing
    // approved words would make the approval evidence of something else.
    return fail(
      error.code === '42501'
        ? 'This draft has been approved. Return it to draft before editing.'
        : 'Could not save that draft.',
    );
  }
  if (count === 0) return fail('You do not have permission to edit this draft.');

  return { error: null, message: 'Draft saved.' };
}

/**
 * A person approves specific words.
 *
 * `approved_by` is not sent — the trigger stamps it from `auth.uid()`. An
 * approver who could name somebody else as the approver would not be an audit
 * trail.
 */
export async function approveOutreachDraft(
  _prev: OutreachActionState,
  formData: FormData,
): Promise<OutreachActionState> {
  const id = uuidSchema.safeParse(formData.get('draftId'));
  const confirmed = formData.get('confirmed') === 'on' || formData.get('confirmed') === 'true';

  if (!id.success) return fail('Not a valid draft.');
  if (!confirmed) return fail('Tick the box to confirm you have read the message.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('outreach_drafts')
    .update({ status: 'approved' }, { count: 'exact' })
    .eq('id', id.data);

  if (error) return fail('Could not approve that draft.');
  if (count === 0) return fail('You do not have permission to approve this draft.');

  await recordAuditEvent({
    action: 'outreach.approved',
    entityType: 'outreach_draft',
    entityId: id.data,
  });

  return { error: null, message: 'Approved. It can now be sent.' };
}

export async function discardOutreachDraft(
  _prev: OutreachActionState,
  formData: FormData,
): Promise<OutreachActionState> {
  const id = uuidSchema.safeParse(formData.get('draftId'));
  if (!id.success) return fail('Not a valid draft.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('outreach_drafts')
    .update({ status: 'discarded' }, { count: 'exact' })
    .eq('id', id.data);

  if (error) return fail('Could not discard that draft.');
  if (count === 0) return fail('You do not have permission to discard this draft.');

  return { error: null, message: 'Discarded.' };
}

/**
 * Reports what would stop this message being sent as a commercial email.
 *
 * Called before offering approval, so the UI can say what is missing rather
 * than disabling a button silently. It supports the sender's compliance
 * process; it does not certify compliance, and the wording in the UI says so.
 */
export async function checkOutreachReadiness(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return outreachBlockers({
    headline: 'placeholder',
    industryLabel: 'placeholder',
    senderName: user?.email ?? '',
    brandName: brand.name,
    ...senderDisclosures(),
  });
}

/** Re-exported so pages import reasons from one place. */
export type OutreachReasons = FitReason[];
