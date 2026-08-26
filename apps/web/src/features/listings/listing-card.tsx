import Link from 'next/link';
import { INDUSTRY_PROFILES, LISTING_STATUS_LABELS, formatBand, type IndustryKey } from '@ib/core';
import { Badge, Card, CardContent } from '@ib/ui';

import { SaveButton } from './save-button';
import type { ListingTeaser } from './types';

/**
 * One anonymised listing in a list.
 *
 * Takes a `ListingTeaser` and nothing else. That is a type-level guarantee as
 * much as a convention: the confidential half is a different type, so no future
 * edit can pass a full profile in here and print the company name into a public
 * list without the compiler objecting.
 */
export function ListingCard({
  listing,
  showStatus = false,
}: {
  listing: ListingTeaser;
  showStatus?: boolean;
}) {
  const industry = INDUSTRY_PROFILES[listing.industry as IndustryKey];

  return (
    <Card className="hover:border-border-default transition-colors">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/listings/${listing.id}`} className="min-w-0 flex-1">
            {/*
              The paid-placement disclosure.

              Above the headline rather than tucked beside a badge on the right,
              because it has to be read before the listing is, and rendered from
              the teaser itself so it cannot be lost by a caller forgetting to
              pass it. A test asserts a promoted listing cannot render without
              it — removing the label means deleting a test that says why.
            */}
            {listing.promoted ? (
              <p className="text-accent text-2xs mb-1 font-mono uppercase tracking-[0.14em]">
                Promoted · paid placement
              </p>
            ) : null}
            <h2 className="truncate text-sm font-medium">{listing.headline}</h2>
            <p className="text-text-muted mt-0.5 text-xs">
              {industry?.label ?? listing.industry}
              {listing.jurisdictionName ? ` · ${listing.jurisdictionName}` : ''}
            </p>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            {showStatus ? (
              <Badge variant={listing.status === 'live' ? 'success' : 'neutral'}>
                {LISTING_STATUS_LABELS[listing.status]}
              </Badge>
            ) : null}
            <SaveButton listingId={listing.id} saved={listing.saved} />
          </div>
        </div>

        {listing.summary ? (
          <p className="text-text-secondary line-clamp-2 text-sm">{listing.summary}</p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <Figure label="Revenue" value={formatBand(listing.revenueBand)} />
          <Figure label="Earnings" value={formatBand(listing.earningsBand)} />
          <Figure label="Asking" value={formatBand(listing.askingBand)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
