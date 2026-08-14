import type { ReadinessFinding } from '@ib/core';

/**
 * The pipeline's shapes, and the two pure readers over them.
 *
 * Separate from `queries.ts` because that module is `server-only` and the panel
 * that renders these is a client component. Importing a `server-only` module
 * from `'use client'` is a build error, and the right fix is this split rather
 * than dropping the marker — `queries.ts` holds a service-role-adjacent read and
 * has no business in a browser bundle.
 */

export type PipelineStepKind =
  'analyse_listing' | 'value_listing' | 'match_buyers' | 'draft_outreach' | 'review_document';

export type PipelineStepStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_approval';

export interface PipelineStep {
  kind: PipelineStepKind;
  status: PipelineStepStatus;
  output: Record<string, unknown>;
  error: string | null;
  model: string | null;
  finishedAt: string | null;
}

/** The findings from the most recent analysis, typed. */
export function findingsFrom(step: PipelineStep | undefined): ReadinessFinding[] {
  if (!step) return [];
  const findings = step.output.findings;
  return Array.isArray(findings) ? (findings as ReadinessFinding[]) : [];
}

export interface ValuationOutput {
  overallLow: number | null;
  overallHigh: number | null;
  methodsDisagree: boolean;
  missingInputs: string[];
  methods: Array<{
    key: string;
    label: string;
    rangeLow: number | null;
    rangeHigh: number | null;
    rationale: string;
    weight: number;
  }>;
  disclaimer: string;
}

/**
 * The valuation output, or null.
 *
 * Null for a step that failed as well as one that is absent, because a panel
 * that rendered a half-written output as if it were a valuation would show
 * somebody a price range built from nothing.
 */
export function valuationFrom(step: PipelineStep | undefined): ValuationOutput | null {
  if (!step || step.status !== 'succeeded') return null;
  const output = step.output as unknown as ValuationOutput;
  return Array.isArray(output.methods) ? output : null;
}
