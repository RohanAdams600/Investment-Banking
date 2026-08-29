import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * Tabs that are links, not state.
 *
 * ## Why the URL and not `useState`
 *
 * A deal room is a place two people work in together, and "look at the
 * financials tab" is a thing one of them says to the other. With client state
 * that sentence has no URL behind it; with a query parameter it does — the tab
 * is shareable, the back button steps through it, a refresh keeps your place,
 * and the page stays a server component so nothing ships to the browser.
 *
 * It also means the tabs work with JavaScript disabled and are followed by a
 * crawler, which matters on the public listing pages.
 *
 * ## Why the link component is injected
 *
 * This package has no framework dependency and should not gain one for a tab
 * strip. The app passes `next/link` in; anything else that can render an anchor
 * works, and the default is a plain `<a>` so the component is usable and
 * correct on its own — just with a full navigation instead of a client one.
 *
 * ## The accessibility shape
 *
 * `role="tablist"` with links rather than buttons, because these navigate. The
 * selected one carries `aria-current="page"`, which is what a screen reader
 * announces for "you are here" in a set of links — `aria-selected` belongs to
 * real tab widgets that swap panels without navigating, and claiming it here
 * would describe behaviour this does not have.
 */

export interface TabDefinition {
  /** Query-parameter value. Also the anchor of the URL, so keep it a slug. */
  key: string;
  label: string;
  /** Rendered beside the label — a count, usually. Hidden when zero or absent. */
  badge?: number | null;
}

type AnchorLike = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  role?: string;
  'aria-current'?: 'page' | undefined;
}>;

const PlainAnchor: AnchorLike = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

export function Tabs({
  tabs,
  active,
  basePath,
  param = 'tab',
  className,
  as: LinkComponent = PlainAnchor,
}: {
  tabs: TabDefinition[];
  active: string;
  /** Path without the query string, e.g. `/listings/abc`. */
  basePath: string;
  param?: string;
  className?: string;
  /** `next/link` in this app. Defaults to a plain anchor. */
  as?: AnchorLike;
}) {
  return (
    <div
      role="tablist"
      aria-label="Sections"
      className={cn('border-border-subtle -mb-px flex gap-1 overflow-x-auto border-b', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        /*
         * The first tab owns the bare path. Otherwise the canonical URL for a
         * listing has a query string on it, which is a worse thing to share and
         * a worse thing for a crawler to treat as the main page.
         */
        const href = tab.key === tabs[0]?.key ? basePath : `${basePath}?${param}=${tab.key}`;

        return (
          <LinkComponent
            key={tab.key}
            href={href}
            role="tab"
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors',
              selected
                ? 'border-accent text-text-primary font-medium'
                : 'text-text-muted hover:text-text-primary border-transparent',
            )}
          >
            {tab.label}
            {typeof tab.badge === 'number' && tab.badge > 0 ? (
              <span className="bg-surface-sunken text-text-secondary rounded-full px-2 py-0.5 text-xs tabular-nums">
                {tab.badge}
              </span>
            ) : null}
          </LinkComponent>
        );
      })}
    </div>
  );
}
