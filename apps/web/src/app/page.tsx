import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { brand, isBrandFullyConfigured, pageTitle, unconfiguredBrandFields } from '@ib/core';
import { Badge, Button, Card, CardContent } from '@ib/ui';

import { TwoRecords } from '@/features/marketing/two-records';
import {
  ADVISOR_FEATURES,
  ADVISOR_STEPS,
  BUYER_FEATURES,
  BUYER_STEPS,
  HERO,
  LIMITS,
  SELLER_FEATURES,
  SELLER_STEPS,
  SITE_DESCRIPTION,
} from '@/features/marketing/content';

export const metadata: Metadata = {
  title: pageTitle(),
  description: SITE_DESCRIPTION,
};

/**
 * The landing page.
 *
 * It sells the mechanism rather than results, because the mechanism is real and
 * the results do not exist yet. "Your business stays anonymous until you issue
 * an NDA" is a stronger claim than "trusted by thousands", and it has the
 * advantage of being true — a test on the copy makes sure it stays that way.
 *
 * Three sides, and the order is deliberate. Sellers and buyers get equal weight
 * because a marketplace that reads as built for one does not get the other.
 * Advisors come third but they are not an afterthought: bankers and brokers
 * arrive with several listings rather than one, and a marketplace with no place
 * for them is one they will not send a client to.
 */
export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pt-28">
        {isBrandFullyConfigured ? null : (
          <Badge variant="warning" className="mb-6">
            Placeholder brand config: {unconfiguredBrandFields.join(', ')}
          </Badge>
        )}

        {/* The mark, at the size it was drawn to work at. */}
        <div className="mb-8 flex items-center gap-3">
          <Mark />
          <span className="text-text-muted font-mono text-xs uppercase tracking-[0.2em]">
            {brand.name}
          </span>
        </div>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          {HERO.headline}
        </h1>

        <div className="bg-accent mt-6 h-0.5 w-16" aria-hidden />

        <p className="text-text-secondary mt-6 max-w-2xl text-lg leading-relaxed">{HERO.subhead}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={HERO.primaryHref}>
              {HERO.primaryCta}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href={HERO.secondaryHref}>{HERO.secondaryCta}</Link>
          </Button>
        </div>

        <p className="text-text-muted mt-4 max-w-2xl text-sm">
          Browsing the market takes a free account — sellers are entitled to know who is looking.
          The valuation takes about five minutes, needs no account, and does not require you to list
          anything.
        </p>
      </section>

      {/*
        The confidentiality claim, on the only dark ground in the product.

        It is the strongest true thing this platform can say and the one a seller
        weighs before anything else, so it gets the full-bleed treatment and the
        diagram rather than a bordered box among other bordered boxes. The band
        is deliberately the single inversion on the page — used twice it would
        stop meaning anything.
      */}
      <section className="bg-slate-900 text-stone-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1fr_minmax(0,560px)] lg:items-center lg:gap-16 lg:py-20">
          <div className="space-y-4">
            <p className="text-copper-400 font-mono text-xs uppercase tracking-[0.2em]">
              How confidentiality works
            </p>
            <h2 className="max-w-lg text-2xl font-semibold text-stone-50 sm:text-3xl">
              Two records, and buyers only ever reach one.
            </h2>
            <p className="max-w-lg text-sm leading-relaxed text-stone-300">
              Everything that identifies your business — the name, the address, the exact figures,
              who your customers are — lives in a separate record from the listing. Reaching it
              requires a confidentiality agreement you issued, that has not expired and you have not
              revoked.
            </p>
            <p className="max-w-lg text-sm leading-relaxed text-stone-300">
              That is a rule the database enforces on every read, not a permission flag in an
              interface, and it is tested on every build.
            </p>
            <p className="flex items-center gap-2 pt-2 text-xs text-stone-400">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Illustrative figures.
            </p>
          </div>

          <TwoRecords />
        </div>
      </section>

      {/* Sellers */}
      <Side
        eyebrow="If you are selling"
        heading="Find out what it is worth before anyone knows it is for sale."
        features={SELLER_FEATURES}
        steps={SELLER_STEPS}
        cta={{ href: '/sign-up', label: 'Start with a valuation' }}
      />

      {/* Buyers */}
      <Side
        eyebrow="If you are buying"
        heading="Stop reading listings that were never going to fit."
        features={BUYER_FEATURES}
        steps={BUYER_STEPS}
        cta={{ href: '/sign-up', label: 'Set your criteria' }}
        muted
      />

      {/* Bankers, advisors and brokers */}
      <Side
        eyebrow="If you advise on deals"
        heading="Run your clients’ sales here, start to close."
        features={ADVISOR_FEATURES}
        steps={ADVISOR_STEPS}
        cta={{ href: '/sign-up', label: 'Set up your practice' }}
      />

      {/* What this is not */}
      <section className="border-border-subtle border-t">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <div className="flex gap-4">
            <ShieldCheck className="text-text-muted mt-1 h-5 w-5 shrink-0" aria-hidden />
            <div className="w-full space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">What {brand.name} is not</h2>
                <p className="text-text-secondary max-w-2xl text-sm">
                  Worth saying before you rely on any of it, rather than in a footer.
                </p>
              </div>

              <dl className="grid gap-6 sm:grid-cols-2">
                {LIMITS.map((limit) => (
                  <div key={limit.title} className="space-y-1">
                    <dt className="text-sm font-medium">{limit.title}</dt>
                    <dd className="text-text-secondary text-sm leading-relaxed">{limit.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="border-border-subtle border-t">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-8">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">See what is on the market</h2>
                <p className="text-text-muted text-sm">
                  Free to join. A seller hears from you when you request access, not before.
                </p>
              </div>
              <Button asChild size="lg">
                <Link href="/listings">
                  Browse listings
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-border-subtle border-t">
        <div className="text-text-muted mx-auto flex max-w-4xl flex-wrap justify-between gap-4 px-6 py-8 text-xs">
          <p>
            {brand.name} — {brand.tagline}
          </p>
          <nav className="flex gap-4">
            <Link href="/listings" className="hover:text-text-primary">
              Businesses for sale
            </Link>
            <Link href="/tools/valuation" className="hover:text-text-primary">
              Valuation
            </Link>
            <Link href="/sign-in" className="hover:text-text-primary">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function Side({
  eyebrow,
  heading,
  features,
  steps,
  cta,
  muted = false,
}: {
  eyebrow: string;
  heading: string;
  features: Array<{ title: string; body: string }>;
  steps: Array<{ number: number; title: string; body: string }>;
  cta: { href: string; label: string };
  muted?: boolean;
}) {
  return (
    <section className={muted ? 'bg-surface-sunken/40' : undefined}>
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-16">
        <div className="space-y-3">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">{eyebrow}</p>
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>
        </div>

        <dl className="grid gap-6 sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="space-y-1.5">
              <dt className="font-display text-base font-semibold">{feature.title}</dt>
              <dd className="text-text-secondary text-sm leading-relaxed">{feature.body}</dd>
            </div>
          ))}
        </dl>

        <div className="border-border-subtle border-t pt-8">
          <h3 className="text-text-muted mb-5 font-mono text-xs uppercase tracking-[0.16em]">
            How it goes
          </h3>
          <ol className="grid gap-6 sm:grid-cols-2">
            {steps.map((step) => (
              <li key={step.number} className="border-accent flex gap-4 border-l-2 pl-4">
                <span
                  className="text-accent shrink-0 font-mono text-xs font-semibold tabular-nums"
                  aria-hidden
                >
                  {String(step.number).padStart(2, '0')}
                </span>
                <div className="space-y-1">
                  <p className="font-display text-base font-semibold">{step.title}</p>
                  <p className="text-text-secondary text-sm leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <Button asChild>
          <Link href={cta.href}>
            {cta.label}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * The wordmark's companion, inline rather than an <img>.
 *
 * Squared forms in courses under a gold capstone — an ashlar course, which is
 * what the company is named for. Inline so it takes the theme's colours and
 * stays sharp; it is nine shapes, not an illustration worth a network request.
 */
function Mark() {
  return (
    <svg width="26" height="30" viewBox="0 0 26 30" role="img" aria-label="" aria-hidden>
      <rect x="2" y="21" width="22" height="6" rx="1" className="fill-primary" />
      <rect x="5" y="13.5" width="16" height="6" rx="1" className="fill-primary" />
      <rect x="8" y="7" width="10" height="5" rx="1" className="fill-primary" />
      <path d="M13 0 L18 5 H8 Z" className="fill-accent" />
    </svg>
  );
}
