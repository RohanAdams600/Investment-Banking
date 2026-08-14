'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';

import { runListingPipeline } from './run';

/**
 * Running the pipeline on demand.
 *
 * The seller asks for it. That is not a limitation of the implementation — it
 * is what keeps the four-step workflow from becoming an autonomous agent: every
 * run is something a person started, on a listing they control, and the one
 * step that would reach a third party stops short of doing so regardless.
 */

export interface PipelineState {
  error: string | null;
  message?: string | null;
}

export const emptyPipelineState: PipelineState = { error: null, message: null };

const schema = z.object({ listingId: z.string().uuid('Not a valid listing.') });

export async function runPipeline(
  _prev: PipelineState,
  formData: FormData,
): Promise<PipelineState> {
  const parsed = schema.safeParse({ listingId: formData.get('listingId') });
  if (!parsed.success) return { error: 'Not a valid listing.', message: null };

  const supabase = await createClient();

  /*
   * Control is checked by reading the listing through the *user's* client
   * first.
   *
   * The pipeline itself runs with the service role and would happily analyse
   * any listing handed to it, so this read is the gate: RLS returns nothing for
   * a listing the caller does not control, and the run never starts. Checking
   * inside the pipeline instead would put the gate behind the service role,
   * which is the wrong side of it.
   */
  const { data } = await supabase
    .from('listings')
    .select('id')
    .eq('id', parsed.data.listingId)
    .maybeSingle();

  if (!data) return { error: 'That listing is not yours.', message: null };

  const result = await runListingPipeline(parsed.data.listingId);

  await recordAuditEvent({
    action: 'pipeline.run',
    entityType: 'listing',
    entityId: parsed.data.listingId,
    // Counts, never the findings. Those name the seller's customer
    // concentration, and the audit log is read by platform admins.
    metadata: {
      blocking: result.readiness?.blocking ?? null,
      valued: result.valued,
      matched: result.matchCount,
    },
  });

  revalidatePath(`/listings/${parsed.data.listingId}`);

  if (result.blockedBy) {
    return {
      error: null,
      message: `Analysed. Matching did not run: ${result.blockedBy.toLowerCase()}.`,
    };
  }

  return {
    error: null,
    message:
      result.matchCount === null
        ? 'Analysed.'
        : `Analysed, valued, and scored against ${result.matchCount} ${result.matchCount === 1 ? 'buyer' : 'buyers'}.`,
  };
}
