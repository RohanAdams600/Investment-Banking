import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { applyMigrations, connect, createAuthUser, hasDatabase } from './helpers';

/**
 * Deleting the confidential half once a deal is over.
 *
 * The value of this control is entirely in what it does *not* delete. A purge
 * that also takes the teaser erases the market's history; one that takes the
 * audit trail erases the record that the deletion happened, which is the one
 * thing a regulator or a seller would later ask for.
 *
 * So most of this asserts survival rather than removal.
 */
describe.skipIf(!hasDatabase)('retention purge', () => {
  let db: Client;
  let seller: string;

  async function makeListing(headline: string, status: 'closed' | 'withdrawn' | 'live') {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings
         (seller_id, headline, industry, jurisdiction_code, deal_structure, real_estate_included, status)
       values ($1, $2, 'home_services', 'US-NY', 'asset', false, 'draft')
       returning id`,
      [seller, headline],
    );
    const id = rows[0]!.id;

    await db.query(
      `insert into public.listing_details (listing_id, legal_name, revenue_cents, earnings_cents)
       values ($1, 'Northfield Mechanical Inc', 341000000, 74200000)`,
      [id],
    );
    await db.query(
      `insert into public.listing_financials (listing_id, fiscal_year, revenue_cents, ebitda_cents)
       values ($1, 2024, 341000000, 74200000), ($1, 2023, 311000000, 58000000)`,
      [id],
    );

    /*
     * Walked through the real lifecycle rather than set directly. The
     * transition trigger refuses draft -> closed, and a fixture that bypassed
     * it would be testing a state the product cannot actually produce.
     */
    await db.query(`update public.listings set status='pending_review' where id=$1`, [id]);
    await db.query(`update public.listings set status='live' where id=$1`, [id]);

    if (status === 'withdrawn') {
      await db.query(`update public.listings set status='withdrawn' where id=$1`, [id]);
    } else if (status === 'closed') {
      await db.query(`update public.listings set status='under_loi' where id=$1`, [id]);
      await db.query(`update public.listings set status='under_contract' where id=$1`, [id]);
      await db.query(`update public.listings set status='closed' where id=$1`, [id]);
    }

    return id;
  }

  /** Backdates the terminal transition, standing in for the passage of time. */
  async function age(listingId: string, days: number) {
    await db.query(
      `update public.listing_status_history
          set changed_at = now() - make_interval(days => $2)
        where listing_id = $1`,
      [listingId, days],
    );
  }

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'purge-seller@example.com');
    await db.query(`insert into public.user_roles (user_id, role) values ($1,'seller')`, [seller]);
    await db.query(`update public.jurisdictions set is_active = true where code='US-NY'`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it('deletes the confidential half of a long-closed listing', async () => {
    const id = await makeListing('Closed HVAC contractor for purge', 'closed');
    await age(id, 120);

    const { rows } = await db.query<{ listings_purged: number; details_deleted: number }>(
      'select * from app.purge_expired_confidential_data(90)',
    );
    expect(rows[0]!.listings_purged).toBeGreaterThanOrEqual(1);

    const details = await db.query('select 1 from public.listing_details where listing_id=$1', [id]);
    const financials = await db.query(
      'select 1 from public.listing_financials where listing_id=$1',
      [id],
    );
    expect(details.rowCount).toBe(0);
    expect(financials.rowCount).toBe(0);
  });

  it('keeps the teaser, the status history and the audit trail', async () => {
    /*
     * The half that matters. A purge that erases the listing erases the
     * market's record of a completed sale; one that erases the audit event
     * erases the proof the deletion happened at all.
     */
    const id = await makeListing('Withdrawn shop for purge', 'withdrawn');
    await age(id, 200);
    await db.query('select * from app.purge_expired_confidential_data(90)');

    const listing = await db.query<{ headline: string }>(
      'select headline from public.listings where id=$1',
      [id],
    );
    expect(listing.rowCount, 'the anonymised teaser must survive').toBe(1);

    const history = await db.query('select 1 from public.listing_status_history where listing_id=$1', [id]);
    expect(history.rowCount, 'the status history must survive').toBeGreaterThan(0);

    const audit = await db.query(
      `select 1 from public.audit_log
        where entity_id = $1::text and action = 'listing.confidential_data_purged'`,
      [id],
    );
    expect(audit.rowCount, 'the deletion must leave a record of itself').toBe(1);
  });

  it('leaves a listing that is still on the market completely alone', async () => {
    const id = await makeListing('Live listing that must not be purged', 'live');
    await age(id, 500);

    await db.query('select * from app.purge_expired_confidential_data(90)');

    const details = await db.query('select 1 from public.listing_details where listing_id=$1', [id]);
    expect(details.rowCount, 'a live listing is not expired data').toBe(1);
  });

  it('leaves a recently closed listing alone', async () => {
    /*
     * Deals stall and restart constantly here. A seller who withdraws in March
     * and relists in May must not find their financials gone.
     */
    const id = await makeListing('Recently withdrawn, still inside the window', 'withdrawn');
    await age(id, 10);

    await db.query('select * from app.purge_expired_confidential_data(90)');

    const details = await db.query('select 1 from public.listing_details where listing_id=$1', [id]);
    expect(details.rowCount).toBe(1);
  });

  it('previews without deleting', async () => {
    // A purge nobody has previewed is a purge nobody notices is wrong until it
    // is too late to notice.
    const id = await makeListing('Preview only, must survive', 'closed');
    await age(id, 400);

    const preview = await db.query('select * from app.confidential_purge_preview(90)');
    expect(preview.rowCount).toBeGreaterThanOrEqual(1);

    const details = await db.query('select 1 from public.listing_details where listing_id=$1', [id]);
    expect(details.rowCount, 'preview must not delete anything').toBe(1);
  });

  it('is not reachable by a client role', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'app.purge_expired_confidential_data(integer)', 'execute') as ok`,
        [role],
      );
      expect(rows[0]!.ok, `${role} must not be able to purge`).toBe(false);
    }
  });
});
