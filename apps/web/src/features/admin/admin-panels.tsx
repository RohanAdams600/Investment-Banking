'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { brand } from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '@ib/ui';

import { emptyAdminState, reviewListing, setJurisdiction, setVerification } from './actions';
import type { JurisdictionRow, ReviewItem, VerificationItem } from './queries';

/**
 * The admin panel's screens.
 *
 * A recurring shape here: the operator sees what they need to decide and not
 * one field more. The review queue has no revenue figure and no legal name —
 * not because they are filtered out in this file, but because the database will
 * not give them to an admin at all. If a future version of this component asks
 * for them it will get nulls, which is the correct outcome.
 */

// ===========================================================================
// Listing review
// ===========================================================================

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const [state, action] = useActionState(reviewListing, emptyAdminState);

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing waiting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-muted text-sm">
            No listings have been submitted for review. They arrive here when a seller finishes a
            draft and asks to publish.
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
      <p aria-live="polite" className="text-text-muted text-sm">
        {state.message}
      </p>

      {items.map((item) => (
        <ReviewCard key={item.id} item={item} action={action} />
      ))}
    </div>
  );
}

function ReviewCard({ item, action }: { item: ReviewItem; action: (formData: FormData) => void }) {
  const [returning, setReturning] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>{item.headline}</CardTitle>
          <span className="text-text-muted text-xs">
            Submitted {new Date(item.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge>{item.industry.replace(/_/g, ' ')}</Badge>
          {item.jurisdictionCode ? <Badge>{item.jurisdictionCode}</Badge> : null}
          <Badge variant={item.hasProfile ? 'success' : 'warning'}>
            {item.hasProfile ? 'Profile complete' : 'No confidential profile'}
          </Badge>
          <Badge variant={item.financialYears >= 2 ? 'success' : 'warning'}>
            {item.financialYears} {item.financialYears === 1 ? 'year' : 'years'} of figures
          </Badge>
        </div>

        <p className="text-text-muted text-xs">
          You are shown whether the seller filled in the confidential half, not what it says.
          Moderating a listing does not grant access to the business behind it.
        </p>

        {returning ? (
          <form action={action} className="space-y-3">
            <input type="hidden" name="listingId" value={item.id} />
            <input type="hidden" name="decision" value="draft" />
            <Textarea
              label="Why it is going back"
              name="reason"
              required
              rows={3}
              placeholder="The headline names the business, which breaks confidentiality. Rephrase it and resubmit."
              hint="The seller sees this. Buyers never do. Be specific enough that they can fix it in one pass."
            />
            <div className="flex gap-2">
              <Submit label="Send back to the seller" variant="secondary" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setReturning(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <form action={action}>
              <input type="hidden" name="listingId" value={item.id} />
              <input type="hidden" name="decision" value="live" />
              <Submit label="Publish to the market" />
            </form>
            <Button type="button" variant="secondary" size="sm" onClick={() => setReturning(true)}>
              Send back
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Verification
// ===========================================================================

export function VerificationQueue({ items }: { items: VerificationItem[] }) {
  const [state, action] = useActionState(setVerification, emptyAdminState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-text-muted text-xs">
          Verification records that your team checked who somebody is. It is a statement about your
          own process, not a guarantee to the other side of a deal — and every screen that shows a
          verified badge says so.
        </p>

        {items.length === 0 ? (
          <p className="text-text-muted text-sm">No accounts yet.</p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.userId} className="border-border-subtle border-b pb-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{item.fullName ?? 'No name given'}</p>
                    <p className="text-text-muted text-xs">{item.email ?? '—'}</p>
                  </div>
                  <Badge variant={verificationVariant(item.status)}>{item.status}</Badge>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {item.roles.length === 0 ? (
                    <span className="text-text-muted text-xs">No roles yet</span>
                  ) : (
                    item.roles.map((role) => (
                      <Badge key={role} variant="primary">
                        {role.replace(/_/g, ' ')}
                      </Badge>
                    ))
                  )}
                </div>

                <VerificationControls userId={item.userId} status={item.status} action={action} />
              </li>
            ))}
          </ul>
        )}

        {state.error ? (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {state.message}
        </p>
      </CardContent>
    </Card>
  );
}

function VerificationControls({
  userId,
  status,
  action,
}: {
  userId: string;
  status: VerificationItem['status'];
  action: (formData: FormData) => void;
}) {
  const [rejecting, setRejecting] = useState(false);

  if (rejecting) {
    return (
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="status" value="rejected" />
        <Textarea
          label="Why"
          name="note"
          required
          rows={2}
          hint="Kept in the audit log for your own team. The account holder does not see it."
        />
        <div className="flex gap-2">
          <Submit label="Reject" variant="secondary" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {status !== 'verified' ? (
        <form action={action}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="status" value="verified" />
          <Submit label="Verify" />
        </form>
      ) : (
        <form action={action}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="status" value="unverified" />
          <Submit label="Withdraw verification" variant="secondary" />
        </form>
      )}

      {status !== 'rejected' ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(true)}>
          Reject
        </Button>
      ) : null}
    </div>
  );
}

function verificationVariant(
  status: VerificationItem['status'],
): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'verified') return 'success';
  if (status === 'pending') return 'info';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

// ===========================================================================
// Jurisdictions
// ===========================================================================

export function JurisdictionTable({ rows }: { rows: JurisdictionRow[] }) {
  const [state, action] = useActionState(setJurisdiction, emptyAdminState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where {brand.name} operates</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-text-muted text-sm">
          Turning a state on opens it to new business. It does not verify a licence, check a
          registration, or make the platform compliant there — that work is yours, and this switch
          only records that you have done it.
        </p>

        {rows.length === 0 ? (
          <p className="text-text-muted text-sm">No jurisdictions configured.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.code}
                className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm">
                    <span className="font-mono text-xs">{row.code}</span> · {row.name}
                  </p>
                  {Object.keys(row.requirements).length > 0 ? (
                    <p className="text-text-muted text-xs">
                      {Object.keys(row.requirements).length} recorded requirement
                      {Object.keys(row.requirements).length === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant={row.isActive ? 'success' : 'neutral'}>
                    {row.isActive ? 'Open' : 'Closed'}
                  </Badge>
                  <form action={action}>
                    <input type="hidden" name="code" value={row.code} />
                    <input type="hidden" name="isActive" value={row.isActive ? 'false' : 'true'} />
                    <Submit label={row.isActive ? 'Close' : 'Open'} variant="secondary" />
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        {state.error ? (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {state.message}
        </p>
      </CardContent>
    </Card>
  );
}

// ===========================================================================

function Submit({
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
