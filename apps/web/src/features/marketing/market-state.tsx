import Link from 'next/link';
import { ArrowRight, BellRing, BookOpen, Calculator } from 'lucide-react';
import { brand } from '@ib/core';

/**
 * What a visitor sees when the market is empty, which at launch is always.
 *
 * ## Why "opening shortly" was the wrong answer
 *
 * It was on four pages and it does two things badly. It describes what is
 * *absent* — the one fact a visitor can already see for themselves — and it
 * makes a promise with no date attached, which is the register of a parked
 * domain rather than a product. Somebody who arrives from a search result and
 * reads it leaves, because nothing on the page suggests anything works.
 *
 * ## What replaces it
 *
 * Three things that are true today and one that will be:
 *
 *   1. A plain statement of the state. Not an apology, not a promise. A new
 *      marketplace is new, and pretending otherwise is the thing that reads as
 *      untrustworthy.
 *   2. The mechanism by which they hear later — which exists and works, so it
 *      is a description rather than a hope.
 *   3. Three things that work right now with zero listings: the valuation,
 *      the sector guides, and a directory profile. All real, all reachable in
 *      one click.
 *
 * ## The rule this copy still follows
 *
 * No numbers, no timeframe, no "join thousands". A visitor who catches one
 * invented figure stops believing the confidentiality claim too, and that claim
 * is the entire product. "Nothing is listed yet" costs less than being caught.
 */
export function MarketState({
  /** Shown above the fold on the market page; omitted where a heading already exists. */
  heading = 'Nothing is listed yet.',
  /** What the visitor was looking for, so the copy can name it. */
  subject = 'a business',
}: {
  heading?: string;
  subject?: string;
}) {
  return (
    <section className="border-border-subtle bg-surface rounded-md border p-6 sm:p-8">
      <div className="max-w-2xl space-y-3">
        <h2 className="font-display text-xl font-semibold">{heading}</h2>
        <p className="text-text-secondary text-sm leading-relaxed">
          {brand.name} is new. The market fills as owners and their brokers bring businesses to it,
          and until one does there is genuinely nothing to show you — so rather than a countdown,
          here is what works today and how you hear when {subject} arrives.
        </p>
      </div>

      <ul className="border-border-subtle mt-6 grid gap-px overflow-hidden border sm:grid-cols-3">
        <Thing
          icon={<BellRing className="h-4 w-4" aria-hidden />}
          title="Be told, once"
          body="Describe what you are waiting for and you hear the day something matches it. One message, and nothing else."
          href="/listings"
          cta="Set up an alert"
        />
        <Thing
          icon={<Calculator className="h-4 w-4" aria-hidden />}
          title="Value a business"
          body="Several methods side by side with every assumption shown and editable. Works now, publishes nothing, needs no account."
          href="/tools/valuation"
          cta="Open the tool"
        />
        <Thing
          icon={<BookOpen className="h-4 w-4" aria-hidden />}
          title="Read the sector guides"
          body="What a buyer of each kind of business examines first, and which facts move the price in each direction."
          href="/businesses-for-sale"
          cta="Browse by sector"
        />
      </ul>
    </section>
  );
}

function Thing({
  icon,
  title,
  body,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <li className="bg-surface -m-px border p-5">
      <Link href={href} className="group flex h-full flex-col gap-2">
        <span className="text-accent flex items-center gap-2">
          {icon}
          <span className="font-display group-hover:text-accent text-sm font-semibold text-[rgb(var(--color-text-primary))] transition-colors">
            {title}
          </span>
        </span>
        <p className="text-text-secondary flex-1 text-sm leading-relaxed">{body}</p>
        <span className="text-accent mt-1 flex items-center gap-1.5 text-xs font-medium">
          {cta}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </Link>
    </li>
  );
}
