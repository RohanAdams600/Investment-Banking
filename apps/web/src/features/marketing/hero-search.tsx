import Link from 'next/link';
import { Search } from 'lucide-react';
import { INDUSTRY_PROFILES } from '@ib/core';

import { GUIDED_INDUSTRY_KEYS } from '@/features/market/industry-guides';

/**
 * Search, in the hero, above everything else a buyer might do.
 *
 * ## Why the front page needed one at all
 *
 * The competition puts a search box at the top of every page, and it is the one
 * thing they get unambiguously right: a marketplace whose front page cannot be
 * searched is a brochure. Ours had no search anywhere a logged-out visitor could
 * reach, and its primary call to action pointed at a route behind the auth
 * boundary — so the first thing a buyer met was a sign-up form, before they had
 * been shown a single business.
 *
 * ## A plain GET form
 *
 * No JavaScript, no client component, no state. The consequences are worth
 * spelling out because they are the reason this beats a fancier control: a
 * search is a shareable URL, the back button works, the results page stays a
 * server component, and a crawler that follows `?q=` gets real results instead
 * of an empty shell. A combobox with suggestions would look more modern and lose
 * all four.
 *
 * ## And the sectors underneath
 *
 * A search box is only useful to somebody who already knows what to type. Most
 * people arriving at a business-for-sale marketplace do not — they know roughly
 * what kind of thing they want to own. The row underneath is the answer to
 * "like what?", and each link lands on a written guide rather than an empty
 * filtered list, which matters when the market is new and most filters return
 * nothing.
 */
export function HeroSearch() {
  return (
    <div className="max-w-2xl">
      <form action="/businesses-for-sale" method="get" className="flex gap-2">
        <label htmlFor="hero-q" className="sr-only">
          Search businesses for sale
        </label>

        <div className="relative flex-1">
          <Search
            className="text-mist-500 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            id="hero-q"
            name="q"
            type="search"
            maxLength={100}
            placeholder="HVAC, landscaping, distribution, machine shop…"
            className="border-mist-50/15 bg-mist-50/[0.06] text-mist-50 placeholder:text-mist-400 hover:border-mist-50/25 h-12 w-full rounded-sm border pl-10 pr-3 text-sm outline-none transition-colors focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-violet-400"
          />
        </div>

        <button
          type="submit"
          className="bg-mist-50 text-obsidian-950 hover:bg-mist-200 focus-visible:ring-offset-obsidian-950 h-12 shrink-0 rounded-sm px-6 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
        >
          Search
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-mist-500 font-mono text-[11px] uppercase tracking-[0.18em]">
          Or browse
        </span>
        {GUIDED_INDUSTRY_KEYS.slice(0, 5).map((industry) => (
          <Link
            key={industry}
            href={`/businesses-for-sale/industry/${industry}`}
            className="text-mist-300 decoration-mist-50/25 hover:text-mist-50 text-sm underline underline-offset-4 transition-colors hover:decoration-violet-400"
          >
            {shortLabel(INDUSTRY_PROFILES[industry].label)}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * The sector name without its parenthetical.
 *
 * `INDUSTRY_PROFILES` labels are written for a page heading, where "Home
 * services (HVAC, plumbing, electrical)" is exactly right — it tells an owner
 * searching for one of those three that they are in the correct place. In a row
 * of five links it is the wrong shape: the examples triple the width, the row
 * wraps to three lines, and the thing the row is for — glanceable choice —
 * stops working. The full label still appears on the page each link leads to.
 */
function shortLabel(label: string): string {
  const open = label.indexOf(' (');
  return open === -1 ? label : label.slice(0, open);
}
