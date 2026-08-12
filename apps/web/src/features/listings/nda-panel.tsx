'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { NDA_STATUS_LABELS } from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { requestNda, signNda } from './actions';
import { emptyListingState, type ListingNda } from './types';

/**
 * The buyer's side of the gate.
 *
 * The panel states plainly what each step does and what the seller gets in
 * return, because a confidentiality agreement the signer did not read is worth
 * very little to either party. It also never claims the agreement is legally
 * sufficient — the template is a starting point the seller can have reviewed,
 * not advice, and the wording here says so.
 */
export function NdaPanel({ listingId, nda }: { listingId: string; nda: ListingNda | null }) {
  const [requestState, requestAction] = useActionState(requestNda, emptyListingState);
  const [signState, signAction] = useActionState(signNda, emptyListingState);

  const state = nda?.status ?? 'none';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Lock className="text-text-muted h-4 w-4" aria-hidden />
            Full profile
          </span>
          <Badge variant={state === 'signed' ? 'success' : 'neutral'}>
            {NDA_STATUS_LABELS[state]}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {state === 'none' ? (
          <>
            <p className="text-text-secondary text-sm">
              The company name, address, exact financials and customer concentration are held back
              until you have signed the seller&rsquo;s confidentiality agreement. Request access and
              the seller decides whether to issue one.
            </p>
            <form action={requestAction}>
              <input type="hidden" name="listingId" value={listingId} />
              <SubmitButton label="Request access" />
            </form>
          </>
        ) : null}

        {state === 'requested' ? (
          <p className="text-text-secondary text-sm">
            Your request is with the seller. You will see the agreement here once they issue it.
          </p>
        ) : null}

        {state === 'sent' && nda ? (
          <form action={signAction} className="space-y-3">
            <input type="hidden" name="ndaId" value={nda.id} />

            <p className="text-text-secondary text-sm">
              The seller has issued a confidentiality agreement. Signing it opens the full profile
              for as long as the agreement stays in force.
              {nda.expiresAt ? (
                <> Access is set to expire on {new Date(nda.expiresAt).toLocaleDateString()}.</>
              ) : (
                <> No expiry date has been set.</>
              )}
            </p>

            <div className="flex items-start gap-2">
              <input
                id="accepted"
                type="checkbox"
                name="accepted"
                required
                className="border-border-default text-primary focus-visible:ring-ring mt-0.5 h-4 w-4 rounded focus-visible:ring-2"
              />
              <label htmlFor="accepted" className="text-sm">
                I have read the agreement and accept its terms.
              </label>
            </div>

            <p className="text-text-muted text-xs">
              This is an electronic signature and it is recorded, with the time, against your
              account. Cairn provides the template and the record; it does not act as your lawyer,
              and nothing here is legal advice. Have the agreement reviewed if the terms matter to
              you.
            </p>

            <SubmitButton label="Sign and open the profile" />
          </form>
        ) : null}

        {state === 'signed' ? (
          <p className="text-text-secondary flex items-start gap-2 text-sm">
            <ShieldCheck className="text-success mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Signed{nda?.signedAt ? ` on ${new Date(nda.signedAt).toLocaleDateString()}` : ''}. The
              full profile is open to you below
              {nda?.expiresAt ? ` until ${new Date(nda.expiresAt).toLocaleDateString()}` : ''}. The
              seller can revoke access at any time.
            </span>
          </p>
        ) : null}

        {state === 'revoked' ? (
          <p className="text-text-secondary text-sm">
            The seller has revoked this agreement, so the full profile is closed. Your signature
            stays on record and the confidentiality obligations you accepted still apply.
          </p>
        ) : null}

        {state === 'expired' ? (
          <p className="text-text-secondary text-sm">
            This agreement has expired and the full profile is closed. Ask the seller to issue a new
            one if you are still interested.
          </p>
        ) : null}

        {(requestState.error ?? signState.error) ? (
          <p role="alert" className="text-danger text-sm">
            {requestState.error ?? signState.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {requestState.message ?? signState.message}
        </p>
      </CardContent>
    </Card>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}
