import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * What the pipeline currently says about one listing.
 *
 * Read through the user's client, so a seller sees their own runs and nobody
 * else's — the run output carries findings derived from the confidential half
 * ("largest customer is 60% of revenue"), which is fine to show the person
 * whose business it is and nobody else.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export {
  findingsFrom,
  valuationFrom,
  type PipelineStep,
  type PipelineStepKind,
  type PipelineStepStatus,
  type ValuationOutput,
} from './types';

import type { PipelineStep } from './types';

/**
 * The latest run of each step.
 *
 * Through `listing_pipeline_state()` rather than a query with a limit, because
 * the naive version — order by time, take four — returns four runs of whichever
 * step happens to run most often. The `distinct on (kind)` is the whole reason
 * that function exists.
 */
export async function loadPipelineState(listingId: string): Promise<PipelineStep[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('listing_pipeline_state', {
    target_listing_id: listingId,
  });

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    kind: row.kind,
    status: row.status,
    output: (row.output ?? {}) as Record<string, unknown>,
    error: row.error ?? null,
    model: row.model ?? null,
    finishedAt: row.finished_at ?? null,
  }));
}
