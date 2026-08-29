'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CAPACITY_BAND_LABELS,
  FUNDING_EVIDENCE_LABELS,
  VERIFICATION_VALID_DAYS,
} from '@ib/core';
import { Badge, Button, Card, CardContent, Textarea } from '@ib/ui';

import { decideVerification, emptyVerificationState } from './actions';
import type { VerificationQueueItem } from './queries';

/**
 * The operator's review queue.
 *
 * ## The evidence is not here
 *
 * What the buyer wrote is a description of what they can produce, not the
 * document itself. The reviewer's job is to ask for it directly, look at it,
 * and record the outcome — which is why there is no "approve" shortcut on a row
 * and no bulk action. A queue that can be cleared in one gesture is a queue
 * that gets cleared without being read, and a seller reads this badge as
 * evidence that somebody looked.
 *
 * The note field is not optional in spirit: a rejection nobody can understand
 * comes back as a support message. It is shown to the buyer verbatim.
 */
export function ReviewQueue({ items }: { items: VerificationQueueItem[] }) {
  const [state, action] = useActionState(decideVerification, emptyVerificationState);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10">
          <p className="text-text-muted text-sm">
            Nothing to review. Buyer submissions appear here as they arrive.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {state.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}

      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="space-y-4 py-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display truncate text-base font-semibold">
                  {item.buyerName ?? 'Buyer'}
                </p>
                <p className="text-text-muted mt-1 text-xs">
                  Submitted {new Date(item.submittedAt).toLocaleDateString()}
                  {item.reviewedAt
                    ? ` · decided ${new Date(item.reviewedAt).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <Badge
                variant={
                  item.status === 'verified'
                    ? 'success'
                    : item.status === 'pending'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {item.status}
              </Badge>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-text-muted font-mono text-xs uppercase tracking-[0.12em]">
                  Bringing
                </dt>
                <dd className="text-sm">{FUNDING_EVIDENCE_LABELS[item.evidenceKind]}</dd>
              </div>
              <div>
                <dt className="text-text-muted font-mono text-xs uppercase tracking-[0.12em]">
                  Stated capacity
                </dt>
                <dd className="text-sm">{CAPACITY_BAND_LABELS[item.capacityBand]}</dd>
              </div>
            </dl>

            {item.evidenceNote ? (
              <div className="border-border-subtle border-l-2 pl-4">
                <p className="text-text-muted mb-1 font-mono text-xs uppercase tracking-[0.12em]">
                  What they say they can produce
                </p>
                {/* Plain text. Never rendered as markup — this is a stranger's input. */}
                <p className="text-text-secondary whitespace-pre-wrap text-sm leading-relaxed">
                  {item.evidenceNote}
                </p>
              </div>
            ) : null}

            {item.status === 'pending' ? (
              <form action={action} className="border-border-subtle space-y-3 border-t pt-4">
                <input type="hidden" name="buyerId" value={item.buyerId} />
                <Textarea
                  label="Note to the buyer"
                  name="reviewNote"
                  rows={2}
                  maxLength={2000}
                  hint="Shown to them verbatim. On a rejection, say what was missing."
                />
                <div className="flex flex-wrap gap-2">
                  <Decide
                    value="verified"
                    label={`Confirm for ${VERIFICATION_VALID_DAYS} days`}
                  />
                  <Decide value="rejected" label="Not confirmed" variant="secondary" />
                </div>
              </form>
            ) : item.reviewNote ? (
              <p className="text-text-muted border-border-subtle border-t pt-4 text-sm">
                {item.reviewNote}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Decide({
  value,
  label,
  variant = 'primary',
}: {
  value: string;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={value}
      variant={variant}
      size="sm"
      disabled={pending}
    >
      {label}
    </Button>
  );
}
