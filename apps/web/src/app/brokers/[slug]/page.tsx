import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight, BadgeCheck } from 'lucide-react';
import { INDUSTRY_PROFILES, brand, pageTitle, type IndustryKey } from '@ib/core';

import { SiteHeader } from '@/features/marketing/site-header';
import { brokerProfile } from '@/features/brokers/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const broker = isSupabaseConfigured() ? await brokerProfile(slug) : null;
  if (!broker) return { title: pageTitle('Firm not found') };

  return {
    title: pageTitle(broker.name),
    description:
      broker.headline ??
      `${broker.name} runs lower-middle-market deals. Profile published by the firm on ${brand.name}.`,
    alternates: { canonical: `/brokers/${broker.slug}` },
  };
}

/**
 * One firm's page.
 *
 * ## Everything on it is theirs
 *
 * The copy, the sectors, the states and the link are all self-reported, and the
 * page says so rather than presenting them as findings. The only thing the
 * platform asserts is the verified mark, and that asserts exactly one narrow
 * fact: an operator checked who they say they are. It is not a rating, not an
 * endorsement, and not a statement about anybody's competence.
 *
 * ## Why there is no contact form here
 *
 * The directory view does not carry `contact_email` at all, so a scraper
 * reading this page finds no address to harvest. Reaching a firm goes through
 * an account, which means the firm knows who is asking — the same asymmetry the
 * rest of the product is built on, applied to the people who work here rather
 * than only to the businesses.
 */
export default async function BrokerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const broker = isSupabaseConfigured() ? await brokerProfile(slug) : null;
  if (!broker) notFound();

  const sectors = broker.industries.map(
    (key) => INDUSTRY_PROFILES[key as IndustryKey]?.label ?? key,
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <nav aria-label="Breadcrumb" className="text-text-muted mb-8 font-mono text-xs">
          <Link
            href="/brokers"
            className="hover:text-text-secondary underline-offset-4 hover:underline"
          >
            Brokers and advisors
          </Link>
          <span className="mx-2" aria-hidden>
            /
          </span>
          <span className="text-text-secondary">{broker.name}</span>
        </nav>

        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{broker.name}</h1>
            {broker.isVerified ? (
              <span className="text-accent flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]">
                <BadgeCheck className="h-4 w-4" aria-hidden />
                Identity verified
              </span>
            ) : null}
          </div>

          {broker.headline ? (
            <p className="text-text-secondary max-w-2xl text-lg leading-relaxed">
              {broker.headline}
            </p>
          ) : null}
          <div className="bg-accent h-0.5 w-16" aria-hidden />
        </header>

        {broker.about ? (
          <section className="mt-10 max-w-2xl">
            {/*
              Rendered as plain text with preserved line breaks, never as
              markup. This is a third party's copy on a page we serve, and the
              only safe assumption about somebody else's text is that it is
              text.
            */}
            <p className="text-text-secondary whitespace-pre-line text-sm leading-relaxed">
              {broker.about}
            </p>
          </section>
        ) : null}

        <dl className="border-border-subtle mt-10 grid gap-6 border-t pt-8 sm:grid-cols-2">
          {sectors.length > 0 ? (
            <div className="space-y-1.5">
              <dt className="text-text-muted font-mono text-[11px] uppercase tracking-[0.16em]">
                Sectors they work in
              </dt>
              <dd className="text-sm leading-relaxed">{sectors.join(', ')}</dd>
            </div>
          ) : null}

          {broker.jurisdictions.length > 0 ? (
            <div className="space-y-1.5">
              <dt className="text-text-muted font-mono text-[11px] uppercase tracking-[0.16em]">
                Where they work
              </dt>
              <dd className="text-sm leading-relaxed">{broker.jurisdictions.join(', ')}</dd>
            </div>
          ) : null}

          {broker.establishedYear ? (
            <div className="space-y-1.5">
              <dt className="text-text-muted font-mono text-[11px] uppercase tracking-[0.16em]">
                In business since
              </dt>
              <dd className="text-sm tabular-nums">{broker.establishedYear}</dd>
            </div>
          ) : null}

          {broker.website ? (
            <div className="space-y-1.5">
              <dt className="text-text-muted font-mono text-[11px] uppercase tracking-[0.16em]">
                Their website
              </dt>
              <dd className="text-sm">
                {/*
                  `noopener noreferrer` and `nofollow` on an outbound link a
                  third party supplied. `noopener` stops the target holding a
                  handle to this tab; `nofollow` stops a directory profile being
                  a way to buy PageRank, which is what makes free directories
                  fill up with spam.
                */}
                <a
                  href={broker.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent inline-flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  {broker.website.replace(/^https:\/\//, '')}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="text-text-muted border-border-subtle mt-10 border-t pt-6 text-xs leading-relaxed">
          This profile was written and published by {broker.name}. {brand.name} does not rank, rate
          or endorse firms, and does not receive a fee for anything a firm earns here. The verified
          mark means an operator checked the firm&rsquo;s identity — nothing more.
        </p>
      </main>
    </>
  );
}
