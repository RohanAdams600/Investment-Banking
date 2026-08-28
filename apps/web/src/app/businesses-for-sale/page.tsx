import type { Metadata } from 'next';
import Link from 'next/link';
import { INDUSTRY_PROFILES, brand, formatBand, pageTitle, type IndustryKey } from '@ib/core';
import { Card, CardContent } from '@ib/ui';

import { publicListings } from '@/features/market/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

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
export default async function PublicMarketPage() {
  const listings = isSupabaseConfigured() ? await publicListings() : [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="space-y-4">
        <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">The market</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">Businesses for sale</h1>
        <p className="text-text-secondary max-w-2xl leading-relaxed">
          Every listing below is anonymous. Industry, state and size ranges are public; the company
          name, the address and the exact figures live in a separate record that opens only to a
          buyer the seller has issued a confidentiality agreement to.
        </p>
        <div className="bg-accent h-0.5 w-16" aria-hidden />
      </header>

      {listings.length === 0 ? (
        <Card className="mt-10">
          <CardContent className="space-y-3 py-10">
            <h2 className="font-display text-xl font-semibold">
              The first listings are not up yet.
            </h2>
            <p className="text-text-secondary max-w-xl text-sm leading-relaxed">
              {brand.name} is opening shortly.{' '}
              <Link href="/listings" className="underline">
                Tell us what you are looking for
              </Link>{' '}
              and you will hear the day something fits.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-border-subtle mt-10 divide-y">
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
