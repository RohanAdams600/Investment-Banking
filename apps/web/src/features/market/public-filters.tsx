import Link from 'next/link';
import { INDUSTRY_PROFILES, INDUSTRY_KEYS, type IndustryKey } from '@ib/core';
import { Button } from '@ib/ui';

/**
 * The filter bar on the public market.
 *
 * ## A plain GET form, again
 *
 * Same reasoning as the hero's search and worth restating because it is what
 * makes this page work: every filtered view is a shareable URL, the back button
 * behaves, the page stays a server component and cacheable, and a crawler
 * following `?industry=manufacturing` indexes a real filtered market rather than
 * an empty shell. A client-side filter panel would look more responsive and lose
 * all four.
 *
 * ## Why these five and not more
 *
 * These are every axis the teaser publishes. There is nothing else to filter on
 * that would not require reaching into the confidential record, and a filter
 * over a hidden figure leaks it a bit at a time — set a floor, see whether the
 * listing disappears, repeat. The absence of a "revenue" filter here is not an
 * oversight.
 *
 * ## Money in dollars, stored in cents
 *
 * The fields say dollars because that is what somebody types. The page converts
 * once, at the boundary, and rounds — `19999.99 * 100` is 1999998.9999999998 in
 * IEEE754, and a database integer column refuses that in a way no buyer could
 * act on.
 */
export function PublicFilters({
  jurisdictions,
  current,
}: {
  jurisdictions: { code: string; name: string }[];
  current: {
    q?: string;
    industry?: string;
    jurisdiction?: string;
    minEarnings?: string;
    maxAsking?: string;
  };
}) {
  const hasFilter = Boolean(
    current.q ||
    current.industry ||
    current.jurisdiction ||
    current.minEarnings ||
    current.maxAsking,
  );

  return (
    <form
      method="get"
      className="border-border-subtle bg-surface grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-6"
      aria-label="Filter the market"
    >
      <div className="lg:col-span-2">
        <label htmlFor="q" className="text-text-secondary mb-1 block text-xs font-medium">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={current.q ?? ''}
          maxLength={100}
          placeholder="HVAC, machine shop…"
          className="border-border-default bg-canvas focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        />
      </div>

      <div>
        <label htmlFor="industry" className="text-text-secondary mb-1 block text-xs font-medium">
          Industry
        </label>
        <select
          id="industry"
          name="industry"
          defaultValue={current.industry ?? ''}
          className="border-border-default bg-canvas focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
        >
          <option value="">Any</option>
          {INDUSTRY_KEYS.map((key) => (
            <option key={key} value={key}>
              {INDUSTRY_PROFILES[key as IndustryKey].label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="jurisdiction"
          className="text-text-secondary mb-1 block text-xs font-medium"
        >
          State
        </label>
        <select
          id="jurisdiction"
          name="jurisdiction"
          defaultValue={current.jurisdiction ?? ''}
          className="border-border-default bg-canvas focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
        >
          <option value="">Anywhere</option>
          {jurisdictions.map((j) => (
            <option key={j.code} value={j.code}>
              {j.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="minEarnings" className="text-text-secondary mb-1 block text-xs font-medium">
          Earnings from
        </label>
        <input
          id="minEarnings"
          name="minEarnings"
          inputMode="decimal"
          defaultValue={current.minEarnings ?? ''}
          placeholder="$250,000"
          className="border-border-default bg-canvas focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        />
      </div>

      <div>
        <label htmlFor="maxAsking" className="text-text-secondary mb-1 block text-xs font-medium">
          Asking up to
        </label>
        <input
          id="maxAsking"
          name="maxAsking"
          inputMode="decimal"
          defaultValue={current.maxAsking ?? ''}
          placeholder="$3,000,000"
          className="border-border-default bg-canvas focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        />
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        {/*
          A link rather than a reset button. `type="reset"` restores the form's
          defaults, which are the filters currently applied — so it appears to
          do nothing, which is worse than not offering it.
        */}
        {hasFilter ? (
          <Link
            href="/businesses-for-sale"
            className="text-text-muted hover:text-text-primary text-sm underline-offset-4 hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
