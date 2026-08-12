'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  LISTING_STATUS_LABELS,
  LISTING_TRANSITIONS,
  LISTING_TRANSITION_LABELS,
  isTerminal,
  type ListingStatus,
} from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { changeListingStatus } from './actions';
import { emptyListingState, type ListingStatusEntry } from './types';

/**
 * Moving a listing through its lifecycle.
 *
 * The buttons come from `LISTING_TRANSITIONS`, which a test drives through real
 * Postgres against the trigger that enforces the same rules — so the UI cannot
 * offer a move the database will refuse. Nothing here is the control: the
 * trigger is, and this reads from the same map it was checked against.
 */
export function StatusControl({
  listingId,
  status,
  history,
}: {
  listingId: string;
  status: ListingStatus;
  history: ListingStatusEntry[];
}) {
  const [state, action] = useActionState(changeListingStatus, emptyListingState);
  const moves = LISTING_TRANSITIONS[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Status</span>
          <Badge variant={badgeVariant(status)}>{LISTING_STATUS_LABELS[status]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isTerminal(status) ? (
          <p className="text-text-muted text-sm">
            {LISTING_STATUS_LABELS[status]} is final. Commission records and the audit trail point
            at this listing, so it cannot be reopened — bringing the business back to market means a
            new listing.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {moves.map((next) => (
              <form key={next} action={action}>
                <input type="hidden" name="listingId" value={listingId} />
                <input type="hidden" name="status" value={next} />
                <MoveButton
                  label={LISTING_TRANSITION_LABELS[next]}
                  destructive={next === 'withdrawn'}
                />
              </form>
            ))}
          </div>
        )}

        {status === 'draft' ? (
          <p className="text-text-muted text-xs">
            Drafts are visible only to you. Submitting for review is what puts the listing in front
            of the platform team.
          </p>
        ) : null}

        {state.error ? (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {state.message}
        </p>

        {history.length > 0 ? (
          <div className="border-border-subtle border-t pt-3">
            <h3 className="text-text-secondary mb-2 text-xs font-medium">History</h3>
            <ol className="space-y-1">
              {history.map((entry) => (
                <li key={entry.id} className="text-text-muted flex justify-between gap-4 text-xs">
                  <span>
                    {entry.fromStatus
                      ? `${LISTING_STATUS_LABELS[entry.fromStatus]} → ${LISTING_STATUS_LABELS[entry.toStatus]}`
                      : `Created as ${LISTING_STATUS_LABELS[entry.toStatus]}`}
                  </span>
                  <time dateTime={entry.changedAt}>
                    {new Date(entry.changedAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function badgeVariant(status: ListingStatus): 'neutral' | 'success' | 'info' | 'warning' {
  if (status === 'live') return 'success';
  if (status === 'under_loi' || status === 'under_contract') return 'info';
  if (status === 'pending_review') return 'warning';
  return 'neutral';
}

function MoveButton({ label, destructive }: { label: string; destructive: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={destructive ? 'secondary' : 'primary'}
      loading={pending}
    >
      {label}
    </Button>
  );
}
