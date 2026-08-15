import { describe, expect, it } from 'vitest';

import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_KINDS,
  notificationCopy,
  notificationHref,
} from './messages';

/**
 * The tests that matter here are the negative ones.
 *
 * A notification is a candidate for an email, and email is not a confidential
 * channel — it sits unencrypted on a mail server, gets forwarded, and is read on
 * a phone on a train. So most of this file asserts what the copy *cannot*
 * contain, and the assertions are structural rather than a list of banned words:
 * a message with no interpolation slot cannot leak through one.
 */

describe('notificationCopy', () => {
  it('has copy for every kind', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const copy = notificationCopy(kind);
      expect(copy.title.length, kind).toBeGreaterThan(0);
    }
  });

  it('never carries anything but a count', () => {
    // The structural version of "no confidential data". The function's only
    // input besides the kind is a number, so there is nowhere for a name, an
    // amount or a headline to enter — a template that could hold one would need
    // a parameter, and there is not one.
    for (const kind of NOTIFICATION_KINDS) {
      const plain = notificationCopy(kind);
      const withCount = notificationCopy(kind, { count: 7 });

      const differs = plain.title !== withCount.title || plain.body !== withCount.body;
      if (differs) {
        // The only thing that may vary is the number itself.
        expect(`${withCount.title} ${withCount.body}`).toContain('7');
      }
    }
  });

  it('leaves an unfilled template nowhere to hide', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const copy = notificationCopy(kind, { count: 3 });
      const text = `${copy.title} ${copy.body ?? ''}`;

      expect(text, kind).not.toMatch(/\$\{|\{\{|%s|undefined|null/);
    }
  });

  it('does not preview a message body', () => {
    // The most tempting one and the worst. A deal room message can contain a
    // price, a name, or a term somebody is still negotiating.
    const copy = notificationCopy('message_received');
    expect(copy.body).toMatch(/open the deal room/i);
    expect(copy.body).not.toMatch(/said|wrote|:/);
  });

  it('does not repeat a reviewer’s reason', () => {
    // The reason lives on the listing, behind the session. An email saying "the
    // headline names the business" says the quiet part in a channel that is not
    // private.
    const copy = notificationCopy('listing_returned');
    expect(copy.body).toMatch(/open it to see/i);
  });

  it('reads as something a person would say', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const copy = notificationCopy(kind);
      // No enum names, no snake_case, no internal vocabulary leaking into a
      // subject line.
      expect(copy.title, kind).not.toMatch(/_/);
      expect(copy.title, kind).not.toMatch(/^[a-z]/);
    }
  });

  it('pluralises rather than saying "1 matches"', () => {
    expect(notificationCopy('new_match', { count: 1 }).title).toBe('A new match');
    expect(notificationCopy('new_match', { count: 4 }).title).toBe('4 new matches');
    expect(notificationCopy('new_match', { count: 1 }).body).toMatch(/1 buyer is/);
    expect(notificationCopy('new_match', { count: 4 }).body).toMatch(/4 buyers are/);
  });
});

describe('notificationHref', () => {
  it('always returns a path, never a URL', () => {
    // An absolute URL stored in a row is how a notification written on staging
    // links a customer to staging six months later.
    for (const kind of NOTIFICATION_KINDS) {
      const href = notificationHref(kind, '11111111-1111-4111-8111-111111111111');
      expect(href, kind).toMatch(/^\//);
      expect(href, kind).not.toMatch(/^https?:/);
      // `//evil.example` and `/\evil.example` both start with a slash and both
      // send a browser to another host. The database refuses them too; this is
      // the same rule stated where the paths are actually built.
      expect(href, kind).not.toMatch(/^\/[/\\]/);
    }
  });

  it('still points somewhere useful with no entity', () => {
    // A notification outlives the row it points at — "your listing was
    // withdrawn" has to survive the withdrawal — so a missing id must not
    // produce `/listings/undefined`.
    for (const kind of NOTIFICATION_KINDS) {
      const href = notificationHref(kind, null);
      expect(href, kind).not.toMatch(/undefined|null/);
      expect(href.length, kind).toBeGreaterThan(1);
    }
  });
});

describe('categories', () => {
  it('assigns every kind to exactly one category', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_CATEGORY[kind], kind).toBeTruthy();
    }
  });

  it('groups the way a user thinks rather than the way the code is organised', () => {
    // A seller turning off deal emails means all of it — NDAs, documents, the
    // lot — not just the ones that happen to share a prefix.
    expect(NOTIFICATION_CATEGORY.nda_requested).toBe('deal_activity');
    expect(NOTIFICATION_CATEGORY.document_opened).toBe('deal_activity');
    expect(NOTIFICATION_CATEGORY.task_due).toBe('deal_activity');
  });

  it('labels and explains every category', () => {
    for (const category of Object.values(NOTIFICATION_CATEGORY)) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
      expect(CATEGORY_HINTS[category]).toBeTruthy();
    }
  });
});
