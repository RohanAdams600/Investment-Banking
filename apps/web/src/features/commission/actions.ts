'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { calculateCommission, CommissionInputError, type FeeStructure } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import {
  STEP_UP_ACTIONS,
  StepUpRequiredError,
  stepUpIfPossible,
  stepUpPrompt,
} from '@/lib/auth/assurance';
import { createClient } from '@/lib/supabase/server';

/**
 * Writes for the commission feature.
 *
 * The fee is always recalculated server-side from the agreement and the sale
 * price. The browser never sends an amount — a client that could name the fee
 * could name any fee, and this is the number that ends up on an invoice.
 */

export interface CommissionState {
  error: string | null;
  message?: string | null;
}

export const emptyCommissionState: CommissionState = { error: null, message: null };

function fail(error: string): CommissionState {
  return { error, message: null };
}

const moneyField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Math.round(Number(value) * 100)))
  .refine((value) => value === null || (Number.isSafeInteger(value) && value >= 0), {
    message: 'Enter a positive amount.',
  });

const percentField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Number(value) / 100))
  .refine((value) => value === null || (value >= 0 && value <= 1), {
    message: 'Enter a percentage between 0 and 100.',
  });

const agreementSchema = z.object({
  firmId: z.string().uuid('Not a valid firm.'),
  structure: z.enum(['lehman', 'double_lehman', 'flat', 'tiered']),
  flatRate: percentField,
  minimumFee: moneyField,
  coBrokerShare: percentField,
  retainer: moneyField,
});

/**
 * Sets the firm's fee schedule.
 *
 * The previous agreement is superseded rather than edited, so a fee computed
 * last quarter stays explicable under the terms that produced it. Same reason
 * `acquisition_criteria` supersedes and `legal_templates` versions.
 */
export async function saveFeeAgreement(
  _prev: CommissionState,
  formData: FormData,
): Promise<CommissionState> {
  const parsed = agreementSchema.safeParse({
    firmId: formData.get('firmId'),
    structure: formData.get('structure'),
    flatRate: formData.get('flatRate') ?? '',
    minimumFee: formData.get('minimumFee') ?? '',
    coBrokerShare: formData.get('coBrokerShare') ?? '',
    retainer: formData.get('retainer') ?? '',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const input = parsed.data;

  if (input.structure === 'flat' && input.flatRate === null) {
    return fail('A flat fee needs a percentage.');
  }
  if (input.structure === 'tiered') {
    // Custom schedules are built through a dedicated editor, not this form.
    // Accepting the structure here without tiers would violate the check
    // constraint and produce an error nobody can act on.
    return fail('Custom tiers are configured separately.');
  }

  /*
   * A fee schedule decides what every deal at the firm charges, and changing it
   * from a stolen session is a quiet, lucrative attack — nobody notices a rate
   * table until an invoice looks wrong months later. Step-up for any account
   * that has a second factor; see `stepUpIfPossible` for what happens to the
   * accounts that do not.
   */
  try {
    await stepUpIfPossible(STEP_UP_ACTIONS.commissionSettings);
  } catch (thrown) {
    if (thrown instanceof StepUpRequiredError) {
      return fail(stepUpPrompt(STEP_UP_ACTIONS.commissionSettings));
    }
    throw thrown;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to set a fee schedule.');

  await supabase
    .from('fee_agreements')
    .update({ superseded_at: new Date().toISOString() })
    .eq('firm_id', input.firmId)
    .is('listing_id', null)
    .is('superseded_at', null);

  const { error } = await supabase.from('fee_agreements').insert({
    firm_id: input.firmId,
    structure: input.structure,
    flat_rate: input.flatRate,
    minimum_fee_cents: input.minimumFee,
    co_broker_share: input.coBrokerShare,
    retainer_cents: input.retainer,
    created_by: user.id,
  });

  if (error) {
    return fail(
      error.code === '42501'
        ? 'Only an owner or admin of the firm can set its fee schedule.'
        : 'Could not save that schedule.',
    );
  }

  await recordAuditEvent({
    action: 'fee_agreement.created',
    entityType: 'firm',
    entityId: input.firmId,
    firmId: input.firmId,
    metadata: { structure: input.structure },
  });

  revalidatePath('/commissions');
  return { error: null, message: 'Fee schedule saved.' };
}

const recordSchema = z.object({
  firmId: z.string().uuid('Not a valid firm.'),
  listingId: z.string().uuid().optional().nullable(),
  salePrice: moneyField.refine((value) => value !== null, 'Enter the sale price.'),
});

/**
 * Records a fee against a sale.
 *
 * Created as `projected`. Marking it earned is a separate act, because a fee is
 * owed when the deal closes and not when somebody types a number into a form.
 */
export async function recordCommission(
  _prev: CommissionState,
  formData: FormData,
): Promise<CommissionState> {
  const listingId = formData.get('listingId');

  const parsed = recordSchema.safeParse({
    firmId: formData.get('firmId'),
    listingId: typeof listingId === 'string' && listingId !== '' ? listingId : null,
    salePrice: formData.get('salePrice') ?? '',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the values entered.');
  }

  const supabase = await createClient();

  const { data: agreement } = await supabase
    .from('fee_agreements')
    .select('*')
    .eq('firm_id', parsed.data.firmId)
    .is('listing_id', null)
    .is('superseded_at', null)
    .maybeSingle();

  if (!agreement) {
    return fail('Set a fee schedule for the firm before recording a commission against it.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = agreement as Record<string, any>;

  let result;
  try {
    // Recalculated here, from the stored agreement. The browser never sends an
    // amount — a client that could name the fee could name any fee.
    result = calculateCommission(
      {
        structure: row.structure as FeeStructure,
        flatRate: row.flat_rate === null ? undefined : Number(row.flat_rate),
        tiers: row.tiers ?? undefined,
        minimumFeeCents: row.minimum_fee_cents === null ? undefined : Number(row.minimum_fee_cents),
        coBrokerShare: row.co_broker_share === null ? undefined : Number(row.co_broker_share),
      },
      parsed.data.salePrice!,
    );
  } catch (thrown) {
    // A malformed schedule surfaces here rather than producing a wrong invoice.
    return fail(
      thrown instanceof CommissionInputError ? thrown.message : 'Could not calculate that fee.',
    );
  }

  const { error } = await supabase.from('commission_records').insert({
    firm_id: parsed.data.firmId,
    listing_id: parsed.data.listingId,
    agreement_id: row.id,
    sale_price_cents: parsed.data.salePrice,
    calculated_fee_cents: result.calculatedFeeCents,
    total_fee_cents: result.totalFeeCents,
    co_broker_fee_cents: result.coBrokerFeeCents,
    net_fee_cents: result.netFeeCents,
    bands: result.bands,
  });

  if (error) {
    return fail(
      error.code === '42501'
        ? 'Only an owner or admin of the firm can record a commission.'
        : 'Could not record that commission.',
    );
  }

  await recordAuditEvent({
    action: 'commission.recorded',
    entityType: 'firm',
    entityId: parsed.data.firmId,
    firmId: parsed.data.firmId,
    metadata: { status: 'projected' },
  });

  revalidatePath('/commissions');
  return { error: null, message: 'Commission recorded.' };
}

const statusSchema = z.object({
  recordId: z.string().uuid('Not a valid record.'),
  status: z.enum(['earned', 'settled', 'waived']),
  reason: z.string().trim().max(1000).optional(),
});

export async function updateCommissionStatus(
  _prev: CommissionState,
  formData: FormData,
): Promise<CommissionState> {
  const parsed = statusSchema.safeParse({
    recordId: formData.get('recordId'),
    status: formData.get('status'),
    reason: formData.get('reason') || undefined,
  });

  if (!parsed.success) return fail('Not a valid change.');

  if (parsed.data.status === 'waived' && !parsed.data.reason) {
    // The check constraint refuses it too. Asking here produces a sentence
    // somebody can act on rather than a constraint violation.
    return fail('Say why the fee is being waived. A write-off with no reason cannot be explained.');
  }

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('commission_records')
    .update(
      {
        status: parsed.data.status,
        waived_reason: parsed.data.status === 'waived' ? parsed.data.reason : null,
      },
      { count: 'exact' },
    )
    .eq('id', parsed.data.recordId);

  if (error) {
    // The transition trigger raises 42501 with a written sentence for the cases
    // somebody can act on — settling something never earned, reopening a
    // settled fee.
    const stripped = error.message.replace(/^.*?:\s*/, '');
    return fail(
      error.code === '42501' && /^[A-Z].*[a-z]$/.test(stripped)
        ? stripped
        : 'Could not update that record.',
    );
  }
  if (count === 0) return fail('You do not have permission to change this record.');

  await recordAuditEvent({
    action: `commission.${parsed.data.status}`,
    entityType: 'commission_record',
    entityId: parsed.data.recordId,
  });

  revalidatePath('/commissions');
  return { error: null, message: 'Updated.' };
}
