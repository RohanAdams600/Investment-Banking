import { describe, expect, it } from 'vitest';

import {
  MAX_SAVED_SEARCHES,
  describeSearch,
  isDue,
  matchesEverything,
  validateSavedSearch,
  type SearchFilters,
} from './saved-search';

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;
const empty = { existingCount: 0, existingLabels: [] as string[] };

describe('validateSavedSearch', () => {
  it('accepts a search with a name and nothing else', () => {
    // The empty search is legitimate — see `matchesEverything`. Rejecting it
    // would be the platform deciding a buyer in a thin market is wrong about
    // wanting to hear about everything.
    expect(validateSavedSearch({ label: 'Anything', filters: {} }, empty)).toEqual([]);
  });

  it('reports every problem at once rather than the first', () => {
    const problems = validateSavedSearch(
      { label: '', filters: { minEarningsCents: -1, maxAskingCents: 1.5 } },
      empty,
    );
    expect(problems.map((p) => p.field).sort()).toEqual([
      'label',
      'maxAskingCents',
      'minEarningsCents',
    ]);
  });

  it('refuses a duplicate name regardless of case', () => {
    // The database's unique constraint is case-sensitive, so this is the only
    // thing standing between a buyer and two identical emails.
    const problems = validateSavedSearch(
      { label: 'ohio machine shops', filters: {} },
      { existingCount: 1, existingLabels: ['Ohio Machine Shops'] },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe('label');
  });

  it('caps how many a person may keep', () => {
    const problems = validateSavedSearch(
      { label: 'One more', filters: {} },
      { existingCount: MAX_SAVED_SEARCHES, existingLabels: [] },
    );
    expect(problems.map((p) => p.field)).toContain('count');
  });

  it('rejects a fractional amount', () => {
    // Cents are integers. A float here means somebody multiplied by 100 in
    // JavaScript and got 199999.99999999997, which the database would then
    // refuse in a way nobody could read.
    const problems = validateSavedSearch(
      { label: 'x', filters: { maxAskingCents: 2_000_000.5 } },
      empty,
    );
    expect(problems[0]?.message).toMatch(/whole number/);
  });
});

describe('matchesEverything', () => {
  it('is true for no filters and for blank ones', () => {
    expect(matchesEverything({})).toBe(true);
    expect(matchesEverything({ q: '   ', industry: '', jurisdictionCode: null })).toBe(true);
  });

  it('is false as soon as one axis is constrained', () => {
    expect(matchesEverything({ maxAskingCents: 0 })).toBe(false);
    expect(matchesEverything({ q: 'hvac' })).toBe(false);
  });

  it('treats a zero floor as a real constraint', () => {
    // `0` is falsy and `minEarningsCents: 0` means "earning at least nothing",
    // which is a filter a buyer set deliberately to exclude listings that
    // published no earnings band. A truthiness check here would silently drop
    // it and widen their search.
    expect(matchesEverything({ minEarningsCents: 0 })).toBe(false);
  });
});

describe('describeSearch', () => {
  it('says so plainly when a search matches the whole market', () => {
    expect(describeSearch({}, { money })).toBe('Every new listing on the market.');
  });

  it('reads back as a sentence a person can check', () => {
    const filters: SearchFilters = {
      industry: 'home_services',
      jurisdictionCode: 'US-OH',
      minEarningsCents: 50_000_000,
      maxAskingCents: 200_000_000,
    };

    expect(
      describeSearch(filters, {
        money,
        industry: () => 'Home services',
        jurisdiction: () => 'Ohio',
      }),
    ).toBe('Home services, in Ohio, earning $500,000 or more, asking $2,000,000 or less.');
  });

  it('quotes the search term so it is obvious which words were searched', () => {
    expect(describeSearch({ q: 'machine shop' }, { money })).toContain('“machine shop”');
  });

  it('falls back to the raw key when no label function is given', () => {
    expect(describeSearch({ industry: 'manufacturing' }, { money })).toBe('Manufacturing.');
  });
});

describe('isDue', () => {
  const now = new Date('2026-03-10T09:00:00Z');

  it('never sends for a search that is switched off', () => {
    expect(isDue({ frequency: 'off', lastNotifiedAt: null }, now)).toBe(false);
  });

  it('sends immediately the first time', () => {
    // The first email is the one that proves the feature works. Holding it back
    // to fit a schedule is how a buyer concludes it is broken.
    expect(isDue({ frequency: 'weekly', lastNotifiedAt: null }, now)).toBe(true);
  });

  it('tolerates scheduler drift rather than slipping a day', () => {
    /*
     * The bug this exists to prevent: a daily search that sent at 09:00:04
     * yesterday is not due at 09:00:01 today under a strict 24-hour test, so it
     * waits for tomorrow's run and the buyer quietly gets six emails a week.
     */
    const yesterdayPlusABit = new Date('2026-03-09T09:00:04Z');
    expect(isDue({ frequency: 'daily', lastNotifiedAt: yesterdayPlusABit }, now)).toBe(true);
  });

  it('does not send twice in one day', () => {
    const thisMorning = new Date('2026-03-10T02:00:00Z');
    expect(isDue({ frequency: 'daily', lastNotifiedAt: thisMorning }, now)).toBe(false);
  });

  it('holds a weekly search for a week', () => {
    expect(
      isDue({ frequency: 'weekly', lastNotifiedAt: new Date('2026-03-08T09:00:00Z') }, now),
    ).toBe(false);
    expect(
      isDue({ frequency: 'weekly', lastNotifiedAt: new Date('2026-03-03T08:00:00Z') }, now),
    ).toBe(true);
  });
});
