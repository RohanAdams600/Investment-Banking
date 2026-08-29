import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import {
  INDUSTRY_PROFILES,
  brand,
  formatBand,
  pageTitle,
  type IndustryKey,
} from '@ib/core';
import { Button, Card, CardContent } from '@ib/ui';

import {
  GUIDED_INDUSTRY_KEYS,
  industryGuide,
  sentenceCase,
} from '@/features/market/industry-guides';
import { publicListings } from '@/features/market/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const revalidate = 3600;

/**
 * One page per sector, and the reason they exist is search.
 *
 * "Sell my HVAC business" and "HVAC business for sale" are searches people
 * already make, every day, with clear intent and no ambiguity about what they
 * want. A single `/businesses-for-sale` page cannot rank for ten of those at
 * once — one page, one intent — so the sector pages are the organic strategy
 * rather than a navigation convenience.
 *
 * ## Why they are not thin
 *
 * A set of pages that differ only by a filter is a doorway set and gets demoted.
 * The listings are the smaller half of each page; the larger half is
 * `industry-guides.ts`, written per sector. That is also what makes the page
 * useful on the day it has no listings on it, which at launch is every day.
 *
 * Statically generated, revalidated hourly. Ten pages is nothing to build and a
 * crawler should never wait on a database.
 */
export function generateStaticParams() {
  return GUIDED_INDUSTRY_KEYS.map((industry) => ({ industry }));
}

function resolve(param: string): IndustryKey | null {
  return (GUIDED_INDUSTRY_KEYS as string[]).includes(param) ? (param as IndustryKey) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ industry: string }>;
}): Promise<Metadata> {
  const key = resolve((await params).industry);
  if (!key) return { title: pageTitle('Not found') };

  const profile = INDUSTRY_PROFILES[key];
  const guide = industryGuide(key);

  return {
    title: pageTitle(profile.label),
    description:
      `${sentenceCase(guide.searchPhrase)}, listed anonymously. ` +
      'What buyers examine, what moves the price, and the businesses currently on the market.',
    alternates: { canonical: `/businesses-for-sale/industry/${key}` },
  };
}

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const key = resolve((await params).industry);
  if (!key) notFound();

  const profile = INDUSTRY_PROFILES[key];
  const guide = industryGuide(key);
  const listings = isSupabaseConfigured() ? await publicListings({ industry: key }) : [];

  const basis = profile.basis === 'sde' ? 'seller’s discretionary earnings' : 'EBITDA';

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <nav aria-label="Breadcrumb" className="text-text-muted mb-8 font-mono text-xs">
        <Link href="/businesses-for-sale" className="hover:text-text-primary">
          Businesses for sale
        </Link>
        <span aria-hidden className="px-2">
          /
        </span>
        <span className="text-text-secondary">{profile.label}</span>
      </nav>

      <header className="space-y-4">
        <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">The market</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">{profile.label}</h1>
        <div className="bg-accent h-0.5 w-16" aria-hidden />
        <p className="text-text-secondary max-w-2xl leading-relaxed">{guide.intro}</p>
      </header>

      {/* The listings, first, because that is what the visitor came for. */}
      <section className="mt-12" aria-labelledby="on-the-market">
        <h2 id="on-the-market" className="font-display text-2xl font-semibold tracking-tight">
          On the market now
        </h2>

        {listings.length === 0 ? (
          <Card className="mt-5">
            <CardContent className="space-y-3 py-8">
              <p className="text-text-secondary max-w-xl text-sm leading-relaxed">
                No {profile.label.toLowerCase()} businesses are listed at the moment. {brand.name}{' '}
                is opening shortly — tell us what you are looking for and you will hear the day
                something in this sector is published.
              </p>
              <Button asChild variant="secondary">
                <Link href="/listings">
                  Register your interest
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-border-subtle mt-5 divide-y">
            {listings.map((listing) => (
              <li key={listing.slug} className="py-6">
                <Link href={`/businesses-for-sale/${listing.slug}`} className="group block">
                  <h3 className="font-display group-hover:text-accent text-xl font-semibold transition-colors">
                    {listing.headline}
                  </h3>
                  <p className="text-text-muted mt-1 font-mono text-xs uppercase tracking-[0.12em]">
                    {listing.jurisdictionName ?? listing.jurisdictionCode}
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
            ))}
          </ul>
        )}
      </section>

      {/* What a buyer of this kind of business examines. */}
      <section className="mt-16" aria-labelledby="what-buyers-examine">
        <h2
          id="what-buyers-examine"
          className="font-display text-2xl font-semibold tracking-tight"
        >
          What buyers examine
        </h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2">
          {guide.buyersLookAt.map((item) => (
            <div key={item.title} className="space-y-1.5">
              <dt className="font-display text-base font-semibold">{item.title}</dt>
              <dd className="text-text-secondary text-sm leading-relaxed">{item.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* What moves the price, in both directions. */}
      <section className="mt-16" aria-labelledby="what-moves-the-price">
        <h2
          id="what-moves-the-price"
          className="font-display text-2xl font-semibold tracking-tight"
        >
          What moves the price
        </h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="text-text-muted mb-3 font-mono text-xs uppercase tracking-[0.16em]">
              Lifts it
            </h3>
            <ul className="space-y-2">
              {guide.liftsValue.map((point) => (
                <li
                  key={point}
                  className="border-accent text-text-secondary border-l-2 pl-3 text-sm leading-relaxed"
                >
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-text-muted mb-3 font-mono text-xs uppercase tracking-[0.16em]">
              Limits it
            </h3>
            <ul className="space-y-2">
              {guide.limitsValue.map((point) => (
                <li
                  key={point}
                  className="border-border-default text-text-secondary border-l-2 pl-3 text-sm leading-relaxed"
                >
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/*
        The multiple range.

        Stated because an owner searching this phrase wants a number, and
        withholding it sends them to a worse source. The qualification carries
        the same visual weight as the figure on purpose — this is an
        illustrative range for a sector, not an estimate of any business, and it
        is not a recommendation to price anything at anything.
      */}
      <section className="mt-16" aria-labelledby="typical-range">
        <Card>
          <CardContent className="space-y-3 py-8">
            <h2 id="typical-range" className="font-display text-xl font-semibold">
              What businesses in this sector tend to trade at
            </h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              Businesses in this category are usually discussed at{' '}
              <strong className="text-text-primary tabular-nums">
                {profile.multipleLow}× to {profile.multipleHigh}×
              </strong>{' '}
              {basis}. {profile.rationale}
            </p>
            <p className="text-text-muted text-sm leading-relaxed">
              This is an illustrative range for a whole sector, provided for information only. It
              is not a valuation, not advice, and not a recommendation to buy, sell or price any
              business at any figure. Any individual company can fall well outside it for reasons
              no general model can see. Use it to frame a conversation with an advisor, not to
              replace one.
            </p>
            <Button asChild variant="secondary">
              <Link href="/tools/valuation">
                Work through a range for your own business
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Addressed to the owner. The reason a seller clicked this result. */}
      <section className="mt-16" aria-labelledby="if-you-are-selling">
        <h2 id="if-you-are-selling" className="font-display text-2xl font-semibold tracking-tight">
          If you are selling
        </h2>
        <p className="text-text-secondary mt-4 max-w-2xl leading-relaxed">{guide.sellerNote}</p>
        <p className="text-text-secondary mt-4 max-w-2xl text-sm leading-relaxed">
          Listing on {brand.name} is anonymous. Your industry, state and size ranges are public;
          the company name, the address and the exact figures sit in a separate record that opens
          only to a buyer you have personally issued a confidentiality agreement to.
        </p>
        <Button asChild className="mt-6">
          <Link href="/sign-up">
            List your business
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </section>

      {/* Internal links, which is how the other nine pages get crawled at all. */}
      <section className="border-border-subtle mt-16 border-t pt-8" aria-labelledby="other-sectors">
        <h2
          id="other-sectors"
          className="text-text-muted mb-4 font-mono text-xs uppercase tracking-[0.16em]"
        >
          Other sectors
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {GUIDED_INDUSTRY_KEYS.filter((other) => other !== key).map((other) => (
            <li key={other}>
              <Link
                href={`/businesses-for-sale/industry/${other}`}
                className="text-text-secondary hover:text-accent underline-offset-4 hover:underline"
              >
                {INDUSTRY_PROFILES[other].label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
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
