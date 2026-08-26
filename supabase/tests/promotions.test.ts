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
 * Paid placement at the top of the market.
 *
 * Two rules carry this file, and the first is not a product decision:
 *
 *   1. **A buyer can always see that a listing was promoted.** The disclosure is
 *      the legal obligation attached to selling ranking, so the policy makes the
 *      fact readable to whoever can read the listing. A label that depends on
 *      the application choosing a privileged path is a label that gets lost.
 *   2. **Only an operator sells one.** A seller who could insert here would put
 *      themselves at the top of the market for free, which is the whole failure
 *      mode of the feature.
 *
 * Nothing here claims compliance with any advertising rule. It asserts that the
 * mechanism disclosure needs is present and hard to remove.
 */
describe.skipIf(!hasDatabase)('listing promotions', () => {
  let db: Client;

  let seller: string;
  let buyer: string;
  let admin: string;
  let otherAdmin: string;

  let liveListing: string;
  let draftListing: string;

  async function makeListing(owner: string, headline: string, status: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings
         (seller_id, headline, industry, jurisdiction_code, status, published_at)
       values ($1, $2, 'home_services', 'US-NY', $3::text::app.listing_status,
               case when $3::text = 'draft' then null else now() end)
       returning id`,
      [owner, headline, status],
    );
    return rows[0]!.id;
  }

  /** A promotion running right now, inserted by the operator who sold it. */
  async function promote(listing: string, by: string, rank = 10) {
    return actingAs(
      db,
      by,
      `insert into public.listing_promotions (listing_id, granted_by, ends_at, rank, amount_cents)
       values ($1, $2, now() + interval '30 days', $3, 49900)`,
      [listing, by, rank],
    );
  }

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'promo-seller@example.com');
    buyer = await createAuthUser(db, 'promo-buyer@example.com');
    admin = await createAuthUser(db, 'promo-admin@example.com');
    otherAdmin = await createAuthUser(db, 'promo-admin-2@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values
         ($1,'seller'), ($2,'buyer'), ($3,'admin'), ($4,'admin')`,
      [seller, buyer, admin, otherAdmin],
    );

    await db.query(`update public.jurisdictions set is_active = true where code = 'US-NY'`);

    liveListing = await makeListing(seller, 'Established HVAC contractor', 'live');
    draftListing = await makeListing(seller, 'Specialty coffee roaster', 'draft');
  });

  beforeEach(async () => {
    await db.query('delete from public.listing_promotions');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ==========================================================================
  // Who may sell one
  // ==========================================================================

  it('lets an operator sell a placement', async () => {
    const result = await promote(liveListing, admin);
    expect(result.rowCount).toBe(1);
  });

  it('refuses a seller promoting their own listing', async () => {
    // The failure mode the whole policy exists for. A seller with insert rights
    // here is a seller who never has to pay for the position.
    await expectDenied(() => promote(liveListing, seller));
  });

  it('refuses a buyer promoting anything', async () => {
    await expectDenied(() => promote(liveListing, buyer));
  });

  it('refuses an operator recording the sale against somebody else', async () => {
    // `granted_by = auth.uid()` in the policy. Selling placement is an act, and
    // the ledger says who performed it.
    await expectDenied(() =>
      actingAs(
        db,
        admin,
        `insert into public.listing_promotions (listing_id, granted_by, ends_at)
         values ($1, $2, now() + interval '30 days')`,
        [liveListing, otherAdmin],
      ),
    );
  });

  // ==========================================================================
  // The disclosure
  // ==========================================================================

  it('lets a buyer see that a live listing is promoted', async () => {
    /*
     * The single most important assertion in this file. The label a buyer reads
     * is rendered from this row; if the policy hid it, the disclosure would
     * depend on the application remembering to fetch it another way.
     */
    await promote(liveListing, admin);

    const seen = await actingAs(
      db,
      buyer,
      `select rank from public.listing_promotions where listing_id = $1`,
      [liveListing],
    );
    expect(seen.rowCount).toBe(1);
  });

  it('does not leak a promotion on a listing that is not on the market', async () => {
    // A draft is invisible; so is the fact that its owner bought a placement for
    // when it goes live.
    await promote(draftListing, admin);

    const seen = await actingAs(
      db,
      buyer,
      `select rank from public.listing_promotions where listing_id = $1`,
      [draftListing],
    );
    expect(seen.rowCount).toBe(0);
  });

  it('tells a seller their own draft listing is promoted', async () => {
    await promote(draftListing, admin);

    const seen = await actingAs(
      db,
      seller,
      `select rank from public.listing_promotions where listing_id = $1`,
      [draftListing],
    );
    expect(seen.rowCount).toBe(1);
  });

  it('shows a visitor nothing at all', async () => {
    await promote(liveListing, admin);
    await expectDenied(() => actingAsAnon(db, `select rank from public.listing_promotions`));
  });

  // ==========================================================================
  // A promotion is a record
  // ==========================================================================

  it('allows cancellation', async () => {
    await promote(liveListing, admin);

    const updated = await actingAs(
      db,
      admin,
      `update public.listing_promotions set cancelled_at = now() where listing_id = $1`,
      [liveListing],
    );
    expect(updated.rowCount).toBe(1);
  });

  it('refuses to rewrite the price after the fact', async () => {
    // Otherwise the ledger is a draft. What was sold, and for how much, is the
    // thing this table exists to remember.
    await promote(liveListing, admin);

    await expect(
      actingAs(
        db,
        admin,
        `update public.listing_promotions set amount_cents = 1 where listing_id = $1`,
        [liveListing],
      ),
    ).rejects.toThrow(/only be cancelled/i);
  });

  it('refuses to extend the window after the fact', async () => {
    await promote(liveListing, admin);

    await expect(
      actingAs(
        db,
        admin,
        `update public.listing_promotions set ends_at = now() + interval '900 days'
          where listing_id = $1`,
        [liveListing],
      ),
    ).rejects.toThrow(/only be cancelled/i);
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(
      actingAs(
        db,
        admin,
        `insert into public.listing_promotions (listing_id, granted_by, starts_at, ends_at)
         values ($1, $2, now(), now() - interval '1 day')`,
        [liveListing, admin],
      ),
    ).rejects.toThrow(/listing_promotions_window/i);
  });

  // ==========================================================================
  // What "promoted right now" means
  // ==========================================================================

  it('reports the rank while the window is open', async () => {
    await promote(liveListing, admin, 42);

    const { rows } = await actingAs(db, buyer, `select public.active_promotion_rank($1) as rank`, [
      liveListing,
    ]);
    expect(rows[0]!.rank).toBe(42);
  });

  it('reports nothing once cancelled', async () => {
    await promote(liveListing, admin, 42);
    await actingAs(db, admin, `update public.listing_promotions set cancelled_at = now()`);

    const { rows } = await actingAs(db, buyer, `select public.active_promotion_rank($1) as rank`, [
      liveListing,
    ]);
    expect(rows[0]!.rank).toBeNull();
  });

  it('reports nothing before the window opens', async () => {
    await actingAs(
      db,
      admin,
      `insert into public.listing_promotions (listing_id, granted_by, starts_at, ends_at, rank)
       values ($1, $2, now() + interval '5 days', now() + interval '35 days', 42)`,
      [liveListing, admin],
    );

    const { rows } = await actingAs(db, buyer, `select public.active_promotion_rank($1) as rank`, [
      liveListing,
    ]);
    expect(rows[0]!.rank).toBeNull();
  });

  it('reports nothing for a listing nobody paid for', async () => {
    const { rows } = await actingAs(db, buyer, `select public.active_promotion_rank($1) as rank`, [
      liveListing,
    ]);
    expect(rows[0]!.rank).toBeNull();
  });
});
