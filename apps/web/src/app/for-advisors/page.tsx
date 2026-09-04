import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Percent } from 'lucide-react';
import { brand, pageTitle } from '@ib/core';
import { Button, Card, CardContent } from '@ib/ui';

import { SiteHeader } from '@/features/marketing/site-header';
import { ADVISOR_FEATURES, ADVISOR_STEPS } from '@/features/marketing/content';

export const metadata: Metadata = {
  title: pageTitle('For brokers and M&A advisors'),
  description:
    'Run your clients’ sales here, start to close: anonymous listings, a document vault with an access log, a pipeline, and commission records. No success fee — we never take a percentage of what you earn.',
  alternates: { canonical: '/for-advisors' },
};

/*
 * Dynamically rendered so the enforcing nonce CSP works. See
 * `src/app/csp-rendering.test.ts` for why a static page is dead under it.
 */
export const dynamic = 'force-dynamic';

/**
 * The page that goes in a broker outreach email.
 *
 * ## Why this is the most important marketing page on the site
 *
 * A marketplace with no listings cannot attract buyers, and with no buyers
 * cannot attract sellers. Courting sellers one at a time never escapes that
 * loop. A broker arrives with a book of twenty, so every broker persuaded is
 * worth twenty owners persuaded — which makes this the page the business
 * actually runs on, not `/sell`.
 *
 * It replaces a `#advisors` anchor on the home page. An anchor is not a
 * destination: you cannot put it in an email, it does not rank for anything,
 * and it drops somebody two-thirds of the way down a page written for three
 * audiences.
 *
 * ## The lead is the fee
 *
 * A broker's first question about any platform is what it costs them per deal,
 * because the answer is usually a slice of their commission. Ours is none, and
 * burying that below the feature list would waste the only thing that makes a
 * broker read the feature list.
 */
export default function ForAdvisorsPage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="bg-obsidian-950 text-mist-50">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-violet-400">
              If you advise on deals
            </p>

            <h1 className="font-display text-mist-50 mt-6 max-w-3xl text-balance text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-6xl">
              We never take a slice of your fee.
            </h1>

            <span className="mt-8 block h-px w-16 bg-violet-400" aria-hidden />

            <p className="text-mist-300 mt-6 max-w-xl text-lg leading-relaxed">
              Run your clients&rsquo; sales here start to close — anonymous listings you manage on
              their behalf, a document vault with an access log, a pipeline, and the commission
              record kept beside the deal. What you charge your client stays between you and them.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="bg-mist-50 text-obsidian-950 hover:bg-mist-200 focus-visible:ring-violet-400"
              >
                <Link href="/sign-up">
                  Set up your practice
                  <ArrowRight aria-hidden />
                </Link>
              </Button>

              <Link
                href="/brokers"
                className="text-mist-300 decoration-mist-50/25 hover:text-mist-50 text-sm underline underline-offset-4 transition-colors"
              >
                Or see the directory first
              </Link>
            </div>

            <p className="text-mist-400 mt-8 flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
              Free through launch, no card.{' '}
              <Link
                href="/pricing#advising"
                className="decoration-mist-50/25 hover:text-mist-50 underline underline-offset-4"
              >
                See what it will cost
              </Link>
            </p>
          </div>
        </section>

        {/*
          The fee point, given its own band rather than a bullet.

          It is the only structural difference between us and the alternatives a
          broker is weighing, and a structural difference stated in a list reads
          like a feature. This is the argument.
        */}
        <section className="border-border-subtle border-t">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="flex max-w-3xl gap-4">
              <Percent className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight">
                  A platform that takes a success fee is competing with you.
                </h2>
                <p className="text-text-secondary text-sm leading-relaxed">
                  It is the same money. A marketplace charging a percentage of the sale is charging
                  it out of the pool your engagement letter is written against, and it has an
                  incentive to get between you and your client to protect it.
                </p>
                <p className="text-text-secondary text-sm leading-relaxed">
                  {brand.name} charges a subscription and nothing else. No percentage, no referral
                  cut, no fee for introducing a buyer — and no money moves through the platform at
                  all, so there is no escrow to argue about either. Your client relationship is
                  yours.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-border-subtle bg-surface-sunken/40 border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">
                What you get
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[1.15]">
                The tooling, without handing anyone your credentials.
              </h2>
              <span className="bg-accent mt-6 block h-px w-12" aria-hidden />
            </div>

            <dl className="border-border-subtle grid gap-px overflow-hidden border sm:grid-cols-2">
              {ADVISOR_FEATURES.map((feature) => (
                <div key={feature.title} className="bg-surface -m-px space-y-1.5 border p-6">
                  <dt className="font-display text-base font-semibold">{feature.title}</dt>
                  <dd className="text-text-secondary text-sm leading-relaxed">{feature.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-border-subtle border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">
                How it goes
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[1.15]">
                Four steps, and your client approves each one.
              </h2>
              <span className="bg-accent mt-6 block h-px w-12" aria-hidden />
              <p className="text-text-secondary mt-6 text-sm leading-relaxed">
                A directory profile costs nothing and needs no listing, so you can be findable here
                before you bring a client.
              </p>
            </div>

            <ol className="border-border-default relative space-y-8 border-l pl-6">
              {ADVISOR_STEPS.map((step) => (
                <li key={step.number} className="relative">
                  <span
                    className="bg-accent absolute -left-[1.625rem] top-2 h-1.5 w-1.5 rounded-full ring-4 ring-[rgb(var(--color-canvas))]"
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

        <section className="border-border-subtle border-t">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-6 py-8">
                <div className="max-w-xl space-y-1">
                  <h2 className="font-display text-xl font-semibold">
                    Start with a directory profile.
                  </h2>
                  <p className="text-text-muted text-sm leading-relaxed">
                    Free, no listing required, and it stays unpublished until you say otherwise.
                  </p>
                </div>
                <Button asChild size="lg">
                  <Link href="/sign-up">
                    Set up your practice
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
