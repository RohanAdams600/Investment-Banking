import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Building2 } from 'lucide-react';
import { INDUSTRY_PROFILES, brand, pageTitle, type IndustryKey } from '@ib/core';
import { Card, CardContent } from '@ib/ui';

import { SiteHeader } from '@/features/marketing/site-header';
import { listBrokers } from '@/features/brokers/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: pageTitle('Business brokers and M&A advisors'),
  description:
    'Business brokers, M&A advisors and investment bankers who run lower-middle-market deals. Every profile is written by the firm itself and published only with their consent.',
  alternates: { canonical: '/brokers' },
};

/*
 * Revalidated rather than dynamic: profiles change rarely, and a crawler
 * following the directory should not cost a query per request.
 */
export const revalidate = 3600;

/**
 * The directory, and why it exists before there is a market.
 *
 * A marketplace with no listings cannot attract buyers, and with no buyers
 * cannot attract sellers. The way out of that loop is never to court sellers
 * one at a time — it is to court the people who already represent twenty of
 * them. A broker arrives with a book.
 *
 * So this page is aimed at two readers at once. An owner or buyer looking for
 * representation finds one here. A broker finds a page that ranks for their
 * name and their county, which is worth something to them on the day they sign
 * up rather than on the day the market is liquid — and that is the reason they
 * create an account before they have a listing to post.
 *
 * ## Every profile is theirs, not ours
 *
 * Nothing on a card is a claim the platform makes. No deal counts, no success
 * rates, no rankings — we cannot verify any of it, and an unverifiable number
 * on a page we publish is our claim rather than theirs. The verified mark says
 * only that an operator checked who they say they are.
 */
export default async function BrokersPage() {
  const brokers = isSupabaseConfigured() ? await listBrokers() : [];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-16">
        <header className="max-w-2xl space-y-4">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">The directory</p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Business brokers and M&amp;A advisors
          </h1>
          <div className="bg-accent h-0.5 w-16" aria-hidden />
          <p className="text-text-secondary leading-relaxed">
            Firms that run lower-middle-market deals, listed with their consent. Every profile is
            written by the firm itself — {brand.name} does not rank them, rate them, or take a
            percentage of what they earn.
          </p>
        </header>

        {brokers.length === 0 ? (
          <Card className="mt-10">
            <CardContent className="max-w-2xl space-y-4 py-10">
              <h2 className="font-display text-xl font-semibold">
                No firms have published a profile yet.
              </h2>
              <p className="text-text-secondary text-sm leading-relaxed">
                A directory populated with people who did not ask to be in it is worse than an empty
                one, so this fills up only as firms choose to appear. If you run deals for clients,
                a profile is free and takes a few minutes.
              </p>
              <Link
                href="/for-advisors"
                className="text-accent inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
              >
                What a profile gets you
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-10 grid gap-px overflow-hidden border sm:grid-cols-2 lg:grid-cols-3">
            {brokers.map((broker) => (
              <li key={broker.slug} className="bg-surface -m-px border p-6">
                <Link href={`/brokers/${broker.slug}`} className="group block space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display group-hover:text-accent text-lg font-semibold leading-tight transition-colors">
                      {broker.name}
                    </h2>
                    {broker.isVerified ? (
                      <span
                        className="text-accent flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em]"
                        title="An operator has checked this firm's identity."
                      >
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                        Verified
                      </span>
                    ) : null}
                  </div>

                  {broker.headline ? (
                    <p className="text-text-secondary text-sm leading-relaxed">{broker.headline}</p>
                  ) : null}

                  {broker.industries.length > 0 ? (
                    <p className="text-text-muted font-mono text-[11px] uppercase tracking-[0.12em]">
                      {broker.industries
                        .slice(0, 3)
                        .map((key) => INDUSTRY_PROFILES[key as IndustryKey]?.label ?? key)
                        .map((label) => label.split(' (')[0])
                        .join(' · ')}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="border-border-subtle mt-16 border-t pt-10">
          <div className="flex max-w-3xl gap-4">
            <Building2 className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-2">
              <h2 className="font-display text-lg font-semibold">Run deals for clients?</h2>
              <p className="text-text-secondary text-sm leading-relaxed">
                A directory profile is free and does not require a listing. It is a page that ranks
                for your firm&rsquo;s name, and it stays unpublished until you say otherwise.{' '}
                <Link
                  href="/for-advisors"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  See what else comes with an account
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
