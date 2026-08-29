import Link from 'next/link';
import { brand, type Actor } from '@ib/core';
import { Badge } from '@ib/ui';
import { Bell, Menu } from 'lucide-react';

import { signOut } from '@/features/auth/actions';

import { navLinksFor, unreadBadge, unreadLabel } from './links';

/**
 * The bar across the top of every signed-in page.
 *
 * Built because the application did not have one, and the consequence was worse
 * than it sounds: the dashboard was the only page with links, so every other
 * page was a dead end. A buyer who reached `/matches` could go to a listing or
 * press Back. That is not a website, it is a series of screens.
 *
 * ## Why this lives under a route group
 *
 * The header reads the session, and in the App Router anything that reads a
 * cookie makes its whole subtree dynamic. Putting it in the root layout would
 * have taken the marketing page and the legal pages off static rendering to
 * give them a nav they do not use. So the signed-in routes moved under
 * `app/(app)/` — a group changes no URL — and this renders in that group's
 * layout only.
 *
 * ## No JavaScript
 *
 * The mobile menu is a `<details>` element. It opens on click, closes on
 * Escape, is reachable by keyboard and announced by screen readers, and it
 * works before hydration — which matters most on the connection where
 * hydration is slowest. A `useState` toggle would be a client component, a
 * bundle, and a hydration boundary for a menu.
 */

export interface SiteHeaderProps {
  actor: Actor;
  /** Rendered as a badge. Zero is drawn as nothing rather than as "0". */
  unread: number;
}

export function SiteHeader({ actor, unread }: SiteHeaderProps) {
  const links = navLinksFor(actor);
  const badge = unreadBadge(unread);

  return (
    <header className="border-border-subtle bg-surface-base/90 sticky top-0 z-40 border-b backdrop-blur">
      {/*
        First thing in the tab order and invisible until focused. Without it,
        reaching the content of any page by keyboard means tabbing past every
        link in this header, on every page.
      */}
      <a
        href="#main"
        className="bg-surface-raised focus:ring-primary sr-only rounded px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>

      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
        <Link href="/dashboard" className="font-display shrink-0 text-lg font-semibold">
          {brand.name}
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-text-secondary hover:bg-surface-raised hover:text-text-primary rounded-md px-3 py-1.5 text-sm transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/notifications"
            aria-label={unreadLabel(unread)}
            className="text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {badge === null ? null : <Badge variant="primary">{badge}</Badge>}
          </Link>

          <form action={signOut} className="hidden md:block">
            <button
              type="submit"
              className="text-text-secondary hover:bg-surface-raised hover:text-text-primary rounded-md px-3 py-1.5 text-sm transition-colors"
            >
              Sign out
            </button>
          </form>

          <details className="relative md:hidden">
            <summary
              className="text-text-secondary hover:bg-surface-raised flex cursor-pointer list-none items-center rounded-md px-2.5 py-1.5 marker:content-none"
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </summary>

            <nav
              // Distinct from the desktop bar's label. Two landmarks called
              // "Main" is a list a screen-reader user has to disambiguate by
              // guessing, even when only one is ever visible.
              aria-label="Main menu"
              className="border-border-subtle bg-surface-raised absolute right-0 z-50 mt-2 w-56 rounded-md border p-1 shadow-lg"
            >
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="hover:bg-surface-base block rounded px-3 py-2 text-sm"
                >
                  {link.label}
                </Link>
              ))}

              <Link
                href="/dashboard"
                className="hover:bg-surface-base block rounded px-3 py-2 text-sm"
              >
                Everything else
              </Link>
              {/*
                Above Security deliberately. Verification is the thing a new
                buyer should find, and burying it under a security submenu is
                how a trust signal ends up with nobody using it.
              */}
              <Link
                href="/settings/verification"
                className="hover:bg-surface-base block rounded px-3 py-2 text-sm"
              >
                Funding verification
              </Link>
              <Link
                href="/settings/security"
                className="hover:bg-surface-base block rounded px-3 py-2 text-sm"
              >
                Security
              </Link>

              <form action={signOut}>
                <button
                  type="submit"
                  className="hover:bg-surface-base block w-full rounded px-3 py-2 text-left text-sm"
                >
                  Sign out
                </button>
              </form>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
