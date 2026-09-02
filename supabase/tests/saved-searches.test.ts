import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { actingAs, actingAsAnon, applyMigrations, connect, createAuthUser, hasDatabase } from './helpers';

/**
 * Saved searches, and the two things that must never be true of them.
 *
 * A saved search is a statement about what somebody intends to buy. A list of
 * them across the user base is a map of where demand is, so the first rule is
 * that nobody reads anybody else's — not another buyer, not an admin, not the
 * anonymous role.
 *
 * The second is subtler and is the reason `saved_search_matches` reads the
 * teaser view rather than the table. A filter that could reach a confidential
 * column would leak it one bit at a time: save "earning at least $1m", see
 * whether the alert fires, and you have learned something about a business
 * whose seller published only a band. The test for that is not "does the
 * function hide the column" — it is "can the function see the column at all".
 */
describe.skipIf(!hasDatabase)('saved searches', () => {
  let db: Client;

  let buyer: string;
  let otherBuyer: string;
  let admin: string;
  let seller: string;

  let hvacSearch: string;
  let everythingSearch: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    buyer = await createAuthUser(db, 'saved-buyer@example.com');
    otherBuyer = await createAuthUser(db, 'saved-other@example.com');
    admin = await createAuthUser(db, 'saved-admin@example.com');
    seller = await createAuthUser(db, 'saved-seller@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'buyer'), ($2,'buyer'), ($3,'admin'), ($4,'seller')`,
      [buyer, otherBuyer, admin, seller],
    );
    await db.query(`update public.jurisdictions set is_active = true where code in ('US-NY','US-OH')`);

    // Two live listings a search could match, and one that stays a draft.
    await db.query(
      `insert into public.listings
         (seller_id, headline, summary, industry, jurisdiction_code, status, published_at,
          earnings_band_low_cents, earnings_band_high_cents,
          asking_price_band_low_cents, asking_price_band_high_cents)
       values
         ($1, 'Established HVAC contractor', 'Residential heating and cooling.',
          'home_services', 'US-OH', 'live', now(), 40000000, 80000000, 200000000, 300000000),
         ($1, 'Precision machine shop', 'Contract machining for aerospace.',
          'manufacturing', 'US-NY', 'live', now(), 90000000, 150000000, 500000000, 700000000),
         ($1, 'Secret bakery', 'Not yet on the market.',
          'home_services', 'US-OH', 'draft', null, 10000000, 20000000, 50000000, 60000000)`,
      [seller],
    );

    const saved = await actingAs<{ id: string }>(
      db,
      buyer,
      `insert into public.saved_searches (user_id, label, q, industry, jurisdiction_code, min_earnings_cents)
       values ($1, 'Ohio HVAC', 'heating', 'home_services', 'US-OH', 30000000)
       returning id`,
      [buyer],
    );
    hvacSearch = saved.rows[0]!.id;

    const anything = await actingAs<{ id: string }>(
      db,
      buyer,
      `insert into public.saved_searches (user_id, label) values ($1, 'Anything at all') returning id`,
      [buyer],
    );
    everythingSearch = anything.rows[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
  });

  describe('who can read one', () => {
    it('shows a buyer their own', async () => {
      const { rows } = await actingAs(db, buyer, `select id, label from public.saved_searches`);
      expect(rows.map((r) => r.label).sort()).toEqual(['Anything at all', 'Ohio HVAC']);
    });

    it('hides them from another buyer', async () => {
      const { rowCount } = await actingAs(db, otherBuyer, `select id from public.saved_searches`);
      expect(rowCount).toBe(0);
    });

    it('hides them from an admin', async () => {
      /*
       * Deliberate, and worth stating as a test rather than as a comment: there
       * is no support case that needs to read what a buyer is hunting for, and
       * an operator who can read it can trade on it. Every other table in this
       * schema has an admin path; this one does not.
       */
      const { rowCount } = await actingAs(db, admin, `select id from public.saved_searches`);
      expect(rowCount).toBe(0);
    });

    it('is unreachable anonymously', async () => {
      await expect(actingAsAnon(db, `select id from public.saved_searches`)).rejects.toThrow();
    });
  });

  describe('who can write one', () => {
    it('refuses a search saved on somebody else’s behalf', async () => {
      await expect(
        actingAs(
          db,
          otherBuyer,
          `insert into public.saved_searches (user_id, label) values ($1, 'Planted')`,
          [buyer],
        ),
      ).rejects.toThrow();
    });

    it('refuses to reassign an existing search to someone else', async () => {
      // The `with check` half. Without it a buyer could hand a search to another
      // account — or take one — by updating the owning column.
      await expect(
        actingAs(db, buyer, `update public.saved_searches set user_id = $1 where id = $2`, [
          otherBuyer,
          hvacSearch,
        ]),
      ).rejects.toThrow();
    });

    it('refuses a second search with the same name', async () => {
      await expect(
        actingAs(
          db,
          buyer,
          `insert into public.saved_searches (user_id, label) values ($1, 'Ohio HVAC')`,
          [buyer],
        ),
      ).rejects.toThrow();
    });

    it('lets a buyer delete their own', async () => {
      const { rows } = await actingAs<{ id: string }>(
        db,
        otherBuyer,
        `insert into public.saved_searches (user_id, label) values ($1, 'Temporary') returning id`,
        [otherBuyer],
      );
      const { rowCount } = await actingAs(db, otherBuyer, `delete from public.saved_searches where id = $1`, [
        rows[0]!.id,
      ]);
      expect(rowCount).toBe(1);
    });
  });

  describe('what a search matches', () => {
    it('finds the listing it describes and not the other one', async () => {
      const { rows } = await actingAs<{ headline: string }>(
        db,
        buyer,
        `select headline from public.saved_search_matches($1)`,
        [hvacSearch],
      );
      expect(rows.map((r) => r.headline)).toEqual(['Established HVAC contractor']);
    });

    it('never returns a listing that is not live', async () => {
      // The draft matches the industry, the state and the earnings floor. It is
      // absent because the function reads `market_listings`, which is live-only.
      const { rows } = await actingAs<{ headline: string }>(
        db,
        buyer,
        `select headline from public.saved_search_matches($1)`,
        [everythingSearch],
      );
      expect(rows.map((r) => r.headline)).not.toContain('Secret bakery');
      expect(rows).toHaveLength(2);
    });

    it('returns nothing for somebody else’s search', async () => {
      /*
       * The function is `security definer`, so it runs with the owner's rights
       * and its own `where` clause is the whole access check. If that clause
       * were ever dropped, this is what would catch it — and what it would
       * expose is not a listing but the fact that a specific person is hunting
       * for one.
       */
      const { rowCount } = await actingAs(
        db,
        otherBuyer,
        `select * from public.saved_search_matches($1)`,
        [hvacSearch],
      );
      expect(rowCount).toBe(0);
    });

    it('honours the since cursor so an alert does not repeat itself', async () => {
      const { rowCount } = await actingAs(
        db,
        buyer,
        `select * from public.saved_search_matches($1, now())`,
        [everythingSearch],
      );
      expect(rowCount).toBe(0);
    });

    it('cannot return a confidential column, because it cannot see one', async () => {
      /*
       * The structural assertion.
       *
       * Not "does it hide the company name" — that would pass for a function
       * that selects around it and would keep passing right up until somebody
       * adds a column to the returns clause. This asserts the function's whole
       * output shape against the teaser vocabulary, so widening it fails here
       * rather than in production.
       */
      const { rows } = await db.query<{ name: string }>(
        `select unnest(proargnames[4:]) as name
           from pg_proc where proname = 'saved_search_matches'`,
      );
      expect(rows.map((r) => r.name).sort()).toEqual([
        'headline',
        'industry',
        'jurisdiction_name',
        'published_at',
        'slug',
      ]);
    });
  });
});
