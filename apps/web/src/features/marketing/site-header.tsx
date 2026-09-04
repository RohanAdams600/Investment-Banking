import Link from 'next/link';
import { brand } from '@ib/core';
import { cn } from '@ib/ui';

/**
 * The header on every public page.
 *
 * ## Why this exists
 *
 * The landing page had a wordmark and nothing else, and the other public pages —
 * pricing, the sector pages, the legal pages — had not even that. A visitor who
 * landed on a sector page from a search result could reach the rest of the
 * product only by editing the URL, and a page with no way out of it does not
 * read as part of a company.
 *
 * ## Two tones, one component
 *
 * The landing hero is a dark slab and the rest of the public pages are on paper,
 * so the header takes a `tone` rather than being duplicated. Everything else —
 * the links, their order, the wordmark — is shared, which is the point: a nav
 * that differs between pages is worse than no nav.
 *
 * ## What is in it, and what is not
 *
 * Four links and a sign-in. Both sides of the market are reachable in one click
 * (browse, and list), the price is not hidden, and signing in is where a
 * returning user expects it. There is no dropdown: a marketplace with five
 * destinations does not need one, and a menu that opens to reveal four items is
 * a menu that should have been four items.
 */
export function SiteHeader({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const dark = tone === 'dark';

  return (
    <header
      className={cn(
        'relative',
        dark ? 'bg-obsidian-950 text-mist-50' : 'border-border-subtle bg-canvas border-b',
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-5">
        <Link
          href="/"
          className="flex items-center gap-3 outline-none focus-visible:underline focus-visible:underline-offset-4"
        >
          <Mark />
          <span
            className={cn(
              'font-mono text-xs uppercase tracking-[0.2em]',
              dark ? 'text-mist-300' : 'text-text-secondary',
            )}
          >
            {brand.name}
          </span>
        </Link>

        <nav
          aria-label="Main"
          className={cn(
            'flex flex-wrap items-center gap-x-6 gap-y-2 text-sm',
            dark ? 'text-mist-300' : 'text-text-secondary',
          )}
        >
          {/*
            Four links, where the competition carries seven across two rows.

            Their bar offers Businesses, Franchises, Brokers, Buy a Business,
            Buy a Franchise, Sell a Business, Tools & Advice and Business
            Brokers — several of which go to the same place, and the redundancy
            is the reason it is hard to use rather than a bonus. Ours carries
            only what the page itself does not already offer: the hero has the
            buy and sell doors, so the bar adds the market, the third side of
            it, the tool and the price.

            Valuation was here and is not any more. Adding the directory took
            the bar to five links plus a button, which is where it stops being
            scannable and starts being the competitor's two-row nav with our
            wording. The valuation tool is the free thing at the front door
            rather than the thing being sold — it keeps its place in the hero
            and in the footer.

            The middle links are hidden on a phone rather than folded into a
            hamburger. Four links and a button wrap to two rows at 390px and eat
            the top of the hero, and a menu that opens to reveal three items is
            a worse trade than showing the ones that matter. The footer carries
            the full set on every page, so nothing becomes unreachable.
          */}
          <span className="hidden items-center gap-x-6 sm:flex">
            <HeaderLink href="/businesses-for-sale" dark={dark}>
              Buy a business
            </HeaderLink>
            <HeaderLink href="/for-advisors" dark={dark}>
              For advisors
            </HeaderLink>
            <HeaderLink href="/brokers" dark={dark}>
              Find a broker
            </HeaderLink>
            <HeaderLink href="/pricing" dark={dark}>
              Pricing
            </HeaderLink>
          </span>

          <Link
            href="/businesses-for-sale"
            className={cn(
              'underline-offset-4 transition-colors hover:underline sm:hidden',
              dark ? 'hover:text-mist-50' : 'hover:text-text-primary',
            )}
          >
            Browse
          </Link>
          <HeaderLink href="/sign-in" dark={dark}>
            Sign in
          </HeaderLink>

          {/*
            The one filled control in the header, and it is the selling side.
            Buyers arrive on their own; sellers are the scarce half of a
            marketplace, so the button that costs nothing to place points at
            them.
          */}
          <Link
            href="/sell"
            className={cn(
              'rounded-sm px-3.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2',
              dark
                ? 'bg-mist-50 text-obsidian-950 hover:bg-mist-200 focus-visible:ring-offset-obsidian-950 focus-visible:ring-violet-400'
                : 'bg-primary text-primary-fg hover:bg-primary-hover focus-visible:ring-accent',
            )}
          >
            List your business
          </Link>
        </nav>
      </div>
    </header>
  );
}

function HeaderLink({
  href,
  dark,
  children,
}: {
  href: string;
  dark: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'underline-offset-4 transition-colors hover:underline',
        dark ? 'hover:text-mist-50' : 'hover:text-text-primary',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * The wordmark's companion, inline rather than an `<img>`.
 *
 * Squared forms in courses under a copper capstone — an ashlar course, which is
 * what the company is named for. Inline so it takes the surrounding colour and
 * stays sharp at any size; it is four shapes, not an illustration worth a
 * network request.
 */
function Mark() {
  return (
    <svg width="24" height="28" viewBox="0 0 26 30" role="img" aria-label="" aria-hidden>
      <rect x="2" y="21" width="22" height="6" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="5" y="13.5" width="16" height="6" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="8" y="7" width="10" height="5" rx="1" fill="currentColor" opacity="0.85" />
      <path d="M13 0 L18 5 H8 Z" className="fill-violet-400" />
    </svg>
  );
}
