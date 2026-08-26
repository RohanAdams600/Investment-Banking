import { can, type Actor } from '@ib/core';

/**
 * What goes in the top bar, for this person.
 *
 * Separated from the header component because it is the half that can be wrong
 * in a way worth testing: a link offered to somebody whose destination will
 * refuse them is a door that does not open, and every one of those trains
 * people to distrust the nav. The markup around it is not the part that gets
 * this wrong.
 *
 * Scoped by capability rather than role name. `can(actor, 'listing:create')`
 * survives a reorganisation of the role model; `roles.includes('seller')` would
 * have to be found and changed in every file the day a second sell-side role
 * appears.
 *
 * None of this is access control. Every destination re-checks, every action
 * re-checks, and the database refuses regardless — this decides what to offer,
 * not what is allowed.
 */

export interface NavLink {
  href: string;
  label: string;
}

/**
 * The full set, in the order they appear.
 *
 * Seven at most, and deliberately not the fourteen on the dashboard. A top bar
 * is for the places somebody goes repeatedly; the rest is one click away behind
 * the wordmark. A nav that lists everything is a nav nobody reads.
 *
 * Seven rather than six only because Documents was added, and only an account
 * holding buy-side, sell-side, intermediary and administrator roles at once
 * reaches it — a test fixture rather than a person. A seller sees four.
 */
export function navLinksFor(actor: Actor): NavLink[] {
  const candidates: (NavLink & { show: boolean })[] = [
    { href: '/listings', label: 'Browse', show: can(actor, 'listing:view_teaser') },
    { href: '/listings/mine', label: 'My listings', show: can(actor, 'listing:create') },
    { href: '/matches', label: 'Matches', show: can(actor, 'listing:view_full') },
    { href: '/deals', label: 'Deals', show: can(actor, 'deal_room:access') },
    { href: '/crm', label: 'Pipeline', show: can(actor, 'crm:manage') },
    /*
     * The document workbench was reachable only from a dashboard card, which
     * meant nobody who had not already scrolled the dashboard knew it existed.
     * Shown to anyone who can put a listing on the market or run one for a
     * client — the people who need a purchase agreement to look at.
     */
    {
      href: '/tools/legal-documents',
      label: 'Documents',
      show: can(actor, 'listing:create') || can(actor, 'listing:manage_for_client'),
    },
    { href: '/admin', label: 'Operations', show: can(actor, 'admin:view_platform_analytics') },
  ];

  return candidates.filter((link) => link.show).map(({ href, label }) => ({ href, label }));
}

/**
 * How the unread count is drawn.
 *
 * Zero returns null rather than "0", because a badge reading zero draws the eye
 * to nothing. Anything past 99 stops being a number somebody acts on and starts
 * being a layout problem.
 */
export function unreadBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > 99 ? '99+' : String(Math.floor(unread));
}

/** What a screen reader hears on the bell. A badge is a coloured shape to it. */
export function unreadLabel(unread: number): string {
  const badge = unreadBadge(unread);
  return badge === null ? 'Notifications' : `Notifications, ${badge} unread`;
}
