'use client';

import Link from 'next/link';
import { INDUSTRY_PROFILES } from '@ib/core';
import { Button, Input, Select } from '@ib/ui';

import type { BrowseFilters, JurisdictionOption } from './types';

/**
 * Filters for the market.
 *
 * A plain GET form rather than client-side state: the result is a shareable,
 * bookmarkable URL, the back button works, and the filtering happens in
 * Postgres where the index is. Buyers compare listings across tabs, and state
 * held in a component makes that impossible.
 *
 * ## Keywords sit above the filters, and span the row
 *
 * The dropdowns answer "show me anything in this shape". The keyword box
 * answers "show me the thing I already have in mind", which is the more common
 * arrival — somebody who wants a route-density distribution business is not
 * going to find it by picking Distribution and reading forty teasers. Ranked in
 * Postgres over the teaser text only; the confidential half of a listing is not
 * in the index and cannot be found by guessing at it.
 */
export function BrowseFilters({
  jurisdictions,
  current,
}: {
  jurisdictions: JurisdictionOption[];
  current: BrowseFilters;
}) {
  const dollars = (cents: number | undefined): string =>
    cents === undefined ? '' : String(cents / 100);

  return (
    <form method="get" className="space-y-3">
      <div className="flex gap-2">
        <Input
          label="Search"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={current.q ?? ''}
          placeholder="recurring service contracts, absentee owner, route density…"
          className="flex-1"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <Select label="Industry" name="industry" defaultValue={current.industry ?? ''}>
          <option value="">Any industry</option>
          {Object.values(INDUSTRY_PROFILES).map((profile) => (
            <option key={profile.key} value={profile.key}>
              {profile.label}
            </option>
          ))}
        </Select>

        <Select label="State" name="jurisdiction" defaultValue={current.jurisdiction ?? ''}>
          <option value="">Any state</option>
          {jurisdictions.map((jurisdiction) => (
            <option key={jurisdiction.code} value={jurisdiction.code}>
              {jurisdiction.name}
            </option>
          ))}
        </Select>

        <Input
          label="Minimum earnings"
          name="minEarnings"
          numeric
          inputMode="decimal"
          defaultValue={dollars(current.minEarningsCents)}
          placeholder="500000"
        />

        <Input
          label="Maximum asking price"
          name="maxAsking"
          numeric
          inputMode="decimal"
          defaultValue={dollars(current.maxAskingCents)}
          placeholder="5000000"
        />

        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/listings">Clear</Link>
          </Button>
        </div>
      </div>
    </form>
  );
}
