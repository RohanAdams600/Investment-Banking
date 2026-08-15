import { brand, formatMoney } from '@ib/core';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import type { ListingFullProfile } from './types';

/**
 * The confidential half, once the gate has opened.
 *
 * This component is only ever rendered with a profile the database returned. It
 * does no permission check of its own and should not gain one — a component
 * that decides whether to show data it has already been handed is a rendering
 * choice, not access control, and the data has already left Postgres by then.
 */
export function FullProfile({ profile }: { profile: ListingFullProfile }) {
  const percent = (fraction: number | null): string =>
    fraction === null ? '—' : `${Math.round(fraction * 100)}%`;

  const address = [
    profile.addressLine1,
    profile.addressLine2,
    profile.city,
    profile.postalCode,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{profile.legalName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {profile.tradingName ? <Row label="Trading as" value={profile.tradingName} /> : null}
            {address.length > 0 ? <Row label="Address" value={address.join(', ')} /> : null}
            {profile.website ? <Row label="Website" value={profile.website} /> : null}
            <Row
              label="Revenue"
              value={profile.revenueCents === null ? '—' : formatMoney(profile.revenueCents)}
              numeric
            />
            <Row
              label="Earnings"
              value={profile.earningsCents === null ? '—' : formatMoney(profile.earningsCents)}
              numeric
            />
            <Row
              label="Asking price"
              value={
                profile.askingPriceCents === null ? '—' : formatMoney(profile.askingPriceCents)
              }
              numeric
            />
            <Row label="Largest customer" value={percent(profile.customerConcentration)} numeric />
            <Row label="Recurring revenue" value={percent(profile.recurringRevenueShare)} numeric />
          </dl>
        </CardContent>
      </Card>

      {profile.financials.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Financial history</CardTitle>
          </CardHeader>
          <CardContent>
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
                      Add-backs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profile.financials.map((year) => (
                    <tr key={year.id} className="border-border-subtle border-b last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {year.fiscalYear}
                      </th>
                      <Cell cents={year.revenueCents} />
                      <Cell cents={year.ebitdaCents} />
                      <Cell cents={year.sdeCents} />
                      <Cell cents={year.addbacksCents} last />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-text-muted mt-3 text-xs">
              Figures as reported by the seller. They have not been audited or verified by{' '}
              {brand.name}, and confirming them is part of your own diligence.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Narrative title="Key customers" body={profile.keyCustomers} />
      <Narrative title="Competitive position" body={profile.competitivePosition} />
      <Narrative title="Growth opportunities" body={profile.growthOpportunities} />
      <Narrative title="Known risks" body={profile.knownRisks} />
    </div>
  );
}

function Row({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd className={numeric ? 'font-mono tabular-nums' : undefined}>{value}</dd>
    </div>
  );
}

function Cell({ cents, last = false }: { cents: number | null; last?: boolean }) {
  return (
    <td className={`py-2 text-right font-mono tabular-nums ${last ? '' : 'pr-3'}`}>
      {cents === null ? '—' : formatMoney(cents)}
    </td>
  );
}

function Narrative({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Rendered as text, never as markup. Same rule as message bodies. */}
        <p className="text-text-secondary whitespace-pre-wrap text-sm">{body}</p>
      </CardContent>
    </Card>
  );
}
