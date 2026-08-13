import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { brand, isBrandFullyConfigured, pageTitle, unconfiguredBrandFields } from '@ib/core';
import { Badge, Button, Card, CardContent } from '@ib/ui';

import {
  BUYER_FEATURES,
  BUYER_STEPS,
  HERO,
  LIMITS,
  SELLER_FEATURES,
  SELLER_STEPS,
} from '@/features/marketing/content';

export const metadata: Metadata = {
  title: pageTitle(),
  description: HERO.subhead,
};

/**
 * The landing page.
 *
 * It sells the mechanism rather than results, because the mechanism is real and
 * the results do not exist yet. "Your business stays anonymous until you issue
 * an NDA" is a stronger claim than "trusted by thousands", and it has the
 * advantage of being true — a test on the copy makes sure it stays that way.
 *
 * Both sides get equal space. A marketplace that reads as built for sellers
 * does not get buyers, and this platform is useless without both.
 */
export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 sm:pt-28">
        {isBrandFullyConfigured ? null : (
          <Badge variant="warning" className="mb-6">
            Placeholder brand config: {unconfiguredBrandFields.join(', ')}
          </Badge>
        )}

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          {HERO.headline}
        </h1>

        <p className="text-text-secondary mt-6 max-w-2xl text-lg leading-relaxed">{HERO.subhead}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/tools/valuation">
              {HERO.primaryCta}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/listings">{HERO.secondaryCta}</Link>
          </Button>
        </div>

        <p className="text-text-muted mt-4 text-sm">
          The valuation takes about five minutes and does not require you to list anything.
        </p>
      </section>

      {/* The confidentiality claim, given its own space because it is the one
          that matters most to the person deciding whether to start. */}
      <section className="border-border-subtle border-y">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <div className="flex gap-4">
            <Lock className="text-text-muted mt-1 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Two records, and buyers only ever reach one</h2>
              <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
                Everything that identifies your business — the name, the address, the exact figures,
                who your customers are — lives in a separate record from the listing. Reaching it
                requires a confidentiality agreement you issued, that has not expired and you have
                not revoked. That is a rule the database enforces on every read, not a permission
                flag in an interface, and it is tested on every build.
              </p>
            </div>
          </div>
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
                <h2 className="text-xl font-semibold">See what your business might be worth</h2>
                <p className="text-text-muted text-sm">
                  No listing, no obligation, and nothing published.
                </p>
              </div>
              <Button asChild size="lg">
                <Link href="/tools/valuation">
                  Start
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
        <div className="space-y-2">
          <p className="text-text-muted text-sm font-medium">{eyebrow}</p>
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>
        </div>

        <dl className="grid gap-6 sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="space-y-1">
              <dt className="text-sm font-medium">{feature.title}</dt>
              <dd className="text-text-secondary text-sm leading-relaxed">{feature.body}</dd>
            </div>
          ))}
        </dl>

        <div className="border-border-subtle border-t pt-8">
          <h3 className="text-text-muted mb-4 text-sm font-medium">How it goes</h3>
          <ol className="grid gap-4 sm:grid-cols-2">
            {steps.map((step) => (
              <li key={step.number} className="flex gap-3">
                <span
                  className="bg-surface-sunken text-text-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                  aria-hidden
                >
                  {step.number}
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{step.title}</p>
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
