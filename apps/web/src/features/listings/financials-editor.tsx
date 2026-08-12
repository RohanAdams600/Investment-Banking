'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatMoney } from '@ib/core';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@ib/ui';

import { addFinancialYear, removeFinancialYear } from './actions';
import { emptyListingState, type ListingFinancialYear } from './types';

/**
 * Year-by-year financials.
 *
 * Behind the same NDA gate as the rest of the confidential profile: a
 * three-year revenue series identifies a business as readily as its name in a
 * small sector. Earnings may be negative here — a loss-making year is a fact,
 * not an input error, and a form that refuses to record one pushes sellers into
 * leaving the year out entirely.
 */
export function FinancialsEditor({
  listingId,
  years,
}: {
  listingId: string;
  years: ListingFinancialYear[];
}) {
  const [state, action] = useActionState(addFinancialYear, emptyListingState);
  const [removeState, removeAction] = useActionState(removeFinancialYear, emptyListingState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {years.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Reported financials by fiscal year</caption>
              <thead>
                <tr className="border-border-default text-text-muted border-b text-left text-xs">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Year
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Revenue
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    EBITDA
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    SDE
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {years.map((year) => (
                  <tr key={year.id} className="border-border-subtle border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {year.fiscalYear}
                    </th>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {formatMoney(year.revenueCents)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {year.ebitdaCents === null ? '—' : formatMoney(year.ebitdaCents)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {year.sdeCents === null ? '—' : formatMoney(year.sdeCents)}
                    </td>
                    <td className="py-2 text-right">
                      <form action={removeAction}>
                        <input type="hidden" name="rowId" value={year.id} />
                        <input type="hidden" name="listingId" value={listingId} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                          <span className="sr-only"> {year.fiscalYear}</span>
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-text-muted text-sm">
            No years recorded yet. Three years is what most buyers expect before they will make an
            offer.
          </p>
        )}

        {removeState.error ? (
          <p role="alert" className="text-danger text-sm">
            {removeState.error}
          </p>
        ) : null}

        <form action={action} className="space-y-3">
          <input type="hidden" name="listingId" value={listingId} />

          <div className="grid gap-3 sm:grid-cols-5">
            <Input
              label="Year"
              name="fiscalYear"
              type="number"
              min={1900}
              max={2200}
              required
              numeric
            />
            <Input label="Revenue" name="revenueCents" numeric inputMode="decimal" required />
            <Input label="EBITDA" name="ebitdaCents" numeric inputMode="decimal" />
            <Input label="SDE" name="sdeCents" numeric inputMode="decimal" />
            <Input label="Add-backs" name="addbacksCents" numeric inputMode="decimal" />
          </div>

          <p className="text-text-muted text-xs">
            Whole dollars. Adding a year that already exists replaces it.
          </p>

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <AddButton />
        </form>
      </CardContent>
    </Card>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending}>
      Add year
    </Button>
  );
}
