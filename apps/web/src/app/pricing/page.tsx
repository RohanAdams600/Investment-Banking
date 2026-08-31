import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { brand, pageTitle } from '@ib/core';
import { Button, Card, CardContent } from '@ib/ui';
import { SiteHeader } from '@/features/marketing/site-header';

export const metadata: Metadata = {
  title: pageTitle('Pricing'),
  description: `What ${brand.name} costs for owners, buyers and the bankers and brokers who run deals here. Free for founding members through launch.`,
  alternates: { canonical: '/pricing' },
};

/**
 * What it costs, before anybody is charged.
 *
 * ## Why a price list on a product that takes no money
 *
 * A broker deciding whether to bring a client somewhere wants to know what it
 * will cost them later, and "we haven't decided" is a worse answer than a number
 * — it reads as a business that has not thought about how it survives. So the
 * tiers are published and everything is free during launch, which is true,
 * checkable, and reversible.
 *
 * There is deliberately no Stripe behind this. Charging for placement on a board
 * with no listings is a bad first impression, and every hour spent on billing
 * failure cases is an hour not spent finding the first ten sellers.
 *
 * ## What the numbers are not
 *
 * Not a commitment. The launch banner says free for founding members, and
 * nothing here takes a card, so nobody is agreeing to anything by reading it.
 */

interface Tier {
  name: string;
  price: string;
  cadence: string;
  who: string;
  features: string[];
  cta: { label: string; href: string };
  emphasis?: boolean;
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'always',
    who: 'Owners testing the water, and buyers looking.',
    features: [
      'Browse every listing on the market',
      'Valuation across several methods, with the assumptions shown',
      'Record your acquisition criteria and get matched',
      'One listing of your own',
      'Deal rooms, messaging and confidentiality agreements',
    ],
    cta: { label: 'Create an account', href: '/sign-up' },
  },
  {
    name: 'Broker',
    price: '$99',
    cadence: 'per month',
    who: 'An intermediary running deals for clients.',
    features: [
      'Everything in Free',
      'Unlimited listings, managed on behalf of your clients',
      'Pipeline: contacts, tasks and reminders across every engagement',
      'Document vault with per-document grants and an access log',
      'Commission records kept alongside the deal',
      'One promoted position at the top of search',
    ],
    cta: { label: 'Start free', href: '/sign-up' },
    emphasis: true,
  },
  {
    name: 'Firm',
    price: '$299',
    cadence: 'per month',
    who: 'A practice with several people on the same deals.',
    features: [
      'Everything in Broker',
      'Multiple seats, with firm-level access to shared listings',
      'Fee arrangements and commission reporting across the firm',
      'Priority listing review',
      'Three promoted positions',
    ],
    cta: { label: 'Start free', href: '/sign-up' },
  },
];

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <header className="max-w-2xl space-y-4">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">Pricing</p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Free while we are finding the first listings.
          </h1>
          <div className="bg-accent h-0.5 w-16" aria-hidden />
          <p className="text-text-secondary leading-relaxed">
            These are the prices {brand.name} will charge once there is a market worth charging for.
            Until then every tier is free for founding members, nothing here takes a card, and you
            are not agreeing to anything by reading this page.
          </p>
        </header>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <Card key={tier.name} className={tier.emphasis ? 'border-accent' : undefined}>
              <CardContent className="flex h-full flex-col gap-5 py-8">
                <div className="space-y-1">
                  <h2 className="font-display text-xl font-semibold">{tier.name}</h2>
                  <p className="text-text-muted text-sm">{tier.who}</p>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums">{tier.price}</span>
                  <span className="text-text-muted text-sm">{tier.cadence}</span>
                </div>

                <p className="text-accent text-2xs font-mono uppercase tracking-[0.14em]">
                  Free through launch
                </p>

                <ul className="flex-1 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-sm leading-relaxed">
                      <Check className="text-accent mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span className="text-text-secondary">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button asChild variant={tier.emphasis ? 'primary' : 'secondary'}>
                  <Link href={tier.cta.href}>{tier.cta.label}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/*
        Said here rather than in a footer, because the two questions a broker
        asks after "what does it cost" are "do you take a cut of my fee" and "do
        you touch the money" — and the answers are unusual enough to be worth
        stating where the prices are.
      */}
        <section className="border-border-subtle mt-16 border-t pt-10">
          <h2 className="font-display text-2xl font-semibold">What is not in the price</h2>
          <dl className="mt-6 grid gap-8 sm:grid-cols-2">
            <div className="space-y-1.5">
              <dt className="font-display text-base font-semibold">No commission on your deals</dt>
              <dd className="text-text-secondary text-sm leading-relaxed">
                {brand.name} does not take a percentage of anything you close. The commission
                records here are for your own bookkeeping, and the fee is between you and your
                client.
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="font-display text-base font-semibold">No money moves through us</dt>
              <dd className="text-text-secondary text-sm leading-relaxed">
                There is no escrow and no payment rail. Funds move the way they always have, between
                the parties and their advisors.
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="font-display text-base font-semibold">
                Promoted placement is labelled
              </dt>
              <dd className="text-text-secondary text-sm leading-relaxed">
                A paid position at the top of search says so, in words, on the listing. Buyers are
                entitled to know which results were bought.
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="font-display text-base font-semibold">Not a broker, not an advisor</dt>
              <dd className="text-text-secondary text-sm leading-relaxed">
                {brand.name} is software. It does not represent either side and does not earn a fee
                for recommending anything.
              </dd>
            </div>
          </dl>
        </section>
      </main>
    </>
  );
}
