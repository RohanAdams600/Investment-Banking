import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { brand, pageTitle } from '@ib/core';
import { Button, Card, CardContent } from '@ib/ui';
import { SiteHeader } from '@/features/marketing/site-header';

/*
 * Dynamically rendered, so the Content Security Policy can be enforced.
 *
 * The CSP is nonce-based with `strict-dynamic`, and the nonce is minted per
 * request in `src/middleware.ts`. A statically prerendered page's HTML was
 * generated at build time, before any nonce existed, so Next never stamps one
 * onto its script tags — and under `strict-dynamic` a script without the nonce
 * is refused. Every script on this page was blocked and it rendered as dead
 * HTML.
 *
 * That is not hypothetical: it is what an enforcing CSP did to this route,
 * observed in a browser. A nonce CSP and a cached HTML document are mutually
 * exclusive, and between the two, the control that stops an injected script
 * running on a site handling confidential company information is worth more
 * than a prerender of static copy.
 */
export const dynamic = 'force-dynamic';

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

/**
 * Two price lists, because there are two customers.
 *
 * ## Owners pay for attention, not for access
 *
 * The established marketplace in this category charges an owner a monthly fee
 * per listing, tiered by placement, and takes nothing when the business sells.
 * That is the model that works here, and the reason is structural rather than
 * cultural: a marketplace that takes a percentage of the sale is competing for
 * the same money as the brokers who bring it most of its inventory, and those
 * brokers can list somewhere else.
 *
 * We differ in one deliberate place. A standard listing is free and stays free.
 * Charging an owner to appear at all is a toll on supply, and supply is the
 * thing a new marketplace has least of — an owner who pays to be listed
 * somewhere with no buyers does it once. Paying for *placement* is a different
 * transaction: it is worth something only when there is competition for
 * attention, which is exactly when we deserve to be paid for it.
 *
 * ## What is deliberately absent
 *
 * No success fee. No percentage of the sale price. Not a philosophical
 * position — a broker whose fee we were competing with would list elsewhere,
 * and intermediaries bring listings in bulk.
 */
const SELLER_TIERS: Tier[] = [
  {
    name: 'Listing',
    price: '$0',
    cadence: 'always free',
    who: 'An owner bringing one business to market.',
    features: [
      'A live, anonymous listing for as long as you need it',
      'Valuation across several methods, with the assumptions shown',
      'You issue the confidentiality agreement, and can revoke it',
      'Deal rooms, messaging and a document vault with an access log',
      'Buyer verification badges on everyone who asks for access',
    ],
    cta: { label: 'List your business', href: '/sign-up' },
  },
  {
    name: 'Featured',
    price: '$79',
    cadence: 'per listing, per month',
    who: 'An owner who wants to be found first.',
    features: [
      'Everything in Listing',
      'Promoted placement at the top of browse and search results',
      'Labelled as paid placement, because ranking by payment silently is deceptive',
      'Cancel whenever — the listing stays, the placement stops',
    ],
    cta: { label: 'Start free', href: '/sign-up' },
    emphasis: true,
  },
  {
    name: 'Premier',
    price: '$179',
    cadence: 'per listing, per month',
    who: 'A larger business where reach is worth paying for.',
    features: [
      'Everything in Featured',
      'Top placement, above other promoted listings',
      'Priority listing review, so it goes live the same day',
      'Your listing included in the sector page for its industry',
    ],
    cta: { label: 'Start free', href: '/sign-up' },
  },
];

const ADVISOR_TIERS: Tier[] = [
  {
    name: 'Broker',
    price: '$99',
    cadence: 'per month',
    who: 'An intermediary running deals for clients.',
    features: [
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

        <TierGroup
          id="selling"
          eyebrow="If you are selling a business"
          heading="A listing is free. Being seen first is not."
          note="Charging an owner to appear at all is a toll on the thing a new marketplace has least of. Paying for placement is worth something only when there is competition for attention — which is exactly when we have earned it."
          tiers={SELLER_TIERS}
        />

        <TierGroup
          id="advising"
          eyebrow="If you run deals for clients"
          heading="The tooling a practice needs, per month."
          note={`${brand.name} never takes a percentage of a sale, so nothing here competes with your fee. What you are paying for is the pipeline, the vault and the commission record — not permission to bring a client.`}
          tiers={ADVISOR_TIERS}
        />

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

/**
 * One priced audience.
 *
 * Split into groups rather than shown as five cards in a row because the two
 * are not comparable: an owner choosing between Featured and Premier is making
 * a different decision from a broker choosing between Broker and Firm, and a
 * single row invites a comparison between the two that means nothing. The note
 * under each heading carries the reasoning, which is the part that makes a
 * price feel like a decision rather than a demand.
 */
function TierGroup({
  id,
  eyebrow,
  heading,
  note,
  tiers,
}: {
  id: string;
  eyebrow: string;
  heading: string;
  note: string;
  tiers: Tier[];
}) {
  return (
    <section id={id} className="mt-16 scroll-mt-4">
      <div className="max-w-2xl space-y-3">
        <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>
        <p className="text-text-secondary text-sm leading-relaxed">{note}</p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {tiers.map((tier) => (
          <Card key={tier.name} className={tier.emphasis ? 'border-accent' : undefined}>
            <CardContent className="flex h-full flex-col gap-5 py-8">
              <div className="space-y-1">
                <h3 className="font-display text-xl font-semibold">{tier.name}</h3>
                <p className="text-text-muted text-sm">{tier.who}</p>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{tier.price}</span>
                <span className="text-text-muted text-sm">{tier.cadence}</span>
              </div>

              {/*
                Not shown on the free tier. "Free through launch" over a $0
                price reads as a limited-time offer on something that is not
                limited, which is the one place this page could mislead.
              */}
              {tier.price === '$0' ? null : (
                <p className="text-accent text-2xs font-mono uppercase tracking-[0.14em]">
                  Free through launch
                </p>
              )}

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
    </section>
  );
}
