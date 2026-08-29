import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DEAL_STRUCTURE_LABELS,
  GROWTH_TREND_LABELS,
  INDUSTRY_PROFILES,
  OWNER_DEPENDENCE_LABELS,
  brand,
  formatBand,
  pageTitle,
  type IndustryKey,
} from '@ib/core';
import { Button, Card, CardContent } from '@ib/ui';

import { publicListing, publicListingIndex, recordView } from '@/features/market/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const revalidate = 3600;

export async function generateStaticParams() {
  // Pre-rendered so a crawler is served a file rather than a query. Empty when
  // the database is unreachable at build time, which falls back to on-demand.
  if (!isSupabaseConfigured()) return [];
  const index = await publicListingIndex().catch(() => []);
  return index.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = isSupabaseConfigured() ? await publicListing(slug) : null;

  if (!listing) return { title: pageTitle('Business for sale'), robots: { index: false } };

  const industry = INDUSTRY_PROFILES[listing.industry as IndustryKey]?.label;
  const where = [industry, listing.jurisdictionName].filter(Boolean).join(' in ');

  return {
    title: pageTitle(listing.headline),
    description:
      listing.summary ??
      `${where} for sale. Anonymous listing — the company name and exact figures open only to a buyer holding a signed confidentiality agreement.`,
    alternates: { canonical: `/businesses-for-sale/${listing.slug}` },
  };
}

/**
 * One listing, for somebody who arrived from a search result.
 *
 * ## Everything here is already public
 *
 * The page renders a `PublicListing`, which comes from a view containing live
 * rows and teaser columns only. There is no code path from here to a company
 * name, an address or an exact figure — not because this file is careful, but
 * because the type it was handed does not have those fields on it.
 *
 * ## The only thing behind a login is asking for more
 *
 * A visitor can read everything the seller chose to publish. Requesting access
 * needs an account, and that is the right place for the wall: the seller is
 * entitled to know who is asking, and nobody has to prove who they are to read
 * an anonymised advert.
 */
export default async function PublicListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = isSupabaseConfigured() ? await publicListing(slug) : null;

  if (!listing) notFound();

  /*
   * Not awaited, and not allowed to fail the page.
   *
   * A tally is worth having and worth nothing compared to the page rendering.
   * `void` rather than `await` so a slow write does not sit between a visitor
   * and the listing they clicked on from a search result.
   */
  void recordView(listing.slug);

  const industry = INDUSTRY_PROFILES[listing.industry as IndustryKey];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <nav className="mb-8">
        <Link
          href="/businesses-for-sale"
          className="text-text-muted hover:text-text-primary font-mono text-xs uppercase tracking-[0.14em]"
        >
          ← All businesses for sale
        </Link>
      </nav>

      <header className="space-y-3">
        <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">
          {[industry?.label, listing.jurisdictionName].filter(Boolean).join(' · ')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{listing.headline}</h1>
        <div className="bg-accent h-0.5 w-16" aria-hidden />
      </header>

      {listing.summary ? (
        <p className="text-text-secondary mt-8 leading-relaxed">{listing.summary}</p>
      ) : null}

      {listing.background ? (
        <section className="border-border-subtle mt-8 border-l-2 pl-5">
          <h2 className="text-text-muted font-mono text-xs uppercase tracking-[0.14em]">
            How the business got here
          </h2>
          <p className="text-text-secondary mt-2 whitespace-pre-wrap leading-relaxed">
            {listing.background}
          </p>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">The numbers, as ranges</h2>
        <dl className="border-border-subtle mt-4 grid gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-3">
          <Row label="Revenue" value={formatBand(listing.revenueBand)} numeric />
          <Row label="Earnings" value={formatBand(listing.earningsBand)} numeric />
          <Row label="Asking price" value={formatBand(listing.askingBand)} numeric />
          <Row label="Structure" value={DEAL_STRUCTURE_LABELS[listing.dealStructure]} />
          <Row
            label="Employees"
            value={listing.employeeCount === null ? 'Not stated' : String(listing.employeeCount)}
            numeric
          />
          <Row
            label="Years trading"
            value={
              listing.yearsInBusiness === null ? 'Not stated' : String(listing.yearsInBusiness)
            }
            numeric
          />
          {listing.growthTrend ? (
            <Row label="Trend" value={GROWTH_TREND_LABELS[listing.growthTrend]} />
          ) : null}
          {listing.ownerDependence ? (
            <Row
              label="Owner involvement"
              value={OWNER_DEPENDENCE_LABELS[listing.ownerDependence]}
            />
          ) : null}
          <Row
            label="Real estate"
            value={listing.realEstateIncluded ? 'Included' : 'Not included'}
          />
        </dl>
        <p className="text-text-muted mt-4 text-sm leading-relaxed">
          Ranges as published by the seller, not exact amounts, and {brand.name} has not audited
          them.
        </p>
      </section>

      {listing.reasonForSale ? (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Why they are selling</h2>
          <p className="text-text-secondary mt-3 leading-relaxed">{listing.reasonForSale}</p>
        </section>
      ) : null}

      <Card className="mt-12">
        <CardContent className="space-y-3 py-8">
          <h2 className="font-display text-xl font-semibold">Want the rest?</h2>
          <p className="text-text-secondary max-w-xl text-sm leading-relaxed">
            The company name, the address, the exact financials and the customer detail are in a
            separate record. Create an account and request access — the seller decides who gets it,
            and issues a confidentiality agreement to the buyers they choose.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild>
              <Link href="/sign-up">Create an account</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/tools/valuation">What is my business worth?</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Row({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div>
      <dt className="text-text-muted text-2xs font-mono uppercase tracking-[0.12em]">{label}</dt>
      <dd className={numeric ? 'mt-1 tabular-nums' : 'mt-1'}>{value}</dd>
    </div>
  );
}
