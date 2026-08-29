'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CAPACITY_BAND_LABELS,
  CAPACITY_BAND_ORDER,
  FUNDING_EVIDENCE_LABELS,
  VERIFICATION_DISCLAIMER,
  VERIFICATION_VALID_DAYS,
  type FundingEvidenceKind,
} from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, Textarea } from '@ib/ui';

import { emptyVerificationState, submitVerification, withdrawVerification } from './actions';
import type { OwnVerification } from './queries';

/**
 * The buyer's side of verification.
 *
 * ## What it deliberately does not ask for
 *
 * No amount, no account number, no upload. The buyer states a band and
 * describes what they can produce; an operator asks for the document out of
 * band and reads it. A bank letter sitting in a platform-wide table is a larger
 * liability than the feature is worth, and an exact figure is leverage that
 * would eventually reach a seller.
 *
 * The page says all of that plainly, because a buyer asked for financial
 * evidence deserves to know where it goes and who sees it.
 */
export function VerificationForm({ current }: { current: OwnVerification | null }) {
  const [state, action] = useActionState(submitVerification, emptyVerificationState);
  const [withdrawState, withdrawAction] = useActionState(
    withdrawVerification,
    emptyVerificationState,
  );

  const decided = current?.status === 'verified' || current?.status === 'rejected';
  const error = state.error ?? withdrawState.error;

  return (
    <div className="space-y-6">
      {current ? <CurrentStatus current={current} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{current ? 'Your submission' : 'Verify your funding'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-text-secondary max-w-prose text-sm leading-relaxed">
            Sellers on this marketplace are being asked to hand the name of their company and their
            exact figures to somebody they have never met. Verification is how you answer the
            question they are actually asking, before they ask it.
          </p>

          <div className="border-border-subtle space-y-2 border-l-2 pl-4">
            <p className="text-text-secondary text-sm leading-relaxed">
              <strong className="text-text-primary">A seller never sees this form.</strong> They see
              a status and a broad range — never the note you write below, never an exact figure,
              never a document.
            </p>
            <p className="text-text-muted text-sm leading-relaxed">
              Do not attach account numbers or statements here. Describe what you can produce, and
              an operator will ask you for it directly.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}

          {decided ? (
            <p className="text-text-muted text-sm">
              This submission has been reviewed and can no longer be edited. To change it, withdraw
              it and submit again.
            </p>
          ) : (
            <form action={action} className="space-y-5">
              <Select
                label="What are you bringing to a purchase?"
                name="evidenceKind"
                defaultValue={current?.evidenceKind ?? 'sba_preapproval'}
              >
                {(Object.keys(FUNDING_EVIDENCE_LABELS) as FundingEvidenceKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {FUNDING_EVIDENCE_LABELS[kind]}
                  </option>
                ))}
              </Select>

              <Select
                label="Roughly what size of business can you acquire?"
                name="capacityBand"
                defaultValue={current?.capacityBand ?? 'from_1m_to_5m'}
                hint="A range, never an exact figure. This is the only part of your submission a seller ever sees."
              >
                {CAPACITY_BAND_ORDER.map((band) => (
                  <option key={band} value={band}>
                    {CAPACITY_BAND_LABELS[band]}
                  </option>
                ))}
              </Select>

              <Textarea
                label="What evidence can you produce?"
                name="evidenceNote"
                rows={4}
                maxLength={2000}
                defaultValue={current?.evidenceNote ?? ''}
                hint="For example: “SBA pre-approval letter from a named bank, dated this quarter.” Read only by an operator reviewing your submission."
              />

              <Submit label={current ? 'Update submission' : 'Submit for review'} />
            </form>
          )}

          {current && current.status !== 'withdrawn' ? (
            <form action={withdrawAction} className="border-border-subtle border-t pt-5">
              <Button type="submit" variant="ghost" size="sm">
                Withdraw this submission
              </Button>
            </form>
          ) : null}

          <p className="text-text-muted border-border-subtle max-w-prose border-t pt-5 text-xs leading-relaxed">
            {VERIFICATION_DISCLAIMER} A completed review stands for {VERIFICATION_VALID_DAYS} days,
            after which it lapses and sellers see it as out of date.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentStatus({ current }: { current: OwnVerification }) {
  const tone =
    current.status === 'verified' ? 'success' : current.status === 'pending' ? 'warning' : 'neutral';

  const heading =
    current.status === 'verified'
      ? 'Reviewed'
      : current.status === 'pending'
        ? 'Waiting on review'
        : current.status === 'rejected'
          ? 'Not confirmed'
          : 'Withdrawn';

  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={tone}>{heading}</Badge>
          <span className="text-text-muted text-xs">
            Submitted {new Date(current.submittedAt).toLocaleDateString()}
            {current.reviewedAt
              ? ` · reviewed ${new Date(current.reviewedAt).toLocaleDateString()}`
              : ''}
          </span>
        </div>

        {current.status === 'verified' && current.expiresAt ? (
          <p className="text-text-secondary text-sm">
            Sellers see this as current until {new Date(current.expiresAt).toLocaleDateString()}.
          </p>
        ) : null}

        {/*
          The reviewer's note, shown to the buyer. A rejection somebody cannot
          understand becomes a support message and then a complaint, and the
          usual reason is a missing document rather than a judgement about them.
        */}
        {current.reviewNote ? (
          <div className="border-border-subtle border-l-2 pl-4">
            <p className="text-text-muted mb-1 font-mono text-xs uppercase tracking-[0.12em]">
              From the reviewer
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">{current.reviewNote}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}
