'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { INDUSTRY_KEYS } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import type { CriteriaFormState, CriteriaSaveResult } from './types';

/**
 * Persists a buyer's acquisition criteria.
 *
 * Saving supersedes the previous set rather than updating it. A buyer whose
 * recommendations change should be able to see that it followed a change in
 * what they asked for — otherwise the matching engine looks like it drifted on
 * its own, which is the fastest way to lose trust in a ranking nobody can audit.
 */

/** Dollars in the form, integer cents in the database. */
const moneyField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Math.round(Number(value) * 100)))
  .refine((value) => value === null || (Number.isSafeInteger(value) && value >= 0), {
    message: 'Enter a positive amount.',
  });

/** Percent in the form, 0–1 fraction in the database. */
const percentField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Number(value) / 100))
  .refine((value) => value === null || (value >= 0 && value <= 1), {
    message: 'Enter a percentage between 0 and 100.',
  });

const criteriaSchema = z
  .object({
    industries: z.array(z.enum(INDUSTRY_KEYS as [string, ...string[]])).max(20),
    jurisdictions: z.array(z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)).max(60),
    revenueMin: moneyField,
    revenueMax: moneyField,
    earningsMin: moneyField,
    earningsMax: moneyField,
    dealSizeMax: moneyField,
    dealStructure: z.enum(['asset', 'stock', 'either']),
    involvement: z.enum(['owner_operator', 'passive', 'either']),
    maxCustomerConcentration: percentField,
    minRecurringRevenueShare: percentField,
    thesis: z.string().trim().max(4000),
  })
  // Caught here rather than left to the database constraint, so the message is
  // one a person can act on instead of a constraint violation.
  .refine((data) => !(data.revenueMin && data.revenueMax) || data.revenueMax >= data.revenueMin, {
    message: 'Maximum revenue must be at least the minimum.',
    path: ['revenueMax'],
  })
  .refine(
    (data) => !(data.earningsMin && data.earningsMax) || data.earningsMax >= data.earningsMin,
    { message: 'Maximum earnings must be at least the minimum.', path: ['earningsMax'] },
  );

export async function saveCriteria(form: CriteriaFormState): Promise<CriteriaSaveResult> {
  const parsed = criteriaSchema.safeParse(form);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the values entered.', notice: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to save your criteria.', notice: null };

  const input = parsed.data;

  // Supersede first. A partial unique index allows only one live set per user,
  // so this has to happen before the insert rather than after.
  const { error: supersedeError } = await supabase
    .from('acquisition_criteria')
    .update({ superseded_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('superseded_at', null);

  if (supersedeError) {
    return { error: 'Could not save your criteria.', notice: null };
  }

  const { error: insertError } = await supabase.from('acquisition_criteria').insert({
    user_id: user.id,
    industries: input.industries,
    jurisdictions: input.jurisdictions,
    revenue_min_cents: input.revenueMin,
    revenue_max_cents: input.revenueMax,
    earnings_min_cents: input.earningsMin,
    earnings_max_cents: input.earningsMax,
    deal_size_max_cents: input.dealSizeMax,
    deal_structure: input.dealStructure,
    involvement: input.involvement,
    max_customer_concentration: input.maxCustomerConcentration,
    min_recurring_revenue_share: input.minRecurringRevenueShare,
    thesis: input.thesis === '' ? null : input.thesis,
  });

  if (insertError) {
    return { error: 'Could not save your criteria.', notice: null };
  }

  await recordAuditEvent({
    action: 'criteria.saved',
    entityType: 'acquisition_criteria',
    // Counts and flags, never the thesis text — that is a buyer's negotiating
    // position and the audit log is read by administrators.
    metadata: {
      industries: input.industries.length,
      jurisdictions: input.jurisdictions.length,
      has_hard_limits: Boolean(
        input.dealSizeMax || input.maxCustomerConcentration || input.minRecurringRevenueShare,
      ),
    },
  });

  revalidatePath('/tools/buyer-criteria');
  return { error: null, notice: 'Criteria saved. Matches will use these from now on.' };
}
