'use client';

import { formatMoney, type MultiMethodValuation } from '@ib/core';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

/**
 * The business valued several ways at once.
 *
 * A single range invites the reader to treat it as *the* number, and businesses
 * are not valued that way. A buyer will look at the earnings multiple, the
 * revenue multiple, and what the assets are worth — and the spread between
 * those is itself information. When they disagree, that is said out loud rather
 * than averaged away.
 *
 * Methods that do not apply are shown with the reason, not hidden. A blank
 * where a number should be reads as a fault; "does not apply because the
 * business is at break-even" is an answer.
 */
export function MethodsPanel({ valuation }: { valuation: MultiMethodValuation }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Valued several ways</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {valuation.overall ? (
            <div>
              <p className="text-text-muted text-xs">Across every method that applies</p>
              <p className="font-mono text-2xl tabular-nums">
                {formatMoney(valuation.overall.low)}
                <span className="text-text-muted mx-2">–</span>
                {formatMoney(valuation.overall.high)}
              </p>
            </div>
          ) : null}

          {valuation.methodsDisagree ? (
            <p className="border-warning/30 bg-warning-subtle/60 text-text-secondary rounded border p-3 text-xs">
              These methods do not overlap. That usually means the business owns more than it earns,
              or earns more than it owns — either way it is worth understanding before you set a
              price, because a buyer will notice the same thing.
            </p>
          ) : null}

          <ul className="space-y-3">
            {valuation.methods.map((method) => (
              <li key={method.key} className="border-border-subtle border-b pb-3 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{method.label}</h3>
                  {method.range ? (
                    <p className="font-mono text-sm tabular-nums">
                      {formatMoney(method.range.low)}
                      <span className="text-text-muted mx-1">–</span>
                      {formatMoney(method.range.high)}
                    </p>
                  ) : (
                    <Badge>Does not apply</Badge>
                  )}
                </div>

                {method.multipleLow !== undefined && method.basisLabel ? (
                  <p className="text-text-muted mt-0.5 text-xs">
                    {method.multipleLow.toFixed(1)}× – {method.multipleHigh?.toFixed(1)}×{' '}
                    {method.basisLabel.toLowerCase()}
                  </p>
                ) : null}

                <p className="text-text-secondary mt-1 text-xs">{method.rationale}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {valuation.metrics.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What the numbers say</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {valuation.metrics.map((metric) => (
                <div key={metric.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm">{metric.label}</dt>
                    <dd className="font-mono text-sm tabular-nums">{metric.value}</dd>
                  </div>
                  {metric.interpretation ? (
                    <p className="text-text-muted mt-0.5 text-xs">{metric.interpretation}</p>
                  ) : null}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {valuation.missingInputs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What would sharpen this</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-text-secondary list-disc space-y-1 pl-4 text-sm">
              {valuation.missingInputs.map((missing) => (
                <li key={missing}>{missing}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-text-muted text-xs">
        You can list your business at any price you choose. These figures are here to inform that
        decision, not to set it — you know things about your business that no model does.
      </p>
    </div>
  );
}
