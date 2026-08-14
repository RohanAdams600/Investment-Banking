'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatMoney } from '@ib/core';
import { AIDisclaimer, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { emptyPipelineState, runPipeline } from './actions';
import { findingsFrom, valuationFrom, type PipelineStep } from './types';

/**
 * What the pipeline did, shown to the seller.
 *
 * The design constraint is the one the specification states: every surface that
 * says "the platform thinks X" has to show what X was computed from. So each
 * finding carries its own evidence line, the valuation shows every method
 * including the ones that did not apply and why, and a step that did not run
 * says which earlier problem stopped it.
 *
 * There is no overall score. A number invites "get it to 80" and hides which of
 * the remaining two problems is the one that matters.
 */

const STEP_LABELS: Record<string, string> = {
  analyse_listing: 'Analysis',
  value_listing: 'Valuation',
  match_buyers: 'Buyer matching',
  draft_outreach: 'Outreach drafts',
  review_document: 'Document review',
};

export function PipelinePanel({ listingId, steps }: { listingId: string; steps: PipelineStep[] }) {
  const [state, action] = useActionState(runPipeline, emptyPipelineState);

  const byKind = new Map(steps.map((step) => [step.kind, step]));
  const analysis = byKind.get('analyse_listing');
  const valuation = valuationFrom(byKind.get('value_listing'));
  const matching = byKind.get('match_buyers');

  const findings = findingsFrom(analysis);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>What the platform can tell you</CardTitle>
          <form action={action}>
            <input type="hidden" name="listingId" value={listingId} />
            <Submit label={steps.length === 0 ? 'Analyse this listing' : 'Run again'} />
          </form>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {steps.length === 0 ? (
          <p className="text-text-muted text-sm">
            Nothing has run yet. The analysis checks your listing against what buyers ask for,
            values it several ways, and scores it against the buyers already on the platform. None
            of it is sent anywhere — it runs on our own servers, against your own figures.
          </p>
        ) : null}

        {/* --- what is wrong --------------------------------------------- */}

        {analysis ? (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{STEP_LABELS.analyse_listing}</h3>
              <StepBadge step={analysis} />
            </div>

            {findings.length === 0 ? (
              <p className="text-text-secondary text-sm">
                Nothing to fix. This listing has what buyers usually ask for.
              </p>
            ) : (
              <ul className="space-y-3">
                {findings.map((finding) => (
                  <li key={finding.code} className="border-border-subtle rounded border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{finding.title}</p>
                      <Badge
                        variant={
                          finding.severity === 'blocking'
                            ? 'danger'
                            : finding.severity === 'important'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {finding.severity === 'blocking'
                          ? 'Stops publication'
                          : finding.severity === 'important'
                            ? 'Costs you offers'
                            : 'Worth knowing'}
                      </Badge>
                    </div>
                    {/*
                      The evidence line is what makes this arguable. "Your
                      concentration is a concern" is an opinion; "60% of
                      revenue, and buyers discount above 30%" is a fact and a
                      stated convention the seller can disagree with out loud.
                    */}
                    <p className="text-text-muted mt-1 text-xs">{finding.evidence}</p>
                    <p className="text-text-secondary mt-2 text-xs">{finding.action}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* --- what it might be worth ------------------------------------ */}

        {byKind.has('value_listing') ? (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{STEP_LABELS.value_listing}</h3>
              <StepBadge step={byKind.get('value_listing')!} />
            </div>

            {valuation ? (
              <>
                {valuation.overallLow !== null && valuation.overallHigh !== null ? (
                  <p className="font-mono text-lg tabular-nums">
                    {formatMoney(valuation.overallLow)} – {formatMoney(valuation.overallHigh)}
                  </p>
                ) : null}

                <ul className="space-y-2">
                  {valuation.methods.map((method) => (
                    <li key={method.key} className="text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-text-secondary">{method.label}</span>
                        <span className="font-mono tabular-nums">
                          {method.rangeLow !== null && method.rangeHigh !== null
                            ? `${formatMoney(method.rangeLow)} – ${formatMoney(method.rangeHigh)}`
                            : 'Does not apply'}
                        </span>
                      </div>
                      <p className="text-text-muted">{method.rationale}</p>
                    </li>
                  ))}
                </ul>

                {valuation.methodsDisagree ? (
                  <p className="text-text-secondary text-xs">
                    The methods disagree by more than usual. That spread is information: it normally
                    means the earnings and the revenue tell different stories, and a buyer will ask
                    which one to believe.
                  </p>
                ) : null}

                {valuation.missingInputs.length > 0 ? (
                  <p className="text-text-muted text-xs">
                    Would sharpen this: {valuation.missingInputs.join(', ')}.
                  </p>
                ) : null}

                <AIDisclaimer variant="valuation" />
              </>
            ) : (
              <p className="text-text-muted text-sm">
                {byKind.get('value_listing')?.error ?? 'Not available.'}
              </p>
            )}
          </section>
        ) : null}

        {/* --- who might buy it ------------------------------------------ */}

        {matching ? (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{STEP_LABELS.match_buyers}</h3>
              <StepBadge step={matching} />
            </div>

            {matching.status === 'succeeded' ? (
              <p className="text-text-secondary text-sm">
                Scored against {String(matching.output.buyersScored ?? 0)} buyers who have told us
                what they are looking for. Their names and what they said are on the buyers panel —
                nothing has been sent to any of them.
              </p>
            ) : (
              <p className="text-text-muted text-sm">{matching.error ?? 'Did not run.'}</p>
            )}
          </section>
        ) : null}

        {state.error ? (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        ) : null}
        <p aria-live="polite" className="text-text-muted text-sm">
          {state.message}
        </p>

        <p className="text-text-muted text-xs">
          Your exact figures never leave our servers. The only thing any AI model is shown is the
          anonymised version buyers already see, plus what a buyer wrote about what they want —
          never your revenue, your customers or your name.
        </p>
      </CardContent>
    </Card>
  );
}

function StepBadge({ step }: { step: PipelineStep }) {
  if (step.status === 'succeeded') {
    return <Badge variant="success">Done</Badge>;
  }
  if (step.status === 'needs_approval') {
    return <Badge variant="warning">Waiting for you</Badge>;
  }
  if (step.status === 'failed') {
    return <Badge variant="neutral">Did not run</Badge>;
  }
  return <Badge>{step.status}</Badge>;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}
