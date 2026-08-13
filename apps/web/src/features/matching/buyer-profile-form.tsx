'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '@ib/ui';

import { saveBuyerProfile } from './actions';
import { emptyOutreachState } from './types';

/**
 * The buyer's public identity.
 *
 * Sellers see this when a buyer matches or asks for access, and it is the basis
 * on which they decide whether to release their financials. A buyer who fills
 * in nothing is a stranger asking for confidential numbers, and gets treated
 * accordingly — the form says so, because the incentive is real and not obvious.
 *
 * Capital is a band by the buyer's own choice: publishing an exact war chest
 * prices you before you have negotiated.
 */
export function BuyerProfileForm({
  profile,
  isDiscoverable,
}: {
  profile: Record<string, unknown> | null;
  isDiscoverable: boolean;
}) {
  const [state, action] = useActionState(saveBuyerProfile, emptyOutreachState);

  const text = (key: string): string => (profile?.[key] as string | null) ?? '';
  const dollars = (key: string): string => {
    const value = profile?.[key] as number | null | undefined;
    return value === null || value === undefined ? '' : String(value / 100);
  };
  const count = (key: string): string => {
    const value = profile?.[key] as number | null | undefined;
    return value === null || value === undefined ? '' : String(value);
  };

  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle>Your buyer profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="border-border-default bg-surface-sunken text-text-muted rounded border p-3 text-xs">
            Sellers see this when you match their listing or ask for access. It is what they use to
            decide whether to release their financials — a blank profile is a stranger asking for
            confidential numbers, and gets answered like one.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Acquiring entity"
              name="entityName"
              maxLength={300}
              defaultValue={text('entity_name')}
              placeholder="Okafor Capital LLC"
              hint="Leave blank if buying personally."
            />
            <Input
              label="Funding source"
              name="fundingSource"
              maxLength={200}
              defaultValue={text('funding_source')}
              placeholder="SBA 7(a) + personal equity"
              hint="Usually the first question a seller asks."
            />
          </div>

          <Input
            label="Headline"
            name="headline"
            maxLength={200}
            defaultValue={text('headline')}
            placeholder="Operator buying one home-services business in the Northeast"
          />

          <Textarea
            label="About you"
            name="bio"
            rows={4}
            maxLength={4000}
            defaultValue={text('bio')}
            hint="Background, what you plan to do with the business, why you."
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Capital from"
              name="capitalLow"
              numeric
              inputMode="decimal"
              defaultValue={dollars('capital_available_low_cents')}
              hint="Whole dollars"
            />
            <Input
              label="Capital to"
              name="capitalHigh"
              numeric
              inputMode="decimal"
              defaultValue={dollars('capital_available_high_cents')}
            />
            <Input
              label="Prior acquisitions"
              name="priorAcquisitions"
              type="number"
              min={0}
              numeric
              defaultValue={count('prior_acquisitions')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="LinkedIn"
              name="linkedinUrl"
              type="url"
              maxLength={500}
              defaultValue={text('linkedin_url')}
            />
            <Input
              label="Website"
              name="website"
              type="url"
              maxLength={500}
              defaultValue={text('website')}
            />
          </div>

          <div className="border-border-subtle space-y-2 border-t pt-4">
            <div className="flex items-start gap-2">
              <input
                id="isDiscoverable"
                type="checkbox"
                name="isDiscoverable"
                defaultChecked={isDiscoverable}
                className="border-border-default text-primary focus-visible:ring-ring mt-0.5 h-4 w-4 rounded focus-visible:ring-2"
              />
              <label htmlFor="isDiscoverable" className="text-sm">
                Let sellers find me
              </label>
            </div>
            <p className="text-text-muted text-xs">
              On, sellers whose listings you match can see this profile and contact you. Off, you
              still get your own match feed, but no seller can see you or reach you — you will have
              to make the first move on every deal.
            </p>
          </div>

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <Submit />
        </CardContent>
      </Card>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Save profile
    </Button>
  );
}
