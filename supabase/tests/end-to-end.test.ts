import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  actingAs,
  actingAsAnon,
  applyMigrations,
  connect,
  createAuthUser,
  hasDatabase,
} from './helpers';

/**
 * One business, from listed to sold-to, in order.
 *
 * The other files in this directory each test one table's policies. This one
 * walks the journey a real seller and a real buyer take, in sequence, against a
 * schema built from every migration — because the failure this was written
 * after was invisible to per-table tests: each policy was correct, and the
 * *order* of operations the product performs was refused.
 *
 * Every write here uses `RETURNING` where the application uses `.select()`, and
 * the anonymous steps run as `anon` rather than as a signed-in user, because
 * those two details are exactly what the per-table tests were abstracting away.
 */
describe.skipIf(!hasDatabase)('the whole journey', () => {
  let db: Client;
  let seller: string;
  let buyer: string;
  let stranger: string;
  let admin: string;
  let listing: string;
  let slug: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'journey-seller@example.com');
    buyer = await createAuthUser(db, 'journey-buyer@example.com');
    stranger = await createAuthUser(db, 'journey-stranger@example.com');
    admin = await createAuthUser(db, 'journey-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'seller'), ($2,'buyer'), ($3,'buyer'), ($4,'admin')`,
      [seller, buyer, stranger, admin],
    );
    await db.query(`update public.jurisdictions set is_active = true where code='US-NY'`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it('1. a seller lists a business and files its confidential half', async () => {
    const created = await actingAs<{ id: string }>(
      db,
      seller,
      `insert into public.listings
         (seller_id, headline, summary, background, industry, jurisdiction_code,
          deal_structure, real_estate_included, status,
          revenue_band_low_cents, revenue_band_high_cents,
          earnings_band_low_cents, earnings_band_high_cents)
       values ($1, 'Established HVAC contractor with recurring service base',
               'Twenty years of maintenance contracts in upstate New York.',
               'Built on referrals; the founder still runs quotes.',
               'home_services','US-NY','asset',false,'draft',
               300000000,400000000,70000000,90000000)
       returning id`,
      [seller],
    );

    expect(created.rowCount).toBe(1);
    listing = created.rows[0]!.id;

    const details = await actingAs(
      db,
      seller,
      `insert into public.listing_details (listing_id, legal_name, city, revenue_cents, earnings_cents)
       values ($1,'Northfield Mechanical Inc','Rochester',341000000,74200000)
       returning listing_id`,
      [listing],
    );
    expect(details.rowCount).toBe(1);
  });

  it('2. an operator moderates it onto the market', async () => {
    await actingAs(db, seller, `update public.listings set status='pending_review' where id=$1`, [
      listing,
    ]);
    await actingAs(db, admin, `update public.listings set status='live' where id=$1`, [listing]);

    const { rows } = await db.query<{ status: string; published: boolean; slug: string }>(
      'select status::text, published_at is not null as published, slug from public.listings where id=$1',
      [listing],
    );
    expect(rows[0]!.status).toBe('live');
    // Stamped by the transition trigger, not by the application.
    expect(rows[0]!.published).toBe(true);
    slug = rows[0]!.slug;
  });

  it('3. an anonymous visitor sees the teaser and cannot reach the tables', async () => {
    const view = await actingAsAnon<{ headline: string }>(
      db,
      'select headline from public.market_listings where slug=$1',
      [slug],
    );
    expect(view.rowCount).toBe(1);

    for (const table of ['listings', 'listing_details']) {
      await expect(
        actingAsAnon(db, `select count(*) from public.${table}`),
      ).rejects.toThrow(/permission denied/);
    }

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.columns
        where table_schema='public' and table_name='market_listings'
          and column_name in ('id','seller_id')`,
    );
    expect(rows[0]!.n, 'the public view must expose neither id nor seller_id').toBe('0');
  });

  it('4. a signed-in buyer sees the teaser and not the confidential half', async () => {
    const teaser = await actingAs(db, buyer, 'select id from public.listings where id=$1', [listing]);
    expect(teaser.rowCount).toBe(1);

    const confidential = await actingAs(
      db,
      buyer,
      'select legal_name from public.listing_details where listing_id=$1',
      [listing],
    );
    expect(confidential.rowCount).toBe(0);
  });

  it('5. the confidentiality agreement opens it, and only for that buyer', async () => {
    await actingAs(
      db,
      buyer,
      `insert into public.listing_ndas (listing_id, buyer_id, status) values ($1,$2,'requested')`,
      [listing, buyer],
    );
    // The seller sets the terms — a buyer setting their own expiry is refused.
    await actingAs(
      db,
      seller,
      `update public.listing_ndas set status='sent', sent_at=now(), expires_at=now()+interval '12 months'
        where listing_id=$1 and buyer_id=$2`,
      [listing, buyer],
    );
    await actingAs(
      db,
      buyer,
      `update public.listing_ndas set status='signed', signed_at=now()
        where listing_id=$1 and buyer_id=$2`,
      [listing, buyer],
    );

    const opened = await actingAs<{ legal_name: string }>(
      db,
      buyer,
      'select legal_name from public.listing_details where listing_id=$1',
      [listing],
    );
    expect(opened.rowCount).toBe(1);
    expect(opened.rows[0]!.legal_name).toBe('Northfield Mechanical Inc');

    const other = await actingAs(
      db,
      stranger,
      'select legal_name from public.listing_details where listing_id=$1',
      [listing],
    );
    expect(other.rowCount, 'a different buyer must still see nothing').toBe(0);
  });

  it('6. revoking it closes the gate again', async () => {
    await actingAs(
      db,
      seller,
      `update public.listing_ndas set status='revoked', revoked_at=now(), revoked_by=$3
        where listing_id=$1 and buyer_id=$2`,
      [listing, buyer, seller],
    );

    const closed = await actingAs(
      db,
      buyer,
      'select legal_name from public.listing_details where listing_id=$1',
      [listing],
    );
    expect(closed.rowCount).toBe(0);
  });

  it('7. search reaches the teaser and never the confidential half', async () => {
    const found = await actingAsAnon(db, `select slug from public.search_market('HVAC recurring', 20)`);
    expect(found.rowCount).toBeGreaterThanOrEqual(1);

    // The index is built over teaser columns only, so the company's real name
    // is not a searchable term. Otherwise anybody could confirm which business
    // is for sale by watching which queries return a row.
    const hidden = await actingAsAnon(
      db,
      `select slug from public.search_market('Northfield Mechanical', 20)`,
    );
    expect(hidden.rowCount).toBe(0);
  });

  it('8. the view tally counts anonymously and is readable only by the seller', async () => {
    await actingAsAnon(db, 'select public.record_listing_view($1)', [slug]);
    await actingAsAnon(db, 'select public.record_listing_view($1)', [slug]);

    const mine = await actingAs<{ total: string }>(
      db,
      seller,
      'select coalesce(sum(views),0)::text as total from public.listing_view_days where listing_id=$1',
      [listing],
    );
    expect(mine.rows[0]!.total).toBe('2');

    const theirs = await actingAs<{ total: string }>(
      db,
      buyer,
      'select coalesce(sum(views),0)::text as total from public.listing_view_days where listing_id=$1',
      [listing],
    );
    expect(theirs.rows[0]!.total, 'a buyer would negotiate with this number').toBe('0');
  });

  it('9. funding verification reaches the seller as a band and nothing more', async () => {
    await actingAs(
      db,
      buyer,
      `insert into public.buyer_verifications (buyer_id, evidence_kind, capacity_band, evidence_note)
       values ($1,'sba_preapproval','from_1m_to_5m','Pre-approval letter, dated this quarter.')`,
      [buyer],
    );

    await expect(
      actingAs(
        db,
        buyer,
        `update public.buyer_verifications set status='verified', expires_at=now()+interval '180 days'
          where buyer_id=$1`,
        [buyer],
      ),
    ).rejects.toThrow();

    await actingAs(
      db,
      admin,
      `update public.buyer_verifications set status='verified',
              expires_at=now()+interval '180 days', review_note='Letter sighted.'
        where buyer_id=$1`,
      [buyer],
    );

    const badge = await actingAs<{ capacity_band: string; is_current: boolean }>(
      db,
      seller,
      'select capacity_band::text, is_current from public.buyer_verification_badge($1)',
      [buyer],
    );
    expect(badge.rowCount).toBe(1);
    expect(badge.rows[0]!.capacity_band).toBe('from_1m_to_5m');

    const evidence = await actingAs(
      db,
      seller,
      'select evidence_note from public.buyer_verifications where buyer_id=$1',
      [buyer],
    );
    expect(evidence.rowCount, 'a seller must never reach the evidence itself').toBe(0);

    const unrelated = await actingAs(
      db,
      stranger,
      'select capacity_band from public.buyer_verification_badge($1)',
      [buyer],
    );
    expect(unrelated.rowCount).toBe(0);
  });
});
