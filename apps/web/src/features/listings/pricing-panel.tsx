import { describeAskingPrice, formatMoney, valueAllMethods, type IndustryKey } from '@ib/core';
import { AIDisclaimer, Badge, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import type { ListingFullProfile, ListingTeaser } from './types';

/**
 * How the asking price sits against what the business looks worth.
 *
 * Shown on the page where the seller sets their price, computed from the exact
 * figures they already entered on the confidential profile — so it costs them
 * nothing and appears at the moment it is useful.
 *
 * **It never blocks and never directs.** A seller may list at any price. They
 * know things the model does not: a strategic buyer already circling, a
 * contract about to be signed, land under the building. A platform that refused
 * a price above its own estimate would be substituting its judgement for the
 * owner's on the sale of their own business, which is not its place.
 *
 * What it does is make sure the choice is a choice rather than a guess, and warn
 * the seller that a buyer will run the same arithmetic.
 */
export function PricingPanel({
  teaser,
  profile,
}: {
  teaser: ListingTeaser;
  profile: ListingFullProfile | null;
}) {
  // Needs the confidential figures. Without them there is nothing to compare
  // against, and saying so is more useful than an empty card.
  if (!profile || profile.revenueCents === null || profile.earningsCents === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-muted text-sm">
            Fill in revenue and earnings on the confidential profile and this will show how your
            asking price compares with what the business looks worth across several methods.
          </p>
        </CardContent>
      </Card>
    );
  }

  const valuation = valueAllMethods({
    industry: teaser.industry as IndustryKey,
    revenue: profile.revenueCents,
    // The industry profile decides which basis applies; passing both lets it
    // choose rather than guessing here.
    sde: profile.earningsCents,
    ebitda: profile.earningsCents,
    customerConcentration: profile.customerConcentration ?? undefined,
    recurringRevenueShare: profile.recurringRevenueShare ?? undefined,
    employeeCount: teaser.employeeCount ?? undefined,
    yearsInBusiness: teaser.yearsInBusiness ?? undefined,
    ownerDependence: teaser.ownerDependence ?? undefined,
  });

  // The published band is what a buyer sees, so it is what gets compared. The
  // low end is used because that is the number a buyer anchors on.
  const asking = teaser.askingBand.lowCents ?? profile.askingPriceCents;
  const comparison = asking === null ? null : describeAskingPrice(asking, valuation.overall);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {valuation.overall ? (
          <div>
            <p className="text-text-muted text-xs">Estimated across every method that applies</p>
            <p className="font-mono text-xl tabular-nums">
              {formatMoney(valuation.overall.low)}
              <span className="text-text-muted mx-2">–</span>
              {formatMoney(valuation.overall.high)}
            </p>
          </div>
        ) : null}

        {comparison && asking !== null ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-text-muted text-xs">Your asking price</span>
              <span className="font-mono text-sm tabular-nums">{formatMoney(asking)}</span>
              <Badge variant={comparison.position === 'within' ? 'success' : 'neutral'}>
                {comparison.position === 'within'
                  ? 'Within the range'
                  : comparison.position === 'above'
                    ? 'Above the range'
                    : comparison.position === 'below'
                      ? 'Below the range'
                      : 'No comparison'}
              </Badge>
            </div>
            <p className="text-text-secondary text-sm">{comparison.message}</p>
          </div>
        ) : (
          <p className="text-text-muted text-sm">
            You have not published an asking price. That is a legitimate choice — plenty of sellers
            invite offers instead — and buyers can still find and enquire about the listing.
          </p>
        )}

        <ul className="space-y-1">
          {valuation.methods
            .filter((method) => method.range !== null)
            .map((method) => (
              <li key={method.key} className="flex justify-between gap-3 text-xs">
                <span className="text-text-muted">{method.label}</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(method.range!.low)} – {formatMoney(method.range!.high)}
                </span>
              </li>
            ))}
        </ul>

        <p className="text-text-muted text-xs">
          Set whatever price you think is right. This is here so you know what a buyer will
          calculate when they look at the same numbers, not to tell you what to charge.
        </p>

        <AIDisclaimer variant="valuation" />
      </CardContent>
    </Card>
  );
}
