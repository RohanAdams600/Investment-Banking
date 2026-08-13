'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { INDUSTRY_PROFILES, deriveBand } from '@ib/core';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, Textarea } from '@ib/ui';

import { createListing, updateListing } from './actions';
import { emptyListingState, type JurisdictionOption, type ListingTeaser } from './types';

/**
 * The teaser form.
 *
 * Everything on this form becomes readable by every signed-in user the moment
 * the listing goes live, and the form says so rather than assuming the seller
 * knows. The confidential fields — legal name, address, exact figures — are a
 * separate form on a separate card, because a seller filling in one long form
 * has no way to tell which half is public.
 */
export function ListingForm({
  listing,
  jurisdictions,
  firms,
  exactFigures,
}: {
  listing?: ListingTeaser;
  jurisdictions: JurisdictionOption[];
  firms?: { id: string; name: string }[];
  /**
   * The seller's real numbers, from the confidential profile.
   *
   * Present only so the bands can be derived from them. Never rendered — this
   * form is the public half, and a component that displays an exact figure here
   * would put it on the teaser.
   */
  exactFigures?: {
    revenueCents: number | null;
    earningsCents: number | null;
    askingPriceCents: number | null;
  };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(
    listing ? updateListing : createListing,
    emptyListingState,
  );

  const dollars = (cents: number | null): string => (cents === null ? '' : String(cents / 100));

  /**
   * Fills the public bands from the confidential figures.
   *
   * `deriveBand` rounds **outwards** onto fixed steps, so the published band is
   * deliberately wider than the true figure. A band that brackets the number
   * too tightly is itself a disclosure, which is the thing the teaser split
   * exists to prevent.
   *
   * Written into the fields rather than submitted directly, so the seller sees
   * what will be published and can widen it further before saving.
   */
  function suggestBands() {
    if (!exactFigures || !formRef.current) return;

    const set = (name: string, value: number | null) => {
      const field = formRef.current!.elements.namedItem(name);
      if (field instanceof HTMLInputElement) {
        field.value = value === null ? '' : String(Math.round(value / 100));
      }
    };

    const revenue = deriveBand(exactFigures.revenueCents);
    const earnings = deriveBand(exactFigures.earningsCents);
    const asking = deriveBand(exactFigures.askingPriceCents);

    set('revenueBandLow', revenue.lowCents);
    set('revenueBandHigh', revenue.highCents);
    set('earningsBandLow', earnings.lowCents);
    set('earningsBandHigh', earnings.highCents);
    set('askingBandLow', asking.lowCents);
    set('askingBandHigh', asking.highCents);
  }

  const canSuggest =
    exactFigures !== undefined &&
    (exactFigures.revenueCents !== null || exactFigures.earningsCents !== null);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {listing ? <input type="hidden" name="listingId" value={listing.id} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Public listing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="border-border-default bg-surface-sunken text-text-muted rounded border p-3 text-xs">
            Everything on this card is visible to any signed-in buyer once the listing goes live.
            Keep it anonymous — do not name the business, give a street address, or state an exact
            figure here. Those belong on the confidential profile, which only a buyer who has signed
            your NDA can open.
          </p>

          <Input
            label="Headline"
            name="headline"
            required
            minLength={10}
            maxLength={200}
            defaultValue={listing?.headline}
            placeholder="Established HVAC contractor in Upstate New York"
            hint="Describe the business without identifying it."
          />

          <Textarea
            label="Summary"
            name="summary"
            maxLength={4000}
            rows={5}
            defaultValue={listing?.summary ?? ''}
            hint="What a buyer needs to decide whether to ask for more. Still anonymous."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Industry"
              name="industry"
              required
              defaultValue={listing?.industry ?? ''}
            >
              <option value="" disabled>
                Choose an industry
              </option>
              {Object.values(INDUSTRY_PROFILES).map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.label}
                </option>
              ))}
            </Select>

            <Select
              label="State"
              name="jurisdictionCode"
              required
              defaultValue={listing?.jurisdictionCode ?? ''}
              hint="State only — a city plus an industry identifies most businesses."
            >
              <option value="" disabled>
                Choose a state
              </option>
              {jurisdictions.map((jurisdiction) => (
                <option key={jurisdiction.code} value={jurisdiction.code}>
                  {jurisdiction.name}
                </option>
              ))}
            </Select>
          </div>

          {canSuggest ? (
            <div className="border-border-subtle bg-surface-sunken/60 space-y-2 rounded border p-3">
              <p className="text-text-secondary text-xs">
                You have already entered exact figures on the confidential profile. These can be
                rounded outwards into public bands — wider than the real number, on purpose, because
                a band that brackets it too closely gives it away.
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={suggestBands}>
                Fill bands from my figures
              </Button>
            </div>
          ) : null}

          <BandRow
            legend="Revenue band"
            lowName="revenueBandLow"
            highName="revenueBandHigh"
            lowValue={dollars(listing?.revenueBand.lowCents ?? null)}
            highValue={dollars(listing?.revenueBand.highCents ?? null)}
          />
          <BandRow
            legend="Earnings band (SDE or EBITDA)"
            lowName="earningsBandLow"
            highName="earningsBandHigh"
            lowValue={dollars(listing?.earningsBand.lowCents ?? null)}
            highValue={dollars(listing?.earningsBand.highCents ?? null)}
          />
          <BandRow
            legend="Asking price band"
            lowName="askingBandLow"
            highName="askingBandHigh"
            lowValue={dollars(listing?.askingBand.lowCents ?? null)}
            highValue={dollars(listing?.askingBand.highCents ?? null)}
            hint="Leave both blank if you would rather not publish a price."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Deal structure"
              name="dealStructure"
              defaultValue={listing?.dealStructure ?? 'asset'}
            >
              <option value="asset">Asset sale</option>
              <option value="stock">Stock sale</option>
            </Select>

            <Select
              label="Growth trend"
              name="growthTrend"
              defaultValue={listing?.growthTrend ?? ''}
            >
              <option value="">Not stated</option>
              <option value="declining">Declining</option>
              <option value="flat">Flat</option>
              <option value="growing">Growing</option>
              <option value="rapid">Rapid growth</option>
            </Select>

            <Input
              label="Employees"
              name="employeeCount"
              type="number"
              min={0}
              numeric
              defaultValue={listing?.employeeCount ?? ''}
            />

            <Input
              label="Years in business"
              name="yearsInBusiness"
              type="number"
              min={0}
              numeric
              defaultValue={listing?.yearsInBusiness ?? ''}
            />

            <Select
              label="Owner involvement"
              name="ownerDependence"
              defaultValue={listing?.ownerDependence ?? ''}
              hint="Buyers price an owner-critical business differently."
            >
              <option value="">Not stated</option>
              <option value="absentee">Absentee owner</option>
              <option value="moderate">Moderately involved</option>
              <option value="critical">Owner-critical</option>
            </Select>

            <div className="flex items-center gap-2 pt-6">
              <input
                id="realEstateIncluded"
                type="checkbox"
                name="realEstateIncluded"
                defaultChecked={listing?.realEstateIncluded ?? false}
                className="border-border-default text-primary focus-visible:ring-ring h-4 w-4 rounded focus-visible:ring-2"
              />
              <label htmlFor="realEstateIncluded" className="text-sm">
                Real estate included
              </label>
            </div>
          </div>

          <Input
            label="Reason for sale"
            name="reasonForSale"
            maxLength={500}
            defaultValue={listing?.reasonForSale ?? ''}
            placeholder="Retirement"
            hint="Keep it broad. A specific reason can identify the owner."
          />

          {firms && firms.length > 0 && !listing ? (
            <Select
              label="Manage through a firm"
              name="firmId"
              defaultValue=""
              hint="Colleagues at that firm will be able to manage this listing. Only firms you belong to are listed, and the database checks it again."
            >
              <option value="">No firm</option>
              {firms.map((firm) => (
                <option key={firm.id} value={firm.id}>
                  {firm.name}
                </option>
              ))}
            </Select>
          ) : null}

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <SubmitButton label={listing ? 'Save listing' : 'Create draft'} />
        </CardContent>
      </Card>
    </form>
  );
}

function BandRow({
  legend,
  lowName,
  highName,
  lowValue,
  highValue,
  hint,
}: {
  legend: string;
  lowName: string;
  highName: string;
  lowValue: string;
  highValue: string;
  hint?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-text-primary text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Input
          aria-label={`${legend} — from`}
          name={lowName}
          numeric
          inputMode="decimal"
          defaultValue={lowValue}
          placeholder="From"
        />
        <Input
          aria-label={`${legend} — to`}
          name={highName}
          numeric
          inputMode="decimal"
          defaultValue={highValue}
          placeholder="To"
        />
      </div>
      <p className="text-text-muted text-xs">
        {hint ?? 'Whole dollars. Bands only — an exact figure identifies a business.'}
      </p>
    </fieldset>
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
