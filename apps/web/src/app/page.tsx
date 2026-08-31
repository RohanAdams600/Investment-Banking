import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { brand, isBrandFullyConfigured, pageTitle, unconfiguredBrandFields } from '@ib/core';
import { Badge, Button, cn } from '@ib/ui';

import { HeroBackdrop } from '@/features/marketing/hero-backdrop';
import { SiteHeader } from '@/features/marketing/site-header';
import { TwoRecordsLive } from '@/features/marketing/two-records-live';
import {
  ADVISOR_FEATURES,
  DOORS,
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
      {/*
        The hero, and the two doors.

        Dark, and continuous with the confidentiality band below it, so the top
        of the page is one obsidian slab rather than a light hero with a dark
        stripe under it. That is the institutional register this market
        expects — and it makes the switch to light, at the point the page starts
        explaining itself, do real work.

        The two doors are the whole idea. Almost everybody arriving is either
        buying or selling and knows which before the page loads; making them
        read a paragraph and then pick from a row of buttons wastes the one
        moment they are certain of anything.
      */}
      <section className="relative isolate overflow-hidden bg-slate-900 text-stone-50">
        <HeroBackdrop />

        <div className="relative">
          <SiteHeader tone="dark" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pb-4">
          {isBrandFullyConfigured ? null : (
            <Badge variant="warning" className="mt-6">
              Placeholder brand config: {unconfiguredBrandFields.join(', ')}
            </Badge>
          )}

          <div className="max-w-3xl pb-2 pt-14 sm:pt-20">
            <h1 className="font-display text-balance text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.025em] text-stone-50 sm:text-[4.25rem]">
              {HERO.headline}
            </h1>

            {/*
              A short copper rule between the two, rather than a gap. It gives
              the headline something to sit on and repeats the mark's capstone
              colour — one line doing the job a decorative divider would do,
              without becoming decoration.
            */}
            <span className="bg-copper-400 mt-8 block h-px w-16" aria-hidden />

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-300">{HERO.subhead}</p>
          </div>
        </div>

        {/*
          Two panels, divided by a hairline rather than floated as cards. A pair
          of rounded boxes with an accent rail is the shape every generated
          landing page reaches for; a full-bleed split reads as a threshold,
          which is what this is.
        */}
        <div className="relative mx-auto mt-10 max-w-6xl px-6 pb-16 sm:mt-14 sm:pb-20">
          <div className="grid gap-px overflow-hidden rounded-sm bg-stone-50/10 sm:grid-cols-2">
            {DOORS.map((door) => (
              <Link
                key={door.href}
                href={door.href}
                className="focus-visible:ring-copper-400 group relative flex flex-col gap-4 bg-slate-900 p-8 outline-none transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-inset sm:p-10"
              >
                {/* Rises on hover. The only motion in the hero. */}
                <span
                  className="bg-copper-400 absolute inset-x-0 top-0 h-px origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                  aria-hidden
                />

                <p className="text-copper-400 font-mono text-xs uppercase tracking-[0.2em]">
                  {door.eyebrow}
                </p>

                <h2 className="font-display text-2xl font-semibold leading-tight text-stone-50 sm:text-3xl">
                  {door.title}
                </h2>

                <p className="max-w-sm text-sm leading-relaxed text-stone-300">{door.body}</p>

                {/*
                  Real filter values and real guarantees, not decoration. They
                  do the job a screenshot would: showing what the market is made
                  of, in the words somebody searching already uses.
                */}
                <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1.5">
                  {door.facets.map((facet) => (
                    <li
                      key={facet}
                      className="rounded-full border border-stone-50/15 px-2.5 py-1 font-mono text-[11px] text-stone-400"
                    >
                      {facet}
                    </li>
                  ))}
                </ul>

                <span className="text-copper-400 mt-auto flex items-center gap-2 pt-4 text-sm font-medium">
                  {door.cta}
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>
            ))}
          </div>

          <p className="mt-6 text-sm text-stone-400">
            Browsing takes a free account — sellers are entitled to know who is looking.{' '}
            <Link
              href="/tools/valuation"
              className="text-stone-300 underline decoration-stone-600 underline-offset-4 transition-colors hover:text-stone-50"
            >
              Not ready to list? Work out what your business is worth
            </Link>
            .
          </p>
        </div>
      </section>

      {/*
        The confidentiality claim, on the only dark ground in the product.

        It is the strongest true thing this platform can say and the one a seller
        weighs before anything else, so it gets the full-bleed treatment and the
        diagram rather than a bordered box among other bordered boxes. The band
        is deliberately the single inversion on the page — used twice it would
        stop meaning anything.
      */}
      <section className="border-t border-stone-50/10 bg-slate-900 text-stone-50">
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
              Illustrative figures — no real business is shown.
            </p>
          </div>

          <TwoRecordsLive />
        </div>
      </section>

      {/* Sellers */}
      <Side
        eyebrow="If you are selling"
        heading="Put it on the market without putting the word out."
        features={SELLER_FEATURES}
        steps={SELLER_STEPS}
        cta={{ href: '/sign-up', label: 'List your business' }}
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
      <section className="border-border-subtle bg-surface-sunken/40 border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
          <div>
            <ShieldCheck className="text-accent h-5 w-5" aria-hidden />
            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[1.15]">
              What {brand.name} is not
            </h2>
            <p className="text-text-secondary mt-4 text-sm leading-relaxed">
              Worth saying before you rely on any of it, rather than in a footer.
            </p>
          </div>

          <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {LIMITS.map((limit) => (
              <div key={limit.title} className="space-y-1.5">
                <dt className="font-display text-base font-semibold">{limit.title}</dt>
                <dd className="text-text-secondary text-sm leading-relaxed">{limit.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/*
        The close, back on the dark ground.

        The page opens and ends on the same slab, which frames everything
        between them as the explanation. A card floated inside a section was the
        weaker version: a box asking to be clicked, indistinguishable from the
        boxes above it.
      */}
      <section className="bg-slate-900 text-stone-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-8 px-6 py-16">
          <div className="max-w-xl space-y-3">
            <h2 className="font-display text-2xl font-semibold text-stone-50 sm:text-3xl">
              See what is on the market
            </h2>
            <p className="text-sm leading-relaxed text-stone-300">
              Free to join. A seller hears from you when you request access, not before — and
              nothing you can see before then identifies anybody&rsquo;s business.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="focus-visible:ring-copper-400 bg-stone-50 text-slate-900 hover:bg-stone-200"
            >
              <Link href="/listings">
                Browse businesses for sale
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-stone-50/25 bg-transparent text-stone-50 hover:bg-stone-50/10 hover:text-stone-50"
            >
              <Link href="/sign-up">List your business</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * One side of the market: sellers, buyers, or the advisors between them.
 *
 * ## Why an editorial two-column and not a centred stack
 *
 * The heading sticks to the left rail while the features scroll past it on the
 * right. That is how a printed feature spread is set, and it does two things a
 * centred column cannot: the reader always knows which side of the market they
 * are reading about, and the section keeps the page's spine — the same
 * `max-w-6xl` measure as the hero — instead of pinching to a narrower column
 * halfway down the page, which is the tell that a page was assembled section by
 * section rather than laid out.
 *
 * ## Cells divided by hairlines, not floating in space
 *
 * The features are a grid whose gaps are one-pixel rules. A set of free-floating
 * title-and-paragraph pairs reads as a list of bullet points with the bullets
 * removed; ruled cells read as a table of contents, which is what this is.
 */
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
    <section className={cn('border-border-subtle border-t', muted && 'bg-surface-sunken/40')}>
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
        {/* The rail. Sticky on large screens only — on a phone it is a heading. */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">{eyebrow}</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-[1.15]">
            {heading}
          </h2>
          <span className="bg-accent mt-6 block h-px w-12" aria-hidden />

          <Button asChild className="mt-8 hidden lg:inline-flex">
            <Link href={cta.href}>
              {cta.label}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        <div className="space-y-12">
          <dl className="border-border-subtle grid gap-px overflow-hidden border sm:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title} className="bg-surface -m-px space-y-1.5 border p-6">
                <dt className="font-display text-base font-semibold">{feature.title}</dt>
                <dd className="text-text-secondary text-sm leading-relaxed">{feature.body}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="text-text-muted mb-6 font-mono text-xs uppercase tracking-[0.16em]">
              How it goes
            </h3>

            {/*
              A single vertical rule with the steps hung off it, rather than a
              border per card. Four separate left-bordered boxes is a stack of
              four things; one continuous line is a sequence, which is what a
              numbered process is.
            */}
            <ol className="border-border-default relative space-y-7 border-l pl-6">
              {steps.map((step) => (
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

          <Button asChild className="lg:hidden">
            <Link href={cta.href}>
              {cta.label}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
