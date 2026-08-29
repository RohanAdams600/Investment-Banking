import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  actingAs,
  actingAsAnon,
  applyMigrations,
  connect,
  createAuthUser,
  expectDenied,
  hasDatabase,
} from './helpers';

/**
 * Searching the market, and counting who looked at it.
 *
 * Two features with one thing in common: both are reachable by an anonymous
 * caller, and both would defeat the confidentiality model if they leaked the
 * wrong thing.
 *
 *   - A search index over `legal_name` would let anybody confirm a guess about
 *     which company is for sale by watching which queries return a row. The
 *     index deliberately covers teaser columns only.
 *   - A view counter that stored who viewed would turn browsing a confidential
 *     marketplace into a record of who was interested. It stores nothing about
 *     the viewer at all.
 */
describe.skipIf(!hasDatabase)('search and view counts', () => {
  let db: Client;

  let seller: string;
  let buyer: string;

  let hvac: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'sv-seller@example.com');
    buyer = await createAuthUser(db, 'sv-buyer@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'seller'), ($2,'buyer')`,
      [seller, buyer],
    );
    await db.query(`update public.jurisdictions set is_active = true where code = 'US-NY'`);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings
         (seller_id, headline, summary, industry, jurisdiction_code, status, published_at)
       values
         ($1,'Established HVAC contractor','Residential and commercial heating service contracts.',
          'home_services','US-NY','live', now()),
         ($1,'Specialty coffee roastery','Wholesale roasting for cafes.',
          'restaurants_retail','US-NY','live', now()),
         ($1,'Hidden HVAC draft','Not published yet.',
          'home_services','US-NY','draft', null)
       returning id`,
      [seller],
    );
    hvac = rows[0]!.id;

    await db.query(
      `insert into public.listing_details (listing_id, legal_name, key_customers)
       values ($1, 'Northfield Mechanical Inc', 'Rochester General Hospital')`,
      [hvac],
    );
  });

  beforeEach(async () => {
    await db.query('delete from public.listing_view_days');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ==========================================================================
  // Search
  // ==========================================================================

  it('finds a listing by a word in its headline', async () => {
    const { rows } = await actingAsAnon<{ slug: string }>(
      db,
      `select slug from public.search_market('HVAC')`,
    );
    expect(rows.map((r) => r.slug)).toEqual(['established-hvac-contractor']);
  });

  it('finds one by a phrase in its summary', async () => {
    const { rows } = await actingAsAnon<{ slug: string }>(
      db,
      `select slug from public.search_market('wholesale roasting')`,
    );
    expect(rows[0]!.slug).toBe('specialty-coffee-roastery');
  });

  it('does not search the confidential half', async () => {
    /*
     * The assertion this whole file exists for. `Northfield Mechanical` is the
     * legal name of the HVAC business and sits in `listing_details`. If the
     * index reached it, anybody could confirm which company is for sale by
     * typing a guess and watching whether a row came back — the confidentiality
     * model defeated by an index rather than by a policy.
     */
    const { rowCount } = await actingAsAnon(
      db,
      `select slug from public.search_market('Northfield')`,
    );
    expect(rowCount).toBe(0);

    const customers = await actingAsAnon(
      db,
      `select slug from public.search_market('Rochester General')`,
    );
    expect(customers.rowCount).toBe(0);
  });

  it('does not return drafts', async () => {
    // "Hidden HVAC draft" matches the term and must not surface.
    const { rows } = await actingAsAnon<{ slug: string }>(
      db,
      `select slug from public.search_market('HVAC')`,
    );
    expect(rows.map((r) => r.slug)).not.toContain('hidden-hvac-draft');
  });

  it('ranks rather than returning physical order', async () => {
    const { rows } = await actingAsAnon<{ rank: number }>(
      db,
      `select rank from public.search_market('HVAC contractor')`,
    );
    expect(rows[0]!.rank).toBeGreaterThan(0);
  });

  it('returns nothing for nonsense rather than erroring', async () => {
    const { rowCount } = await actingAsAnon(
      db,
      `select slug from public.search_market('zzzzqqq nonexistent')`,
    );
    expect(rowCount).toBe(0);
  });

  it('survives punctuation a person would actually type', async () => {
    // websearch_to_tsquery, not to_tsquery: a quote or a stray operator in a
    // search box must not raise a syntax error at the database.
    for (const term of ['"heating"', 'HVAC OR coffee', 'a -b', "don't"]) {
      await expect(
        actingAsAnon(db, `select slug from public.search_market($1)`, [term]),
      ).resolves.toBeDefined();
    }
  });

  it('caps how much one query can ask for', async () => {
    // Otherwise a caller sets max_rows to a million and the function is a way
    // to make the database do arbitrary work.
    const { rows } = await db.query<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'search_market'`,
    );
    expect(rows[0]!.src).toMatch(/least\(greatest\(/);
  });

  // ==========================================================================
  // View counts
  // ==========================================================================

  it('counts a view from an anonymous visitor', async () => {
    await actingAsAnon(db, `select public.record_listing_view('established-hvac-contractor')`);
    await actingAsAnon(db, `select public.record_listing_view('established-hvac-contractor')`);

    const { rows } = await db.query<{ views: number }>(
      `select views from public.listing_view_days`,
    );
    expect(rows[0]!.views).toBe(2);
  });

  it('ignores an unknown slug silently', async () => {
    // A crawler on a withdrawn listing should get a page, not a 500 — and an
    // error would let a caller enumerate which slugs exist.
    await expect(
      actingAsAnon(db, `select public.record_listing_view('no-such-thing')`),
    ).resolves.toBeDefined();

    const { rowCount } = await db.query('select 1 from public.listing_view_days');
    expect(rowCount).toBe(0);
  });

  it('will not count a view of a draft', async () => {
    await actingAsAnon(db, `select public.record_listing_view('hidden-hvac-draft')`);
    const { rowCount } = await db.query('select 1 from public.listing_view_days');
    expect(rowCount).toBe(0);
  });

  it('stores nothing about who looked', async () => {
    /*
     * Three columns, none of them a person. Not a hashed IP, not a cookie, not
     * a user id — browsing a marketplace for confidential deals should not
     * create a record of who was interested, and a hashed IP is still personal
     * data in several places this will operate.
     */
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'listing_view_days' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(['listing_id', 'day', 'views']);
  });

  it('shows the seller their own count', async () => {
    await actingAsAnon(db, `select public.record_listing_view('established-hvac-contractor')`);

    const { rows } = await actingAs<{ last_30_days: string }>(
      db,
      seller,
      `select last_30_days from public.listing_view_summary($1)`,
      [hvac],
    );
    expect(Number(rows[0]!.last_30_days)).toBe(1);
  });

  it('shows a buyer zeroes rather than refusing', async () => {
    /*
     * Zeroes, deliberately. A refusal would confirm that somebody had looked;
     * zero is the same answer a listing nobody has viewed gives, so it tells a
     * buyer nothing either way. How much attention a business is getting is a
     * fact about the seller's position and a buyer would negotiate with it.
     */
    await actingAsAnon(db, `select public.record_listing_view('established-hvac-contractor')`);

    const { rows } = await actingAs<{ last_30_days: string }>(
      db,
      buyer,
      `select last_30_days from public.listing_view_summary($1)`,
      [hvac],
    );
    expect(Number(rows[0]!.last_30_days)).toBe(0);
  });

  it('does not let a client write the tally directly', async () => {
    // There is no insert or update policy at all; the definer function is the
    // only way a row moves. Otherwise a seller inflates their own numbers.
    await expectDenied(() =>
      actingAs(
        db,
        seller,
        `insert into public.listing_view_days (listing_id, views) values ($1, 9999)`,
        [hvac],
      ),
    );
  });

  it('keeps the tally out of a visitor reach entirely', async () => {
    await expectDenied(() => actingAsAnon(db, 'select views from public.listing_view_days'));
  });
});
