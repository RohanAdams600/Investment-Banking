import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Lock, ShieldCheck } from 'lucide-react';
import { brand, pageTitle } from '@ib/core';
import { Button, Card, CardContent } from '@ib/ui';

import { SiteHeader } from '@/features/marketing/site-header';
import { SELLER_FEATURES, SELLER_STEPS } from '@/features/marketing/content';

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
  title: pageTitle('Sell a business'),
  description:
    'Sell your business without telling the market. List anonymously — industry, state and size ranges only — and release the name, the address and the exact figures to a buyer only after you have issued them a confidentiality agreement. Free to list.',
  alternates: { canonical: '/sell' },
};

/**
 * The page an owner lands on, and the URL that goes in an advertisement.
 *
 * ## Why this exists as its own page
 *
 * Everything on it appears somewhere on the home page already, which is exactly
 * why it was missing and exactly why it is needed. A home page has to serve
 * buyers, sellers and intermediaries at once; a link in a broker's email, a
 * post in an owners' group, or a search for "sell my business" is a single
 * audience with a single question, and sending them to a page that opens with
 * two doors makes them do the sorting.
 *
 * The competitor this is measured against has had a dedicated seller page for
 * years and puts every acquisition dollar behind it. Ours differs in what it
 * leads with: they lead with reach — visitor counts and a multiple of buyers —
 * and we cannot and would not claim numbers we do not have. We lead with the
 * thing they structurally cannot offer, which is that the listing does not
 * identify the business until the owner decides it does.
 *
 * ## What it does not do
 *
 * No testimonials, no "businesses sold", no timeframes. The marketing copy test
 * covers the strings this page imports; the ones written inline here follow the
 * same rule, because a seller who catches one invented number stops believing
 * the confidentiality claim too — and that claim is the entire product.
 */
export default function SellPage() {
  return (
    <>
      <SiteHeader />

      <main>
        {/* The hero, on the same obsidian slab the home page opens with. */}
        <section className="bg-obsidian-950 text-mist-50">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-violet-400">
              If you are selling
            </p>

            <h1 className="font-display text-mist-50 mt-6 max-w-3xl text-balance text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-6xl">
              Sell your business without telling the market.
            </h1>

            <span className="mt-8 block h-px w-16 bg-violet-400" aria-hidden />

            <p className="text-mist-300 mt-6 max-w-xl text-lg leading-relaxed">
              List anonymously — industry, state and size ranges only. Your name, your address and
              your exact figures stay sealed until you personally issue a confidentiality agreement
              to a buyer you have chosen.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="bg-mist-50 text-obsidian-950 hover:bg-mist-200 focus-visible:ring-violet-400"
              >
                <Link href="/sign-up">
                  List your business
                  <ArrowRight aria-hidden />
                </Link>
              </Button>

              <Link
                href="/tools/valuation"
                className="text-mist-300 decoration-mist-50/25 hover:text-mist-50 text-sm underline underline-offset-4 transition-colors"
              >
                Or work out what it is worth first
              </Link>
            </div>

            {/*
              The price, in the hero.

              An owner's second question is always what it costs, and burying it
              three sections down is how a page loses the people who assumed the
              answer was bad. It is also the strongest thing we can say against a
              marketplace that charges by the month to appear at all.
            */}
            <p className="text-mist-400 mt-8 flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
              Free to list, with no card and no time limit.{' '}
              <Link
                href="/pricing#selling"
                className="decoration-mist-50/25 hover:text-mist-50 underline underline-offset-4"
              >
                See what is paid
              </Link>
            </p>
          </div>
        </section>

        {/* What an owner gets, from the shared copy the tests already cover. */}
        <section className="border-border-subtle border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">
                What you get
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[1.15]">
                Control over who learns what, and when.
              </h2>
              <span className="bg-accent mt-6 block h-px w-12" aria-hidden />
            </div>

            <dl className="border-border-subtle grid gap-px overflow-hidden border sm:grid-cols-2">
              {SELLER_FEATURES.map((feature) => (
                <div key={feature.title} className="bg-surface -m-px space-y-1.5 border p-6">
                  <dt className="font-display text-base font-semibold">{feature.title}</dt>
                  <dd className="text-text-secondary text-sm leading-relaxed">{feature.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* The process. */}
        <section className="border-border-subtle bg-surface-sunken/40 border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">
                How it goes
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[1.15]">
                Four steps, and you decide at each one.
              </h2>
              <span className="bg-accent mt-6 block h-px w-12" aria-hidden />
              <p className="text-text-secondary mt-6 text-sm leading-relaxed">
                Nothing is published, and nobody is contacted, until you say so. A draft is visible
                only to you for as long as you want it to be.
              </p>
            </div>

            <ol className="border-border-default relative space-y-8 border-l pl-6">
              {SELLER_STEPS.map((step) => (
                <li key={step.number} className="relative">
                  <span
                    className="bg-accent absolute -left-[1.625rem] top-2 h-1.5 w-1.5 rounded-full ring-4 ring-[rgb(var(--color-surface-sunken))]"
                    aria-hidden
                  />
                  <p className="text-text-muted font-mono text-[11px] tabular-nums" aria-hidden>
                    {String(step.number).padStart(2, '0')}
                  </p>
                  <p className="font-display mt-1 text-base font-semibold">{step.title}</p>
                  <p className="text-text-secondary mt-1 max-w-xl text-sm leading-relaxed">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/*
          The two honest limits, on the page that most needs them.

          An owner deciding whether to put their life's work on a website is
          owed the edges of the promise, not only its middle. Saying it here
          rather than in terms nobody reads is the difference between a claim
          and a disclosure — and a seller who finds the limit themselves, later,
          stops believing everything else.
        */}
        <section className="border-border-subtle border-t">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="flex max-w-3xl gap-4">
              <ShieldCheck className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-6">
                <h2 className="text-2xl font-semibold tracking-tight">
                  What anonymity can and cannot do
                </h2>

                <div className="space-y-4">
                  <p className="text-text-secondary text-sm leading-relaxed">
                    The gate on your confidential record is a database policy that a buyer without a
                    signed agreement cannot pass, tested on every build — not a setting in an
                    interface. Access is per-buyer and revocable, documents carry the viewer&rsquo;s
                    name and the minute they opened them, and you see the log.
                  </p>
                  <p className="text-text-secondary text-sm leading-relaxed">
                    What it cannot do is un-write a teaser. If you describe the business
                    specifically enough that somebody local recognises it, no rule we enforce will
                    help — so the listing form warns you at the fields where that happens. And a
                    watermark makes a leak attributable rather than impossible; nothing stops a
                    photograph of a screen.
                  </p>
                </div>

                <p className="text-text-muted flex items-center gap-2 text-xs">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {brand.name} is software, not your broker. It does not represent you, negotiate,
                  or take a percentage of your sale.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Close. */}
        <section className="border-border-subtle border-t">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-6 py-8">
                <div className="max-w-xl space-y-1">
                  <h2 className="font-display text-xl font-semibold">
                    Start with a draft nobody can see.
                  </h2>
                  <p className="text-text-muted text-sm leading-relaxed">
                    Free, no card, and you choose the wording, the price and the day it goes live.
                  </p>
                </div>
                <Button asChild size="lg">
                  <Link href="/sign-up">
                    List your business
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </>
  );
}
