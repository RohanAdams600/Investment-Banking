'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { NDA_STATUS_LABELS } from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select } from '@ib/ui';

import { revokeNda, sendNda } from './actions';
import { emptyListingState, type ListingNdaRequest } from './types';

/**
 * The seller's queue of access requests.
 *
 * Issuing an NDA here does not email anybody. It moves the record to `sent`,
 * which the buyer sees the next time they open the listing — outbound
 * communication to a third party is always a separate step a person approves,
 * never a side effect of a status change.
 */
export function NdaQueue({ requests }: { requests: ListingNdaRequest[] }) {
  const [sendState, sendAction] = useActionState(sendNda, emptyListingState);
  const [revokeState, revokeAction] = useActionState(revokeNda, emptyListingState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access requests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {requests.length === 0 ? (
          <p className="text-text-muted text-sm">
            No buyer has asked for the full profile yet. Requests appear here once the listing is on
            the market.
          </p>
        ) : (
          <ul className="space-y-3">
            {requests.map((request) => (
              <li key={request.id} className="border-border-subtle border-b pb-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {request.buyerName ?? 'Identity withheld'}
                    </p>
                    <p className="text-text-muted text-xs">
                      Requested {new Date(request.requestedAt).toLocaleDateString()}
                      {request.expiresAt
                        ? ` · expires ${new Date(request.expiresAt).toLocaleDateString()}`
                        : ''}
                    </p>
                  </div>
                  <Badge variant={request.status === 'signed' ? 'success' : 'neutral'}>
                    {NDA_STATUS_LABELS[request.status]}
                  </Badge>
                </div>

                {request.status === 'requested' ? (
                  <form action={sendAction} className="mt-3 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="ndaId" value={request.id} />
                    <Select
                      label="Access lasts"
                      name="expiresInMonths"
                      defaultValue="12"
                      className="w-40"
                    >
                      <option value="3">3 months</option>
                      <option value="6">6 months</option>
                      <option value="12">12 months</option>
                      <option value="24">24 months</option>
                      <option value="">No expiry</option>
                    </Select>
                    <ActionButton label="Issue NDA" />
                  </form>
                ) : null}

                {(request.status === 'sent' || request.status === 'signed') &&
                request.revokedAt === null ? (
                  <form action={revokeAction} className="mt-3">
                    <input type="hidden" name="ndaId" value={request.id} />
                    <ActionButton label="Revoke access" variant="secondary" />
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="text-text-muted text-xs">
          Issuing an NDA does not send an email. The buyer sees it the next time they open your
          listing. Revoking closes the full profile immediately, but does not undo what a buyer has
          already read.
        </p>

        {(sendState.error ?? revokeState.error) ? (
          <p role="alert" className="text-danger text-sm">
            {sendState.error ?? revokeState.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {sendState.message ?? revokeState.message}
        </p>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  label,
  variant = 'primary',
}: {
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {label}
    </Button>
  );
}
