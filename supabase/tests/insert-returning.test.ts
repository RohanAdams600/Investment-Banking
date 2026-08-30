import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { actingAs, applyMigrations, connect, createAuthUser, hasDatabase } from './helpers';

/**
 * `INSERT ... RETURNING`, which is what every write in this application is.
 *
 * ## The rule that broke listing creation
 *
 * When an INSERT carries a RETURNING clause, Postgres applies the table's
 * **SELECT** policy to the new row as an additional WITH CHECK — handing back a
 * row you would not be allowed to read would be a disclosure. So a write path
 * silently depends on the read policy, and only when RETURNING is present.
 *
 * `listings_select_discoverable` used to answer "do you control this?" by
 * calling `app.controls_listing(id)`, which looks the listing up in
 * `public.listings`. That function is STABLE, so it runs against the snapshot
 * from the start of the statement — before the row being inserted existed. It
 * returned false, and every attempt to create a listing was refused with "new
 * row violates row-level security policy".
 *
 * ## Why the existing suite missed it
 *
 * `listings-rls.test.ts` builds its fixtures with a plain INSERT and reads the
 * id back in a second statement. That is not what the product does:
 * `createListing` calls `.insert(...).select('id').single()`, which PostgREST
 * sends as INSERT ... RETURNING. The tests exercised the policy through a path
 * the application never takes, so they passed while the most important write in
 * the marketplace was refused.
 *
 * Every test here therefore uses RETURNING, deliberately.
 */
describe.skipIf(!hasDatabase)('insert ... returning', () => {
  let db: Client;
  let seller: string;
  let otherSeller: string;
  let buyer: string;

  const HEADLINE = 'Established HVAC contractor with a recurring service base';

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'ret-seller@example.com');
    otherSeller = await createAuthUser(db, 'ret-seller-2@example.com');
    buyer = await createAuthUser(db, 'ret-buyer@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'seller'), ($2,'seller'), ($3,'buyer')`,
      [seller, otherSeller, buyer],
    );
    await db.query(`update public.jurisdictions set is_active = true where code = 'US-NY'`);
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Exactly what `createListing` issues. */
  function createListing(as: string, headline: string) {
    return actingAs<{ id: string }>(
      db,
      as,
      `insert into public.listings
         (seller_id, headline, industry, jurisdiction_code, deal_structure, real_estate_included, status)
       values ($1, $2, 'home_services', 'US-NY', 'asset', false, 'draft')
       returning id`,
      [as, headline],
    );
  }

  it('lets a seller create a listing and read its id back', async () => {
    // The regression. Before 0039 this raised 42501 and nobody could list a
    // business at all.
    const result = await createListing(seller, HEADLINE);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.id).toBeTruthy();
  });

  it('still refuses a seller inserting on somebody else’s behalf', async () => {
    /*
     * The fix relaxed the read policy to decide ownership from the row's own
     * columns, so it is worth proving it did not relax the *write* policy with
     * it. The insert policy still pins seller_id to the caller.
     */
    await expect(
      actingAs(
        db,
        seller,
        `insert into public.listings
           (seller_id, headline, industry, jurisdiction_code, deal_structure, real_estate_included, status)
         values ($1, $2, 'home_services', 'US-NY', 'asset', false, 'draft')
         returning id`,
        [otherSeller, `${HEADLINE} impersonated`],
      ),
    ).rejects.toThrow();
  });

  it('still refuses a buyer creating a listing', async () => {
    await expect(createListing(buyer, `${HEADLINE} by a buyer`)).rejects.toThrow();
  });

  it('does not let one seller read another seller’s draft', async () => {
    /*
     * The arm that replaced `app.controls_listing(id)` reads `seller_id` off the
     * row. If it had been written as `seller_id is not null` — or the status arm
     * widened — every draft on the platform would be readable. A draft is a
     * business whose owner has not decided to sell yet.
     */
    const mine = await createListing(otherSeller, `${HEADLINE} private draft`);
    const id = mine.rows[0]!.id;

    const seen = await actingAs<{ id: string }>(
      db,
      seller,
      'select id from public.listings where id = $1',
      [id],
    );
    expect(seen.rowCount).toBe(0);

    const asBuyer = await actingAs<{ id: string }>(
      db,
      buyer,
      'select id from public.listings where id = $1',
      [id],
    );
    expect(asBuyer.rowCount).toBe(0);
  });

  it('keeps a live listing readable by anybody signed in', async () => {
    const created = await createListing(seller, `${HEADLINE} going live`);
    const id = created.rows[0]!.id;

    await actingAs(db, seller, `update public.listings set status='pending_review' where id=$1`, [id]);
    await db.query(`update public.listings set status='live', published_at=now() where id=$1`, [id]);

    const asBuyer = await actingAs<{ id: string }>(
      db,
      buyer,
      'select id from public.listings where id = $1',
      [id],
    );
    expect(asBuyer.rowCount).toBe(1);
  });

  it('holds for every other table the product writes with RETURNING', async () => {
    /*
     * The same trap is set on any table whose SELECT policy answers by looking
     * the row up in itself. These are the writes the application makes with
     * `.select()` attached; each is exercised through RETURNING so a future
     * policy that reintroduces a self-lookup fails here rather than in
     * production.
     */
    const listing = (await createListing(seller, `${HEADLINE} for related writes`)).rows[0]!.id;

    const details = await actingAs(
      db,
      seller,
      `insert into public.listing_details (listing_id, legal_name)
       values ($1, 'Northfield Mechanical Inc') returning listing_id`,
      [listing],
    );
    expect(details.rowCount, 'listing_details').toBe(1);

    await db.query(`update public.listings set status='pending_review' where id=$1`, [listing]);
    await db.query(`update public.listings set status='live', published_at=now() where id=$1`, [listing]);

    const nda = await actingAs(
      db,
      buyer,
      `insert into public.listing_ndas (listing_id, buyer_id, status)
       values ($1, $2, 'requested') returning id`,
      [listing, buyer],
    );
    expect(nda.rowCount, 'listing_ndas').toBe(1);

    const verification = await actingAs(
      db,
      buyer,
      `insert into public.buyer_verifications (buyer_id, evidence_kind, capacity_band)
       values ($1, 'cash', 'from_1m_to_5m') returning id`,
      [buyer],
    );
    expect(verification.rowCount, 'buyer_verifications').toBe(1);

  });

  it('refuses RETURNING on the one table nobody may read back', async () => {
    /*
     * `market_interest` is deliberately write-only: anyone may add themselves,
     * and only an operator may read the list. So the same Postgres rule that
     * broke listing creation is *correct* here — asking for the row back is
     * asking to read a table you have no read policy on, and it is refused.
     *
     * Which makes this a live constraint on the application rather than a
     * curiosity: `registerInterest` must never grow a `.select()`. It has none
     * today, and the day somebody adds one for a returned id, this fails and
     * says why.
     */
    await expect(
      actingAs(
        db,
        buyer,
        `insert into public.market_interest (user_id, email, side)
         values ($1, 'ret-buyer-returning@example.com', 'buying') returning id`,
        [buyer],
      ),
    ).rejects.toThrow(/row-level security/);

    // The same insert without RETURNING is exactly what the product does.
    const plain = await actingAs(
      db,
      buyer,
      `insert into public.market_interest (user_id, email, side)
       values ($1, 'ret-buyer-plain@example.com', 'buying')`,
      [buyer],
    );
    expect(plain.rowCount).toBe(1);
  });
});
