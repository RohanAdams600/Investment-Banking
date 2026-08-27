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
 * The one table an anonymous visitor may write to.
 *
 * That is deliberate and it is the whole point: the purpose is to capture
 * somebody at the moment they are curious, which is before they will make a
 * password. Requiring an account first defeats it.
 *
 * So the questions here are not "who may call this" but "what can somebody do
 * with an insert grant and no session". The answer has to be: add one row, learn
 * nothing, and be unable to tell whether it worked in a way that reveals
 * anything about anybody else.
 */
describe.skipIf(!hasDatabase)('market interest', () => {
  let db: Client;

  let visitor: string;
  let admin: string;

  const add = (
    actor: string | null,
    email: string,
    side = 'buying',
    userId: string | null = null,
  ) => {
    const sql = `insert into public.market_interest (email, side, user_id)
                 values ($1, $2::app.interest_side, $3)`;
    const params = [email, side, userId];
    return actor === null ? actingAsAnon(db, sql, params) : actingAs(db, actor, sql, params);
  };

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    visitor = await createAuthUser(db, 'curious@example.com');
    admin = await createAuthUser(db, 'interest-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'buyer'), ($2,'admin')`,
      [visitor, admin],
    );
  });

  beforeEach(async () => {
    await db.query('delete from public.market_interest');
    await db.query('delete from public.listings');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ==========================================================================
  // Anyone may add themselves
  // ==========================================================================

  it('accepts a visitor with no account', async () => {
    const result = await add(null, 'owner@hvac.example');
    expect(result.rowCount).toBe(1);
  });

  it('accepts a signed-in person attaching their own id', async () => {
    const result = await add(visitor, 'curious@example.com', 'buying', visitor);
    expect(result.rowCount).toBe(1);
  });

  it("refuses a row attached to somebody else's account", async () => {
    // The only thing the insert policy actually checks, and the only thing worth
    // checking: an anonymous row is fine, a row claiming to be another user is not.
    await expectDenied(() => add(visitor, 'spoof@example.com', 'buying', admin));
  });

  it('refuses a malformed address', async () => {
    await expect(add(null, 'not-an-email')).rejects.toThrow();
  });

  it('treats a repeat as the same person, not a new lead', async () => {
    await add(null, 'owner@hvac.example');
    await expect(add(null, 'owner@hvac.example')).rejects.toThrow(/duplicate key/i);
  });

  it('lets one person register on both sides', async () => {
    // A broker who also buys is two interests, not a conflict.
    await add(null, 'both@example.com', 'buying');
    const second = await add(null, 'both@example.com', 'selling');
    expect(second.rowCount).toBe(1);
  });

  it('matches addresses case-insensitively', async () => {
    // citext. Otherwise Owner@ and owner@ are two rows and both get emailed.
    await add(null, 'Owner@Hvac.Example');
    await expect(add(null, 'owner@hvac.example')).rejects.toThrow(/duplicate key/i);
  });

  // ==========================================================================
  // Nobody may read it back
  // ==========================================================================

  it('shows a visitor nothing', async () => {
    /*
     * The security design in one assertion. A write-only table cannot be
     * harvested and cannot confirm whether an address is already present, which
     * is what makes the anonymous insert grant safe to hand out.
     */
    await add(null, 'owner@hvac.example');
    await expectDenied(() => actingAsAnon(db, 'select email from public.market_interest'));
  });

  it('shows an ordinary signed-in user nothing', async () => {
    await add(null, 'owner@hvac.example');
    const seen = await actingAs(db, visitor, 'select email from public.market_interest');
    expect(seen.rowCount).toBe(0);
  });

  it('does not even show somebody their own row', async () => {
    // Tempting to allow and wrong: "select where user_id = auth.uid()" is a
    // read path, and a read path is the thing this table does not have.
    await add(visitor, 'curious@example.com', 'buying', visitor);
    const seen = await actingAs(db, visitor, 'select email from public.market_interest');
    expect(seen.rowCount).toBe(0);
  });

  it('shows an operator the list', async () => {
    await add(null, 'owner@hvac.example');
    const seen = await actingAs(db, admin, 'select email from public.market_interest');
    expect(seen.rowCount).toBe(1);
  });

  // ==========================================================================
  // Whether the market is open
  // ==========================================================================

  it('reports the market closed with nothing on the board', async () => {
    const { rows } = await actingAsAnon<{ open: boolean }>(
      db,
      'select public.market_is_open() as open',
    );
    expect(rows[0]!.open).toBe(false);
  });

  it('reports it open once a listing is live', async () => {
    const seller = await createAuthUser(db, `seller-${Date.now()}@example.com`);
    await db.query(
      `insert into public.listings (seller_id, headline, industry, jurisdiction_code, status, published_at)
       values ($1, 'Established HVAC contractor', 'home_services', 'US-NY', 'live', now())`,
      [seller],
    );

    const { rows } = await actingAsAnon<{ open: boolean }>(
      db,
      'select public.market_is_open() as open',
    );
    expect(rows[0]!.open).toBe(true);
  });

  it('does not count a draft as inventory', async () => {
    // A seller working on a listing is not a market. Getting this wrong shows an
    // empty board to the next visitor, which is the exact failure being avoided.
    const seller = await createAuthUser(db, `draft-seller-${Date.now()}@example.com`);
    await db.query(
      `insert into public.listings (seller_id, headline, industry, jurisdiction_code, status)
       values ($1, 'Specialty coffee roaster', 'restaurants_retail', 'US-NY', 'draft')`,
      [seller],
    );

    const { rows } = await actingAsAnon<{ open: boolean }>(
      db,
      'select public.market_is_open() as open',
    );
    expect(rows[0]!.open).toBe(false);
  });

  it('answers a boolean and never a count', async () => {
    /*
     * How many listings exist is a fact about the operator's business, not the
     * visitor's. A count here would eventually be rendered as "3 businesses
     * available", which is a marketing claim this platform does not make.
     */
    const { rows } = await db.query<{ t: string }>(
      `select pg_get_function_result(p.oid) as t
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'market_is_open'`,
    );
    expect(rows[0]!.t).toBe('boolean');
  });

  it('keeps the operator counts away from clients', async () => {
    await expectDenied(() => actingAsAnon(db, 'select * from public.interest_counts()'));
    await expectDenied(() => actingAs(db, admin, 'select * from public.interest_counts()'));
  });
});
