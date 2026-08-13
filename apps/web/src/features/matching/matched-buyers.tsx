'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { formatMoneyCompact } from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, VerifiedBadge } from '@ib/ui';

import { generateOutreachDraft, refreshListingMatches } from './actions';
import { emptyOutreachState, type MatchedBuyer, type MatchSummary } from './types';

/**
 * The buyers who match this listing, by name.
 *
 * The first cut of this panel showed counts only. That was wrong: a seller who
 * cannot see who matched cannot decide who to approach, and the whole point of
 * a marketplace is that the two sides can find each other. The business stays
 * anonymous until an NDA is signed; the people do not.
 *
 * Buyers appear here having consented — `is_discoverable` on their criteria —
 * and a buyer who turns it off keeps their own match feed and disappears from
 * this list entirely.
 */
export function MatchedBuyers({
  listingId,
  summary,
  buyers,
}: {
  listingId: string;
  summary: MatchSummary;
  buyers: MatchedBuyer[];
}) {
  const [refreshState, refreshAction] = useActionState(
    async () => refreshListingMatches(listingId),
    emptyOutreachState,
  );
  const [draftState, draftAction] = useActionState(generateOutreachDraft, emptyOutreachState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Matched buyers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-4">
          <Stat label="Buyers matched" value={String(summary.totalBuyers)} />
          <Stat label="Strong fits" value={String(summary.strongMatches)} />
          <Stat
            label="Best fit"
            value={summary.bestScore === null ? '—' : `${summary.bestScore}%+`}
          />
        </dl>

        {buyers.length === 0 ? (
          <p className="text-text-muted text-sm">
            No buyers match yet. Matching runs on the exact figures in your confidential profile, so
            fill in revenue and earnings at minimum — buyers never see those numbers, only how well
            they fit.
          </p>
        ) : (
          <ul className="space-y-3">
            {buyers.map((buyer) => (
              <li key={buyer.buyerId} className="border-border-subtle border-b pb-3 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {buyer.fullName ?? buyer.entityName ?? 'Buyer'}
                      {buyer.verificationStatus === 'verified' ? <VerifiedBadge /> : null}
                    </p>
                    {buyer.entityName && buyer.fullName ? (
                      <p className="text-text-muted text-xs">{buyer.entityName}</p>
                    ) : null}
                    {buyer.headline ? (
                      <p className="text-text-secondary mt-1 text-xs">{buyer.headline}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {buyer.hasNda ? <Badge variant="info">NDA in place</Badge> : null}
                    <Badge variant={buyer.score >= 70 ? 'success' : 'neutral'}>
                      {buyer.score}% fit
                    </Badge>
                  </div>
                </div>

                <dl className="text-text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {buyer.fundingSource ? (
                    <Detail label="Funding" value={buyer.fundingSource} />
                  ) : null}
                  {buyer.priorAcquisitions !== null ? (
                    <Detail label="Prior deals" value={String(buyer.priorAcquisitions)} />
                  ) : null}
                  {buyer.capitalLowCents !== null || buyer.capitalHighCents !== null ? (
                    <Detail
                      label="Capital"
                      value={capitalRange(buyer.capitalLowCents, buyer.capitalHighCents)}
                    />
                  ) : null}
                </dl>

                {buyer.aiRationale ? (
                  <p className="text-text-secondary mt-2 flex items-start gap-1.5 text-xs">
                    <Sparkles className="text-text-muted mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      <span className="text-text-muted">
                        AI read of their stated thesis
                        {buyer.aiScore !== null ? ` (${buyer.aiScore}%)` : ''}:
                      </span>{' '}
                      {buyer.aiRationale}
                    </span>
                  </p>
                ) : null}

                <form action={draftAction} className="mt-2">
                  <input type="hidden" name="listingId" value={listingId} />
                  <input type="hidden" name="recipientId" value={buyer.buyerId} />
                  <DraftButton />
                </form>
              </li>
            ))}
          </ul>
        )}

        <p className="text-text-muted text-xs">
          Buyers appear here because they chose to be discoverable. Drafting an introduction does
          not send it — you approve the exact wording first, and nothing leaves the platform until
          you do.
        </p>

        <form action={refreshAction}>
          <RefreshButton />
        </form>

        {(refreshState.error ?? draftState.error) ? (
          <p role="alert" className="text-danger text-sm">
            {refreshState.error ?? draftState.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {refreshState.message ?? draftState.message}
        </p>
      </CardContent>
    </Card>
  );
}

function capitalRange(low: number | null, high: number | null): string {
  if (low !== null && high !== null) {
    return `${formatMoneyCompact(low)} – ${formatMoneyCompact(high)}`;
  }
  if (low !== null) return `${formatMoneyCompact(low)}+`;
  if (high !== null) return `Up to ${formatMoneyCompact(high)}`;
  return '—';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd className="font-mono text-2xl tabular-nums">{value}</dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="text-text-secondary">{value}</dd>
    </div>
  );
}

function DraftButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending}>
      Draft an introduction
    </Button>
  );
}

function RefreshButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" loading={pending}>
      Rescore buyers
    </Button>
  );
}
