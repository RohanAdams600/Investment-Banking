import type { Metadata } from 'next';
import Link from 'next/link';
import { INDUSTRY_PROFILES, brand, formatBand, pageTitle, type IndustryKey } from '@ib/core';

import { GUIDED_INDUSTRY_KEYS } from '@/features/market/industry-guides';
import { PublicFilters } from '@/features/market/public-filters';
import { publicListings } from '@/features/market/queries';
import { InterestForm } from '@/features/interest/interest-form';
import { listJurisdictions } from '@/features/listings/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { SiteHeader } from '@/features/marketing/site-header';

export const metadata: Metadata = {
  title: pageTitle('Businesses for sale'),
  description:
    'Privately held companies for sale, listed anonymously. Industry, state and size ranges are public; the company name and exact figures open only to a buyer the seller has issued a confidentiality agreement to.',
  alternates: { canonical: '/businesses-for-sale' },
};

/*
 * Revalidated rather than dynamic.
 *
 * A crawler hitting a dynamic page runs a database query per request, and the
 * content changes when a seller publishes — which is not often. An hour is long
 * enough to make crawling cheap and short enough that a new listing is indexed
 * the same day.
 */
export const revalidate = 3600;

/**
 * The market, for people who are not signed in.
 *
 * ## Why this exists separately from /listings
 *
 * `/listings` is the application: it needs a session, it knows what you saved,
 * and it is `noindex` because a page behind a login has nothing to offer a
 * crawler. This is the same inventory rendered for somebody who arrived from a
 * search result and has never heard of us.
 *
 * They are deliberately different files reading different sources — this one
 * reads `market_listings`, a view with no `id`, no `seller_id` and live rows
 * only. Sharing a query between the two would put one policy change between a
 * public page and something it should not serve.
 */
export default async function PublicMarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  /*
   * Dollars in the URL, cents in the query.
   *
   * `Math.round` rather than a bare `* 100`: 19999.99 * 100 is
   * 1999998.9999999998 in IEEE754, and a comparison against an integer column
   * then quietly excludes the listing the buyer was looking for. A value that
   * is not a number at all is dropped rather than treated as zero — `?maxAsking=abc`
   * meaning "asking under nothing" would return an empty market and look like a
   * platform with no listings.
   */
  const cents = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number.parseFloat(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
  };

  const raw = {
    q: single('q')?.slice(0, 100),
    industry: single('industry'),
    jurisdiction: single('jurisdiction'),
    minEarnings: single('minEarnings'),
    maxAsking: single('maxAsking'),
  };

  const configured = isSupabaseConfigured();

  const [listings, jurisdictions] = configured
    ? await Promise.all([
        publicListings({
          q: raw.q,
          industry: raw.industry,
          jurisdiction: raw.jurisdiction,
          minEarningsCents: cents(raw.minEarnings),
          maxAskingCents: cents(raw.maxAsking),
        }),
        listJurisdictions(),
      ])
    : [[], []];

  const isFiltered = Object.values(raw).some(Boolean);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <header className="space-y-4">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">The market</p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">Businesses for sale</h1>
          <p className="text-text-secondary max-w-2xl leading-relaxed">
            Every listing below is anonymous. Industry, state and size ranges are public; the
            company name, the address and the exact figures live in a separate record that opens
            only to a buyer the seller has issued a confidentiality agreement to.
          </p>
          <div className="bg-accent h-0.5 w-16" aria-hidden />
        </header>

        <div className="mt-8">
          <PublicFilters jurisdictions={jurisdictions} current={raw} />
        </div>

        {/*
        The sector index.

        Placed above the results rather than in a footer because it is the hub
        half of a hub-and-spoke: these ten links are how a crawler reaches the
        sector pages, and how a visitor who arrived on a general search narrows
        to the one thing they came for. Rendered before the listings so it is
        present and useful on a deploy that has none.
      */}
        <nav aria-label="Browse by sector" className="mt-10">
          <h2 className="text-text-muted mb-3 font-mono text-xs uppercase tracking-[0.16em]">
            Browse by sector
          </h2>
          <ul className="flex flex-wrap gap-2">
            {GUIDED_INDUSTRY_KEYS.map((industry) => (
              <li key={industry}>
                <Link
                  href={`/businesses-for-sale/industry/${industry}`}
                  className="border-border-default hover:border-accent hover:text-accent inline-block rounded-md border px-3 py-1.5 text-sm transition-colors"
                >
                  {INDUSTRY_PROFILES[industry].label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {listings.length === 0 ? (
          /*
            Two different empty states, because they are two different
            situations and one message for both is wrong in whichever case it
            was not written for.

            A filtered search returning nothing means the buyer narrowed too
            far — the fix is to widen, and telling them the market has not
            opened when they can see it has is confusing. An unfiltered page
            returning nothing means the market really is empty, and the only
            useful thing to offer is a way to be told when it is not.
          */
          /* No Card wrapper: `InterestForm` renders its own, and nesting them
             draws two borders around one thing. */
          <div className="mt-8 space-y-3">
            {/*
                The address capture, here rather than behind a sign-up.

                This is the difference that matters on this page: the
                competition requires an account before it will remember what
                somebody is looking for, and most people arriving from a search
                result will not make one on the first visit. An email and a
                sector is enough to be useful to both sides, and it costs the
                visitor a form rather than a relationship.

                The heading is passed in rather than written above the form,
                because the two cases are genuinely different and one message
                for both is wrong in whichever case it was not written for. A
                filtered search returning nothing means the buyer narrowed too
                far; an unfiltered page returning nothing means the market
                really is empty.
              */}
            <InterestForm
              side="buying"
              jurisdictions={jurisdictions}
              source={isFiltered ? 'public-market-no-matches' : 'public-market-empty'}
              heading={
                isFiltered ? 'Nothing matches those filters.' : 'The first listings are not up yet.'
              }
              blurb={
                isFiltered
                  ? 'Try widening them — or leave your details and you will hear the day something like this comes to market.'
                  : `${brand.name} is opening shortly. Leave your details and you will hear the day something fits — not before, and not otherwise.`
              }
            />

            <p className="text-text-muted text-xs">
              Already have an account?{' '}
              <Link
                href="/saved-searches"
                className="hover:text-text-secondary underline underline-offset-4"
              >
                Save this search
              </Link>{' '}
              and get alerted with filters instead.
            </p>
          </div>
        ) : (
          <ul className="divide-border-subtle mt-12 divide-y">
            {listings.map((listing) => {
              const industry = INDUSTRY_PROFILES[listing.industry as IndustryKey];
              return (
                <li key={listing.slug} className="py-6">
                  <Link href={`/businesses-for-sale/${listing.slug}`} className="group block">
                    <h2 className="font-display group-hover:text-accent text-xl font-semibold transition-colors">
                      {listing.headline}
                    </h2>
                    <p className="text-text-muted mt-1 font-mono text-xs uppercase tracking-[0.12em]">
                      {[industry?.label, listing.jurisdictionName].filter(Boolean).join(' · ')}
                    </p>
                    {listing.summary ? (
                      <p className="text-text-secondary mt-3 line-clamp-2 text-sm leading-relaxed">
                        {listing.summary}
                      </p>
                    ) : null}
                    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                      <Figure label="Revenue" value={formatBand(listing.revenueBand)} />
                      <Figure label="Earnings" value={formatBand(listing.earningsBand)} />
                      <Figure label="Asking" value={formatBand(listing.askingBand)} />
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted text-2xs font-mono uppercase tracking-[0.12em]">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
