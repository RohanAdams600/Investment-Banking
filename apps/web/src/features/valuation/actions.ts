'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { INDUSTRY_KEYS, estimateValuation, ValuationInputError } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';
import type { SaveValuationState } from './types';

/**
 * Saves a valuation estimate.
 *
 * The estimate is **recalculated here from the inputs** rather than accepting
 * the numbers the browser computed. The client running the same model is a
 * convenience for live editing; it is not a source of truth, and a stored
 * estimate that came from a tampered or stale client would be indistinguishable
 * from a real one later.
 *
 * Inputs and factors are stored alongside the range so the estimate stays
 * explicable after the model changes. An old estimate whose reasoning cannot be
 * recovered is worse than no record — someone finds it and treats it as current.
 */
const saveSchema = z.object({
  industry: z.enum(INDUSTRY_KEYS as [string, ...string[]]),
  revenueCents: z.number().int().nonnegative(),
  earningsCents: z.number().int(),
  customerConcentration: z.number().min(0).max(1).optional(),
  recurringRevenueShare: z.number().min(0).max(1).optional(),
  revenueGrowth: z.number().min(-1).max(10).optional(),
  yearsInBusiness: z.number().int().min(0).max(300).optional(),
  ownerDependence: z.enum(['absentee', 'moderate', 'critical']).optional(),
});

export type SaveValuationInput = z.infer<typeof saveSchema>;

export async function saveValuation(input: SaveValuationInput): Promise<SaveValuationState> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Those inputs could not be saved.', notice: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to save an estimate.', notice: null };

  const data = parsed.data;

  // The basis is decided by the industry, not by the caller — otherwise an SDE
  // figure could be stored against an EBITDA multiple.
  const { INDUSTRY_PROFILES } = await import('@ib/core');
  const profile = INDUSTRY_PROFILES[data.industry as keyof typeof INDUSTRY_PROFILES];

  let result;
  try {
    result = estimateValuation({
      industry: data.industry as never,
      revenue: data.revenueCents,
      ...(profile.basis === 'sde' ? { sde: data.earningsCents } : { ebitda: data.earningsCents }),
      customerConcentration: data.customerConcentration,
      recurringRevenueShare: data.recurringRevenueShare,
      revenueGrowth: data.revenueGrowth,
      yearsInBusiness: data.yearsInBusiness,
      ownerDependence: data.ownerDependence,
    });
  } catch (thrown) {
    return {
      error:
        thrown instanceof ValuationInputError
          ? thrown.message
          : 'That estimate could not be calculated.',
      notice: null,
    };
  }

  const { error } = await supabase.from('valuation_estimates').insert({
    user_id: user.id,
    industry: data.industry,
    basis: result.basis,
    earnings_cents: result.earnings,
    revenue_cents: data.revenueCents,
    range_low_cents: result.range.low,
    range_high_cents: result.range.high,
    effective_multiple_low: result.effectiveMultipleLow,
    effective_multiple_high: result.effectiveMultipleHigh,
    confidence: result.confidence,
    inputs: data,
    factors: result.factors,
  });

  if (error) {
    return { error: 'Could not save that estimate.', notice: null };
  }

  await recordAuditEvent({
    action: 'valuation.saved',
    entityType: 'valuation_estimate',
    // Industry and confidence only. The range is the seller's private view of
    // what their business is worth, and the audit log is read by administrators.
    metadata: { industry: data.industry, confidence: result.confidence },
  });

  revalidatePath('/tools/valuation');
  return { error: null, notice: 'Estimate saved. Only you can see it.' };
}
