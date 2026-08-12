'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { canTransition, type ListingStatus } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import type { ListingActionState } from './types';
import {
  fullProfileSchema,
  financialYearSchema,
  ndaDecisionSchema,
  ndaSchema,
  saveListingSchema,
  statusChangeSchema,
  teaserSchema,
  uuidSchema,
} from './validation';

/**
 * Writes for the listings feature.
 *
 * Every action here runs against the *user's* Supabase client, so RLS applies
 * to it exactly as it would to a request from the browser. None of them use the
 * service role. That is what makes these actions convenience rather than
 * control: if one of them were deleted tomorrow, no authorisation would be lost
 * with it, because none of them are the thing enforcing the rule.
 *
 * The audit log is the exception — it is written with the service role, from
 * `recordAuditEvent`, because `authenticated` has no INSERT grant on it and
 * must not have one.
 */

function fail(error: string): ListingActionState {
  return { error, message: null };
}

/** Turns a Postgres refusal into something a person can act on. */
function explain(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '42501') {
    // Our own triggers raise 42501 with a written sentence. A policy denial
    // raises the same code with Postgres's wording, which is not useful to a
    // user, so only the readable ones are passed through.
    const stripped = error.message.replace(/^.*?:\s*/, '');
    return /^[A-Z].*[a-z]$/.test(stripped) ? stripped : fallback;
  }
  if (error.code === '23505') return 'That already exists.';
  return fallback;
}

function formBoolean(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true';
}

function optionalEnum(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

// ---------------------------------------------------------------------------
// Creating and editing the teaser
// ---------------------------------------------------------------------------

function parseTeaser(formData: FormData) {
  const firmId = formData.get('firmId');

  return teaserSchema.safeParse({
    headline: formData.get('headline') ?? '',
    summary: formData.get('summary') ?? '',
    industry: formData.get('industry') ?? '',
    jurisdictionCode: formData.get('jurisdictionCode') ?? '',
    revenueBandLow: formData.get('revenueBandLow') ?? '',
    revenueBandHigh: formData.get('revenueBandHigh') ?? '',
    earningsBandLow: formData.get('earningsBandLow') ?? '',
    earningsBandHigh: formData.get('earningsBandHigh') ?? '',
    askingBandLow: formData.get('askingBandLow') ?? '',
    askingBandHigh: formData.get('askingBandHigh') ?? '',
    dealStructure: formData.get('dealStructure') ?? 'asset',
    employeeCount: formData.get('employeeCount') ?? '',
    yearsInBusiness: formData.get('yearsInBusiness') ?? '',
    growthTrend: optionalEnum(formData.get('growthTrend')),
    realEstateIncluded: formBoolean(formData.get('realEstateIncluded')),
    ownerDependence: optionalEnum(formData.get('ownerDependence')),
    reasonForSale: formData.get('reasonForSale') ?? '',
    firmId: typeof firmId === 'string' && firmId !== '' ? firmId : null,
  });
}

function teaserColumns(input: z.infer<typeof teaserSchema>) {
  return {
    headline: input.headline,
    summary: input.summary,
    industry: input.industry,
    jurisdiction_code: input.jurisdictionCode,
    revenue_band_low_cents: input.revenueBandLow,
    revenue_band_high_cents: input.revenueBandHigh,
    earnings_band_low_cents: input.earningsBandLow,
    earnings_band_high_cents: input.earningsBandHigh,
    asking_price_band_low_cents: input.askingBandLow,
    asking_price_band_high_cents: input.askingBandHigh,
    deal_structure: input.dealStructure,
    employee_count: input.employeeCount,
    years_in_business: input.yearsInBusiness,
    growth_trend: input.growthTrend ?? null,
    real_estate_included: input.realEstateIncluded,
    owner_dependence: input.ownerDependence ?? null,
    reason_for_sale: input.reasonForSale,
  };
}

export async function createListing(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = parseTeaser(formData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to create a listing.');

  const limit = await checkRateLimit('createListing', user.id);
  if (!limit.allowed) return fail('Too many listings created just now. Try again later.');

  const { data, error } = await supabase
    .from('listings')
    .insert({
      ...teaserColumns(parsed.data),
      seller_id: user.id,
      firm_id: parsed.data.firmId ?? null,
      // Not passed through from the form. A listing starts as a draft, and the
      // insert policy refuses anything else — sending a status here would be a
      // request the database rejects, so it is not sent.
    })
    .select('id')
    .single();

  if (error || !data) {
    return fail(explain(error ?? { message: '' }, 'Could not create that listing.'));
  }

  await recordAuditEvent({
    action: 'listing.created',
    entityType: 'listing',
    entityId: data.id as string,
    firmId: parsed.data.firmId ?? null,
  });

  redirect(`/listings/${data.id as string}/edit`);
}

export async function updateListing(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const listingId = uuidSchema.safeParse(formData.get('listingId'));
  if (!listingId.success) return fail('Not a valid listing.');

  const parsed = parseTeaser(formData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('listings')
    .update(teaserColumns(parsed.data), { count: 'exact' })
    .eq('id', listingId.data);

  if (error) return fail(explain(error, 'Could not save those changes.'));
  // Zero rows means the policy refused. Postgres reports that as success with
  // nothing matched rather than as an error, which would otherwise read to the
  // user as a save that worked.
  if (count === 0) return fail('You do not have permission to edit this listing.');

  await recordAuditEvent({
    action: 'listing.updated',
    entityType: 'listing',
    entityId: listingId.data,
  });

  revalidatePath(`/listings/${listingId.data}`);
  return { error: null, message: 'Listing saved.' };
}

// ---------------------------------------------------------------------------
// The confidential half
// ---------------------------------------------------------------------------

export async function saveFullProfile(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const listingId = uuidSchema.safeParse(formData.get('listingId'));
  if (!listingId.success) return fail('Not a valid listing.');

  const parsed = fullProfileSchema.safeParse({
    legalName: formData.get('legalName') ?? '',
    tradingName: formData.get('tradingName') ?? '',
    addressLine1: formData.get('addressLine1') ?? '',
    addressLine2: formData.get('addressLine2') ?? '',
    city: formData.get('city') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    website: formData.get('website') ?? '',
    revenueCents: formData.get('revenueCents') ?? '',
    earningsCents: formData.get('earningsCents') ?? '',
    askingPriceCents: formData.get('askingPriceCents') ?? '',
    customerConcentration: formData.get('customerConcentration') ?? '',
    recurringRevenueShare: formData.get('recurringRevenueShare') ?? '',
    keyCustomers: formData.get('keyCustomers') ?? '',
    competitivePosition: formData.get('competitivePosition') ?? '',
    growthOpportunities: formData.get('growthOpportunities') ?? '',
    knownRisks: formData.get('knownRisks') ?? '',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();
  const input = parsed.data;

  const { error } = await supabase.from('listing_details').upsert(
    {
      listing_id: listingId.data,
      legal_name: input.legalName,
      trading_name: input.tradingName,
      address_line1: input.addressLine1,
      address_line2: input.addressLine2,
      city: input.city,
      postal_code: input.postalCode,
      website: input.website,
      revenue_cents: input.revenueCents,
      earnings_cents: input.earningsCents,
      asking_price_cents: input.askingPriceCents,
      customer_concentration: input.customerConcentration,
      recurring_revenue_share: input.recurringRevenueShare,
      key_customers: input.keyCustomers,
      competitive_position: input.competitivePosition,
      growth_opportunities: input.growthOpportunities,
      known_risks: input.knownRisks,
    },
    { onConflict: 'listing_id' },
  );

  if (error) return fail(explain(error, 'Could not save the confidential profile.'));

  // No field values in the metadata. This table is broadly readable by admins
  // and is exported; the legal name and revenue of a business that has not gone
  // to market are exactly what must not leak through the audit trail.
  await recordAuditEvent({
    action: 'listing.profile_updated',
    entityType: 'listing',
    entityId: listingId.data,
  });

  revalidatePath(`/listings/${listingId.data}`);
  return { error: null, message: 'Confidential profile saved.' };
}

export async function addFinancialYear(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = financialYearSchema.safeParse({
    listingId: formData.get('listingId') ?? '',
    fiscalYear: formData.get('fiscalYear') ?? '',
    revenueCents: formData.get('revenueCents') ?? '',
    ebitdaCents: formData.get('ebitdaCents') ?? '',
    sdeCents: formData.get('sdeCents') ?? '',
    addbacksCents: formData.get('addbacksCents') ?? '',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();
  const input = parsed.data;

  const { error } = await supabase.from('listing_financials').upsert(
    {
      listing_id: input.listingId,
      fiscal_year: input.fiscalYear,
      revenue_cents: input.revenueCents,
      ebitda_cents: input.ebitdaCents,
      sde_cents: input.sdeCents,
      addbacks_cents: input.addbacksCents,
    },
    { onConflict: 'listing_id,fiscal_year' },
  );

  if (error) return fail(explain(error, 'Could not save that year.'));

  revalidatePath(`/listings/${input.listingId}`);
  return { error: null, message: `${input.fiscalYear} saved.` };
}

export async function removeFinancialYear(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const rowId = uuidSchema.safeParse(formData.get('rowId'));
  const listingId = uuidSchema.safeParse(formData.get('listingId'));
  if (!rowId.success || !listingId.success) return fail('Not a valid row.');

  const supabase = await createClient();
  const { error } = await supabase.from('listing_financials').delete().eq('id', rowId.data);

  if (error) return fail(explain(error, 'Could not remove that year.'));

  revalidatePath(`/listings/${listingId.data}`);
  return { error: null, message: 'Year removed.' };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function changeListingStatus(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = statusChangeSchema.safeParse({
    listingId: formData.get('listingId') ?? '',
    status: formData.get('status') ?? '',
  });

  if (!parsed.success) return fail('Not a valid status change.');

  const supabase = await createClient();
  const next = parsed.data.status as ListingStatus;

  // Read the current status so the illegal move is caught before it reaches the
  // trigger. This is a nicer message, not a control — the trigger refuses it
  // regardless, and a race between this read and the write ends there.
  const { data: current } = await supabase
    .from('listings')
    .select('status')
    .eq('id', parsed.data.listingId)
    .maybeSingle();

  if (!current) return fail('That listing is no longer available.');

  const from = current.status as ListingStatus;
  if (!canTransition(from, next)) {
    return fail(
      `A listing cannot move from ${from.replace('_', ' ')} to ${next.replace('_', ' ')}.`,
    );
  }

  const { error, count } = await supabase
    .from('listings')
    .update({ status: next }, { count: 'exact' })
    .eq('id', parsed.data.listingId);

  if (error) return fail(explain(error, 'Could not change that status.'));
  if (count === 0) return fail('You do not have permission to change this listing.');

  await recordAuditEvent({
    action: 'listing.status_changed',
    entityType: 'listing',
    entityId: parsed.data.listingId,
    metadata: { from, to: next },
  });

  revalidatePath(`/listings/${parsed.data.listingId}`);
  revalidatePath('/listings/mine');
  return { error: null, message: 'Status updated.' };
}

// ---------------------------------------------------------------------------
// NDAs
// ---------------------------------------------------------------------------

export async function requestNda(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = ndaSchema.safeParse({ listingId: formData.get('listingId') ?? '' });
  if (!parsed.success) return fail('Not a valid listing.');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to request access.');

  const limit = await checkRateLimit('ndaRequest', user.id);
  if (!limit.allowed) {
    return fail('Too many access requests just now. Try again later.');
  }

  const { error } = await supabase.from('listing_ndas').insert({
    listing_id: parsed.data.listingId,
    buyer_id: user.id,
    // Status is left to the column default. The insert policy admits only
    // `requested`, so naming it here would add nothing but a way to get it
    // wrong.
  });

  if (error) {
    if (error.code === '23505') return fail('You have already requested access to this listing.');
    return fail(explain(error, 'Could not request access.'));
  }

  await recordAuditEvent({
    action: 'nda.requested',
    entityType: 'listing',
    entityId: parsed.data.listingId,
  });

  revalidatePath(`/listings/${parsed.data.listingId}`);
  return { error: null, message: 'Access requested. The seller will review it.' };
}

/**
 * The seller issues the NDA.
 *
 * Note what this does *not* do: send anything. It moves the record to `sent`,
 * which is a state the buyer sees when they next open the listing. Outbound
 * email is a separate, human-approved step — no agent or action on this
 * platform sends a message to a third party without somebody clicking send.
 */
export async function sendNda(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = ndaDecisionSchema.safeParse({
    ndaId: formData.get('ndaId') ?? '',
    expiresInMonths: formData.get('expiresInMonths') ?? '',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();

  const expiresAt =
    parsed.data.expiresInMonths === null
      ? null
      : new Date(
          new Date().setMonth(new Date().getMonth() + parsed.data.expiresInMonths),
        ).toISOString();

  const { error, count } = await supabase
    .from('listing_ndas')
    .update({ status: 'sent', expires_at: expiresAt }, { count: 'exact' })
    .eq('id', parsed.data.ndaId);

  if (error) return fail(explain(error, 'Could not send that NDA.'));
  if (count === 0) return fail('You do not have permission to send this NDA.');

  await recordAuditEvent({
    action: 'nda.sent',
    entityType: 'listing_nda',
    entityId: parsed.data.ndaId,
  });

  revalidatePath('/listings');
  return { error: null, message: 'NDA issued. The buyer can now sign it.' };
}

/**
 * The buyer signs.
 *
 * `signed_at` is not sent: the trigger stamps it. Sending a client clock as the
 * time of signature would make the evidentiary record only as good as the
 * browser that wrote it.
 */
export async function signNda(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const ndaId = uuidSchema.safeParse(formData.get('ndaId'));
  const accepted = formBoolean(formData.get('accepted'));

  if (!ndaId.success) return fail('Not a valid agreement.');
  if (!accepted) return fail('Tick the box to confirm you accept the terms.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('listing_ndas')
    .update({ status: 'signed' }, { count: 'exact' })
    .eq('id', ndaId.data);

  if (error) return fail(explain(error, 'Could not record that signature.'));
  if (count === 0) return fail('That agreement is no longer available to sign.');

  await recordAuditEvent({
    action: 'nda.signed',
    entityType: 'listing_nda',
    entityId: ndaId.data,
  });

  revalidatePath('/listings');
  return { error: null, message: 'Signed. The full profile is now available to you.' };
}

export async function revokeNda(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const ndaId = uuidSchema.safeParse(formData.get('ndaId'));
  if (!ndaId.success) return fail('Not a valid agreement.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('listing_ndas')
    .update({ status: 'revoked' }, { count: 'exact' })
    .eq('id', ndaId.data);

  if (error) return fail(explain(error, 'Could not revoke that agreement.'));
  if (count === 0) return fail('You do not have permission to revoke this agreement.');

  await recordAuditEvent({
    action: 'nda.revoked',
    entityType: 'listing_nda',
    entityId: ndaId.data,
  });

  revalidatePath('/listings');
  return { error: null, message: 'Access revoked.' };
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export async function toggleSaved(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = saveListingSchema.safeParse({
    listingId: formData.get('listingId') ?? '',
    saved: formBoolean(formData.get('saved')),
  });

  if (!parsed.success) return fail('Not a valid listing.');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to save listings.');

  const { error } = parsed.data.saved
    ? await supabase
        .from('listing_saves')
        .delete()
        .eq('listing_id', parsed.data.listingId)
        .eq('user_id', user.id)
    : await supabase
        .from('listing_saves')
        .insert({ listing_id: parsed.data.listingId, user_id: user.id });

  if (error) return fail(explain(error, 'Could not update your watchlist.'));

  revalidatePath(`/listings/${parsed.data.listingId}`);
  revalidatePath('/watchlist');
  return { error: null, message: parsed.data.saved ? 'Removed from watchlist.' : 'Saved.' };
}
