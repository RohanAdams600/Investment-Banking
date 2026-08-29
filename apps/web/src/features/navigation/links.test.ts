import { describe, expect, it } from 'vitest';
import type { Actor, PlatformRole } from '@ib/core';

import { navLinksFor, unreadBadge, unreadLabel } from './links';

/**
 * The nav, from the point of view of somebody using it.
 *
 * The test that matters is the negative one: a link offered to somebody whose
 * destination will refuse them is a door that does not open, and a few of those
 * teach people to stop trusting the bar entirely. So most of this asserts what
 * each role does *not* see.
 */
function actorWith(...roles: PlatformRole[]): Actor {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    platformRoles: roles,
    firmMemberships: [],
  };
}

const hrefs = (actor: Actor) => navLinksFor(actor).map((link) => link.href);

describe('navLinksFor', () => {
  it('offers a new account nothing', () => {
    // Registration grants no roles, and deny-by-default means deny in the nav
    // too. Onboarding is where such an account is sent.
    expect(navLinksFor(actorWith())).toEqual([]);
  });

  it('gives a seller their listings and their deals', () => {
    const links = hrefs(actorWith('seller'));

    expect(links).toContain('/listings/mine');
    expect(links).toContain('/deals');
  });

  it('does not offer a seller the buyer’s match list', () => {
    // `/matches` ranks listings against acquisition criteria. A seller has
    // none, so the page would be empty at best and confusing at worst.
    expect(hrefs(actorWith('seller'))).not.toContain('/matches');
  });

  it('gives a buyer the market and their matches', () => {
    const links = hrefs(actorWith('buyer'));

    expect(links).toContain('/listings');
    expect(links).toContain('/matches');
  });

  it('does not offer a buyer the seller’s listing manager', () => {
    expect(hrefs(actorWith('buyer'))).not.toContain('/listings/mine');
  });

  it('gives a broker their pipeline', () => {
    expect(hrefs(actorWith('broker'))).toContain('/crm');
  });

  it('offers the pipeline to a buyer and a seller too', () => {
    // Worth stating, because the instinct is that a CRM is the professional
    // side of the product. `crm:manage` is granted to both buy-side and
    // sell-side roles on purpose: a buyer pursuing four businesses has a
    // pipeline in exactly the sense the word means, and so does a seller
    // fielding enquiries. The capability model decided this; the nav follows it
    // rather than second-guessing it.
    expect(hrefs(actorWith('buyer'))).toContain('/crm');
    expect(hrefs(actorWith('seller'))).toContain('/crm');
  });

  it('offers platform operations to an administrator and nobody else', () => {
    expect(hrefs(actorWith('admin'))).toContain('/admin');
    expect(hrefs(actorWith('broker'))).not.toContain('/admin');
    expect(hrefs(actorWith('buyer'))).not.toContain('/admin');
    expect(hrefs(actorWith('seller'))).not.toContain('/admin');
  });

  it('stays short for the people who actually exist', () => {
    /*
     * A top bar is for the places somebody goes repeatedly. If it grows past
     * what fits on a laptop the answer is the dashboard, not a smaller font.
     *
     * Capped per real account rather than on the union of every role. The
     * union is a test fixture — nobody is simultaneously a buyer, a seller, a
     * broker and an administrator — and capping on it made the bar's budget
     * hostage to a person who does not exist, so a link genuinely useful to
     * buyers competed against one useful only to operators.
     *
     * Six is what the widest real account reaches today — somebody selling one
     * business while buying another sees Browse, My listings, Matches, Deals,
     * Pipeline and Documents. That is the pre-existing worst case, measured
     * rather than assumed; the old cap of seven was set against the four-role
     * fixture and so left a slot nobody had counted.
     *
     * The cap has already earned itself once. Market pulse was added to the bar,
     * took a buyer-seller to seven, and was moved beside the browse page
     * instead — which is where somebody wants market context anyway. Raise this
     * only for a destination people visit constantly, never for one that is
     * merely new.
     */
    for (const roles of [
      ['buyer'],
      ['seller'],
      ['broker'],
      ['admin'],
      ['buyer', 'seller'],
      ['seller', 'broker'],
    ] as const) {
      const links = navLinksFor(actorWith(...roles));
      expect(links.length, `${roles.join('+')} sees ${links.length} links`).toBeLessThanOrEqual(6);
    }
  });

  it('stays inside the bar even for the everything fixture', () => {
    // The absolute ceiling, kept as a backstop. Past this the bar wraps on a
    // laptop and the answer is to move something to the dashboard.
    const links = navLinksFor(actorWith('buyer', 'seller', 'broker', 'admin'));
    expect(links.length).toBeLessThanOrEqual(7);
  });

  it('never offers the same destination twice', () => {
    const links = hrefs(actorWith('buyer', 'seller', 'broker', 'admin'));
    expect(new Set(links).size).toBe(links.length);
  });

  it('links to paths, never to another host', () => {
    for (const link of navLinksFor(actorWith('buyer', 'seller', 'broker', 'admin'))) {
      expect(link.href).toMatch(/^\//);
      expect(link.href).not.toMatch(/^\/[/\\]/);
    }
  });

  it('labels every link', () => {
    for (const link of navLinksFor(actorWith('buyer', 'seller', 'broker', 'admin'))) {
      expect(link.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('unreadBadge', () => {
  it('draws nothing at zero', () => {
    // A badge reading "0" draws the eye to nothing.
    expect(unreadBadge(0)).toBeNull();
  });

  it('draws the number', () => {
    expect(unreadBadge(1)).toBe('1');
    expect(unreadBadge(99)).toBe('99');
  });

  it('stops counting past 99', () => {
    expect(unreadBadge(100)).toBe('99+');
    expect(unreadBadge(5000)).toBe('99+');
  });

  it('survives a negative or a NaN rather than rendering one', () => {
    // `unreadCount()` returns 0 on error, but it reads an RPC result through a
    // Number() — and a header is not the place to find out what that did.
    expect(unreadBadge(-3)).toBeNull();
    expect(unreadBadge(Number.NaN)).toBeNull();
  });
});

describe('unreadLabel', () => {
  it('says the count out loud', () => {
    // The badge is a coloured shape to a screen reader.
    expect(unreadLabel(4)).toBe('Notifications, 4 unread');
  });

  it('says nothing extra when there is nothing', () => {
    expect(unreadLabel(0)).toBe('Notifications');
  });
});

/**
 * The search box in the header.
 *
 * Asserted against the rendered markup rather than a helper, because there is
 * no helper — it is a plain GET form, deliberately, and the thing that can
 * break is the contract between its field name and the page that parses it.
 * Rename either half and search silently starts returning everything.
 */
describe('the header search form', () => {
  it('posts the field name the browse page reads', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./site-header.tsx', import.meta.url), 'utf8'),
    );

    // A GET form: the query string is the state, so the URL stays shareable.
    expect(source).toMatch(/method="get"[\s\S]{0,80}action="\/listings"/);
    expect(source).toContain('name="q"');
    // role="search" is what makes it findable by a screen reader's landmark
    // list, which is how somebody who cannot see the magnifier reaches it.
    expect(source).toContain('role="search"');
  });

  it('offers the agent keys page, which had no link at all', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./site-header.tsx', import.meta.url), 'utf8'),
    );

    // An integration nobody can find is an integration nobody connects. This
    // page existed for three commits reachable only by typing its URL.
    expect(source).toContain('/settings/agents');
    expect(source).toContain('/settings/verification');
  });
});
