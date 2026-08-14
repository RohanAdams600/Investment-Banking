import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The thing that runs the pipeline, and writes down what it did.
 *
 * The specification's workflow is four steps — analyse the submission, value
 * it, find buyers, draft the approach — and the honest description of this
 * module is that it is *bookkeeping around four functions that already exist*.
 * That is deliberate. The valuation is deterministic and lives in
 * `packages/core`; so is the readiness analysis; so is the matcher's scoring.
 * An orchestrator that reimplemented any of them would be a second answer to a
 * question that already has one.
 *
 * What it adds is the part none of them can do alone:
 *
 *   - **A record.** Every step is a row in `agent_runs` with its inputs, its
 *     output and how long it took, so "why was I matched with this" has an
 *     answer three months later.
 *   - **Sequencing.** Matching is worthless before the figures are in, so a
 *     step that depends on a blocked one does not run and says why.
 *   - **The stop.** The fourth step ends at `needs_approval` and cannot report
 *     success. Nothing leaves the platform without a person clicking send.
 *
 * ## Service role, and why
 *
 * Runs are written with the service role because scoring reads every buyer's
 * criteria against a listing's confidential figures — something no user may do
 * and no user needs to. The consequence is that this module must be careful
 * about what it *stores*: see `recordRun`.
 */

export type AgentKind =
  'analyse_listing' | 'value_listing' | 'match_buyers' | 'draft_outreach' | 'review_document';

export type AgentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_approval';

export interface RunRecord {
  kind: AgentKind;
  status: AgentStatus;
  listingId?: string | null;
  dealId?: string | null;
  subjectUserId?: string | null;
  firmId?: string | null;
  /**
   * What was read, never what it said.
   *
   * The distinction is the whole reason this parameter is documented rather
   * than typed as `unknown`: storing the values that went in would make
   * `agent_runs` a second copy of the NDA-gated half of every listing, behind
   * its own policies rather than the ones written for it. Record *which*
   * listing, *how many* years of figures, *which* criteria version — enough to
   * explain the result and re-derive it from the source of truth.
   */
  inputs?: Record<string, unknown>;
  /** What it produced. Already redacted where it derives from confidential data. */
  output?: Record<string, unknown>;
  model?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  error?: string | null;
}

/**
 * Writes one run.
 *
 * Failures here are logged and swallowed, the same way audit writes are: losing
 * the record of a valuation is bad, and failing the seller's valuation because
 * the bookkeeping table was briefly unavailable is worse. This is the line to
 * wire to alerting — a gap here is what somebody disputing a match will need
 * and not find.
 */
export async function recordRun(run: RunRecord): Promise<string | null> {
  const service = createServiceRoleClient();

  const { data, error } = await service
    .from('agent_runs')
    .insert({
      kind: run.kind,
      status: run.status,
      listing_id: run.listingId ?? null,
      deal_id: run.dealId ?? null,
      subject_user_id: run.subjectUserId ?? null,
      firm_id: run.firmId ?? null,
      inputs: run.inputs ?? {},
      output: run.output ?? {},
      model: run.model ?? null,
      provider: run.provider ?? null,
      duration_ms: run.durationMs ?? null,
      error: run.error ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[orchestrator] failed to record run', {
      kind: run.kind,
      status: run.status,
      error: error.message,
    });
    return null;
  }

  return (data as { id: string } | null)?.id ?? null;
}

export interface StepOutcome<T> {
  ok: boolean;
  value: T | null;
  /** Present when the step could not run, in words the subject can act on. */
  reason: string | null;
}

/**
 * Runs one step and records it, whatever happens.
 *
 * The shape exists because the alternative — a try/catch and a `recordRun` at
 * every call site — is a pattern with one line that gets forgotten, and the
 * line that gets forgotten is always the one in the `catch`. A step that throws
 * still produces a row saying it failed and why.
 *
 * `terminalStatus` is a parameter rather than always `'succeeded'` for exactly
 * one caller: drafting outreach finishes at `needs_approval`, and the database
 * refuses to let it claim anything else.
 */
export async function runStep<T>(
  descriptor: Omit<RunRecord, 'status' | 'output' | 'durationMs' | 'error'> & {
    terminalStatus?: Extract<AgentStatus, 'succeeded' | 'needs_approval'>;
  },
  work: () => Promise<{
    output: Record<string, unknown>;
    value: T;
    model?: string | null;
    provider?: string | null;
  }>,
): Promise<StepOutcome<T>> {
  const started = Date.now();

  try {
    const result = await work();

    await recordRun({
      ...descriptor,
      status: descriptor.terminalStatus ?? 'succeeded',
      output: result.output,
      model: result.model ?? descriptor.model ?? null,
      provider: result.provider ?? descriptor.provider ?? null,
      durationMs: Date.now() - started,
    });

    return { ok: true, value: result.value, reason: null };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : 'The step failed.';

    await recordRun({
      ...descriptor,
      status: 'failed',
      durationMs: Date.now() - started,
      error: message.slice(0, 2000),
    });

    return { ok: false, value: null, reason: message };
  }
}

/**
 * Records that a step was skipped because an earlier one blocked it.
 *
 * Written as a failed run rather than left absent, because absence is
 * ambiguous: a seller looking at an empty matching panel cannot tell whether
 * nobody matched or whether the matcher never ran. This makes the pipeline say
 * "not yet, and here is what is in the way".
 */
export async function recordBlocked(
  descriptor: Omit<RunRecord, 'status' | 'output' | 'durationMs' | 'error'>,
  reason: string,
): Promise<void> {
  await recordRun({ ...descriptor, status: 'failed', error: reason });
}
