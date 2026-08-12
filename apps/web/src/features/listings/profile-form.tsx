'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Lock } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '@ib/ui';

import { saveFullProfile } from './actions';
import { emptyListingState, type ListingFullProfile } from './types';

/**
 * The confidential profile.
 *
 * Deliberately a separate card and a separate submission from the teaser. The
 * two halves live in different tables behind different policies, and putting
 * them in one long form would hide the only distinction that matters to the
 * seller: which half strangers can read.
 */
export function ProfileForm({
  listingId,
  profile,
}: {
  listingId: string;
  profile: ListingFullProfile | null;
}) {
  const [state, action] = useActionState(saveFullProfile, emptyListingState);

  const dollars = (cents: number | null | undefined): string =>
    cents === null || cents === undefined ? '' : String(cents / 100);
  const percent = (fraction: number | null | undefined): string =>
    fraction === null || fraction === undefined ? '' : String(Math.round(fraction * 100));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="listingId" value={listingId} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="text-text-muted h-4 w-4" aria-hidden />
            Confidential profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="border-border-default bg-surface-sunken text-text-muted rounded border p-3 text-xs">
            Only a buyer who has signed your NDA can open this, and only while that NDA is in force.
            Revoking it closes their access immediately. Nothing here appears on the public listing.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Legal name"
              name="legalName"
              required
              maxLength={300}
              defaultValue={profile?.legalName ?? ''}
            />
            <Input
              label="Trading name"
              name="tradingName"
              maxLength={300}
              defaultValue={profile?.tradingName ?? ''}
            />
            <Input
              label="Address"
              name="addressLine1"
              maxLength={300}
              defaultValue={profile?.addressLine1 ?? ''}
            />
            <Input
              label="Address line 2"
              name="addressLine2"
              maxLength={300}
              defaultValue={profile?.addressLine2 ?? ''}
            />
            <Input label="City" name="city" maxLength={200} defaultValue={profile?.city ?? ''} />
            <Input
              label="Postal code"
              name="postalCode"
              maxLength={20}
              defaultValue={profile?.postalCode ?? ''}
            />
            <Input
              label="Website"
              name="website"
              type="url"
              maxLength={500}
              defaultValue={profile?.website ?? ''}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Revenue"
              name="revenueCents"
              numeric
              inputMode="decimal"
              defaultValue={dollars(profile?.revenueCents)}
              hint="Whole dollars"
            />
            <Input
              label="Earnings"
              name="earningsCents"
              numeric
              inputMode="decimal"
              defaultValue={dollars(profile?.earningsCents)}
              hint="SDE or EBITDA"
            />
            <Input
              label="Asking price"
              name="askingPriceCents"
              numeric
              inputMode="decimal"
              defaultValue={dollars(profile?.askingPriceCents)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Largest customer share"
              name="customerConcentration"
              numeric
              inputMode="decimal"
              defaultValue={percent(profile?.customerConcentration)}
              hint="Percent of revenue from your biggest customer. Buyers ask early."
            />
            <Input
              label="Recurring revenue share"
              name="recurringRevenueShare"
              numeric
              inputMode="decimal"
              defaultValue={percent(profile?.recurringRevenueShare)}
              hint="Percent under contract or on repeat"
            />
          </div>

          <Textarea
            label="Key customers"
            name="keyCustomers"
            maxLength={4000}
            defaultValue={profile?.keyCustomers ?? ''}
          />
          <Textarea
            label="Competitive position"
            name="competitivePosition"
            maxLength={4000}
            defaultValue={profile?.competitivePosition ?? ''}
          />
          <Textarea
            label="Growth opportunities"
            name="growthOpportunities"
            maxLength={4000}
            defaultValue={profile?.growthOpportunities ?? ''}
          />
          <Textarea
            label="Known risks"
            name="knownRisks"
            maxLength={4000}
            defaultValue={profile?.knownRisks ?? ''}
            hint="Disclosing a problem early costs less than a buyer finding it in diligence."
          />

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <SubmitButton />
        </CardContent>
      </Card>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Save confidential profile
    </Button>
  );
}
