import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  LISTING_STATUSES,
  PLATFORM_ROLES,
  can,
  canTransition,
  canViewFullListing,
  type Actor,
  type ListingRef,
  type PlatformRole,
} from '@ib/core';

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
 * The NDA gate.
 *
 * This is the most consequential boundary in the product. A seller's business
 * being identifiable before they chose to disclose it can cost them staff,
 * customers, and the sale itself — so the interesting tests here are not the
 * ones proving a signed NDA works. They are the ones proving that every *other*
 * state does not: requested, sent, revoked, expired, somebody else's, or signed
 * on a listing that has since been withdrawn.
 *
 * The rule exists twice — `canViewFullListing` in TypeScript and
 * `listing_details_select_nda` in SQL — because neither layer is sufficient
 * alone. A parity test at the bottom asserts they agree, since two
 * implementations of one rule drift silently otherwise.
 */
describe.skipIf(!hasDatabase)('listings', () => {
  let db: Client;

  let seller: string;
  let otherSeller: string;
  let broker: string;
  let strangerBroker: string;
  let buyer: string;
  let otherBuyer: string;
  let admin: string;

  let brokerFirm: string;
  let otherFirm: string;

  /** Live, brokered, with a full profile and financials attached. */
  let listing: string;
  /** Live, owned by `otherSeller`, no firm. */
  let rivalListing: string;
  /** Still a draft. */
  let draftListing: string;

  // ---------------------------------------------------------------------------

  /** Creates a listing at `draft` and drives it to the requested status. */
  async function makeListing(
    ownerId: string,
    headline: string,
    status: string,
    firmId: string | null = null,
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings (seller_id, firm_id, headline, industry, jurisdiction_code)
       values ($1, $2, $3, 'Business Services', 'US-NY') returning id`,
      [ownerId, firmId, headline],
    );
    const id = rows[0]!.id;

    // Walk the lifecycle rather than jumping, so the fixture obeys the same
    // transition rules the tests assert on.
    const path: Record<string, string[]> = {
      draft: [],
      pending_review: ['pending_review'],
      live: ['pending_review', 'live'],
      under_loi: ['pending_review', 'live', 'under_loi'],
      under_contract: ['pending_review', 'live', 'under_loi', 'under_contract'],
      closed: ['pending_review', 'live', 'under_loi', 'under_contract', 'closed'],
      withdrawn: ['withdrawn'],
    };

    for (const step of path[status] ?? []) {
      await db.query('update public.listings set status = $1 where id = $2', [step, id]);
    }

    await db.query(
      `insert into public.listing_details (listing_id, legal_name, city, revenue_cents)
       values ($1, $2, 'Rochester', 4200000000)`,
      [id, `${headline} Holdings LLC`],
    );
    await db.query(
      `insert into public.listing_financials (listing_id, fiscal_year, revenue_cents)
       values ($1, 2025, 4200000000)`,
      [id],
    );

    return id;
  }

  /** Puts an NDA into a given state, bypassing RLS as the fixture owner. */
  async function setNda(
    listingId: string,
    buyerId: string,
    status: string,
    expiresAt: string | null = null,
  ): Promise<void> {
    await db.query(
      `insert into public.listing_ndas (listing_id, buyer_id, status, signed_at, revoked_at, expires_at)
       values ($1, $2, $3::app.nda_status,
               case when $3::text in ('signed','revoked','expired') then now() end,
               case when $3::text = 'revoked' then now() end,
               $4::timestamptz)
       on conflict (listing_id, buyer_id) do update
          set status = excluded.status,
              signed_at = excluded.signed_at,
              revoked_at = excluded.revoked_at,
              expires_at = excluded.expires_at`,
      [listingId, buyerId, status, expiresAt],
    );
  }

  async function clearNdas(): Promise<void> {
    await db.query('delete from public.listing_ndas');
  }

  /** What the given user can actually read of the full profile. */
  async function detailsVisibleTo(userId: string, listingId: string): Promise<number> {
    const { rowCount } = await actingAs(
      db,
      userId,
      'select legal_name from public.listing_details where listing_id = $1',
      [listingId],
    );
    return rowCount;
  }

  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    // The seed is not part of the migrations, so the suite provides the one
    // jurisdiction it needs rather than depending on seed data being present.
    await db.query(
      `insert into public.jurisdictions (code, name, country_code, is_active)
       values ('US-NY', 'New York', 'US', true)`,
    );

    seller = await createAuthUser(db, 'listing-seller@example.com');
    otherSeller = await createAuthUser(db, 'listing-other-seller@example.com');
    broker = await createAuthUser(db, 'listing-broker@example.com');
    strangerBroker = await createAuthUser(db, 'listing-stranger-broker@example.com');
    buyer = await createAuthUser(db, 'listing-buyer@example.com');
    otherBuyer = await createAuthUser(db, 'listing-other-buyer@example.com');
    admin = await createAuthUser(db, 'listing-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values
         ($1,'seller'), ($2,'seller'), ($3,'broker'), ($4,'broker'),
         ($5,'buyer'), ($6,'buyer'), ($7,'admin')`,
      [seller, otherSeller, broker, strangerBroker, buyer, otherBuyer, admin],
    );

    const firms = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values
         ('Cairn Brokerage','brokerage'), ('Unrelated Brokerage','brokerage') returning id`,
    );
    brokerFirm = firms.rows[0]!.id;
    otherFirm = firms.rows[1]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role) values ($1,$2,'member'), ($3,$4,'member')`,
      [brokerFirm, broker, otherFirm, strangerBroker],
    );

    listing = await makeListing(seller, 'Established HVAC contractor', 'live', brokerFirm);
    rivalListing = await makeListing(otherSeller, 'Regional logistics operator', 'live');
    draftListing = await makeListing(seller, 'Specialty coffee roaster', 'draft');
  });

  beforeEach(async () => {
    await clearNdas();
  });

  afterAll(async () => {
    await db?.end();
  });

  // ===========================================================================
  // The gate
  // ===========================================================================

  describe('full profile is unreachable without an executed NDA', () => {
    it('hides it from a buyer with no NDA at all', async () => {
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('hides it from a buyer who has only requested one', async () => {
      await setNda(listing, buyer, 'requested');
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('hides it from a buyer the NDA has been sent to but who has not signed', async () => {
      // The state a seller sees as "waiting on them". Access begins at
      // signature, not at delivery.
      await setNda(listing, buyer, 'sent');
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('hides it once the NDA is revoked', async () => {
      await setNda(listing, buyer, 'revoked');
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('hides it once the NDA has expired', async () => {
      // Status still reads `signed`; only the clock has moved. This is the case
      // a gate that checked status alone would get wrong.
      await setNda(listing, buyer, 'signed', '2020-01-01T00:00:00Z');
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('hides it when the NDA is signed but separately marked revoked', async () => {
      await db.query(
        `insert into public.listing_ndas (listing_id, buyer_id, status, signed_at, revoked_at)
         values ($1, $2, 'signed', now(), now())`,
        [listing, buyer],
      );
      // `revoked_at` is checked independently of the status word, so a row that
      // is inconsistent fails closed rather than open.
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('reveals it to a buyer with a signed, unexpired NDA', async () => {
      await setNda(listing, buyer, 'signed', '2999-01-01T00:00:00Z');
      expect(await detailsVisibleTo(buyer, listing)).toBe(1);
    });

    it('reveals it when the NDA has no expiry at all', async () => {
      await setNda(listing, buyer, 'signed', null);
      expect(await detailsVisibleTo(buyer, listing)).toBe(1);
    });
  });

  describe("one buyer's NDA does not open another buyer's door", () => {
    beforeEach(async () => {
      await setNda(listing, buyer, 'signed');
    });

    it('does not admit a different buyer', async () => {
      expect(await detailsVisibleTo(otherBuyer, listing)).toBe(0);
    });

    it('does not admit the signing buyer to a different listing', async () => {
      // The gate is per listing. A signature on one is not a signature on all.
      expect(await detailsVisibleTo(buyer, rivalListing)).toBe(0);
    });

    it('does not admit an unrelated broker', async () => {
      expect(await detailsVisibleTo(strangerBroker, listing)).toBe(0);
    });

    it('leaks nothing through an unfiltered select', async () => {
      // The check that matters most: not "can they read this row" but "how many
      // rows does the table have, as far as they are concerned".
      const { rows } = await actingAs<{ n: string }>(
        db,
        otherBuyer,
        'select count(*)::text as n from public.listing_details',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('leaks nothing through the financials either', async () => {
      // A three-year revenue series identifies a business as readily as its
      // name, so it sits behind the same gate — and it is a separate table with
      // a separate policy, which is exactly how a gap gets left.
      const { rows } = await actingAs<{ n: string }>(
        db,
        otherBuyer,
        'select count(*)::text as n from public.listing_financials',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('admits the signing buyer to the financials', async () => {
      const { rowCount } = await actingAs(
        db,
        buyer,
        'select revenue_cents from public.listing_financials where listing_id = $1',
        [listing],
      );
      expect(rowCount).toBe(1);
    });
  });

  describe('a signed NDA does not survive the listing leaving the market', () => {
    it('closes the profile when the listing is withdrawn', async () => {
      const withdrawn = await makeListing(seller, 'Withdrawn machine shop', 'live');
      await setNda(withdrawn, buyer, 'signed');
      expect(await detailsVisibleTo(buyer, withdrawn)).toBe(1);

      await db.query("update public.listings set status = 'withdrawn' where id = $1", [withdrawn]);

      // The seller pulled the business off the market. A signature obtained
      // while it was listed is not standing permission to keep reading.
      expect(await detailsVisibleTo(buyer, withdrawn)).toBe(0);
    });

    it('closes the profile when the listing is a draft', async () => {
      await setNda(draftListing, buyer, 'signed');
      expect(await detailsVisibleTo(buyer, draftListing)).toBe(0);
    });
  });

  describe('the seller side always sees its own', () => {
    it('shows the owner their draft', async () => {
      expect(await detailsVisibleTo(seller, draftListing)).toBe(1);
    });

    it('shows the managing broker the firm listing', async () => {
      expect(await detailsVisibleTo(broker, listing)).toBe(1);
    });

    it('does not show a broker at another firm', async () => {
      expect(await detailsVisibleTo(strangerBroker, listing)).toBe(0);
    });

    it('does not show one seller another seller listing', async () => {
      expect(await detailsVisibleTo(otherSeller, listing)).toBe(0);
    });
  });

  describe('platform admins', () => {
    it('see every teaser, including drafts', async () => {
      const { rowCount } = await actingAs(db, admin, 'select id from public.listings');
      expect(rowCount).toBeGreaterThanOrEqual(3);
    });

    it('do not see any full profile', async () => {
      // Deliberate, and worth stating: reviewing a headline does not require the
      // seller's customer concentration. Ambient access to every confidential
      // profile on the platform is a standing risk with no matching benefit.
      const { rows } = await actingAs<{ n: string }>(
        db,
        admin,
        'select count(*)::text as n from public.listing_details',
      );
      expect(rows[0]!.n).toBe('0');
    });
  });

  // ===========================================================================
  // Teaser visibility
  // ===========================================================================

  describe('teaser', () => {
    it('is not readable by an anonymous visitor', async () => {
      const denial = await expectDenied(() => actingAsAnon(db, 'select id from public.listings'));
      expect(denial.code).toBe('42501');
    });

    it('shows a buyer live listings but not drafts', async () => {
      const { rows } = await actingAs<{ id: string }>(db, buyer, 'select id from public.listings');
      const ids = rows.map((r) => r.id);

      expect(ids).toContain(listing);
      expect(ids).toContain(rivalListing);
      expect(ids).not.toContain(draftListing);
    });

    it('hides a withdrawn listing from buyers but not from its seller', async () => {
      const gone = await makeListing(seller, 'Quietly withdrawn practice', 'withdrawn');

      const asBuyer = await actingAs(db, buyer, 'select id from public.listings where id = $1', [
        gone,
      ]);
      expect(asBuyer.rowCount).toBe(0);

      const asSeller = await actingAs(db, seller, 'select id from public.listings where id = $1', [
        gone,
      ]);
      expect(asSeller.rowCount).toBe(1);
    });
  });

  // ===========================================================================
  // Creating and editing
  // ===========================================================================

  describe('creating a listing', () => {
    it('lets a seller open one as a draft', async () => {
      const { rowCount } = await actingAs(
        db,
        seller,
        `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
         values ($1, 'Family-run garden centre', 'Retail', 'US-NY')`,
        [seller],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a buyer', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
           values ($1, 'Buyer attempt at listing', 'Retail', 'US-NY')`,
          [buyer],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses a listing created in somebody else name', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
           values ($1, 'Listing attributed elsewhere', 'Retail', 'US-NY')`,
          [otherSeller],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses a listing published straight to live', async () => {
      // Otherwise the review step and the first status-history row are both
      // skipped by anyone writing their own insert.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `insert into public.listings (seller_id, headline, industry, jurisdiction_code, status)
           values ($1, 'Straight to market listing', 'Retail', 'US-NY', 'live')`,
          [seller],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses attributing a listing to a firm the creator does not belong to', async () => {
      // Firm attribution grants every broker at that firm control of the
      // listing, so a caller-supplied id has to be proven.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          broker,
          `insert into public.listings (seller_id, firm_id, headline, industry, jurisdiction_code)
           values ($1, $2, 'Misattributed brokerage listing', 'Retail', 'US-NY')`,
          [broker, otherFirm],
        ),
      );
      expect(denial.code).toBe('42501');
    });
  });

  describe('editing a listing', () => {
    it('lets the seller edit their own', async () => {
      const { rowCount } = await actingAs(
        db,
        seller,
        `update public.listings set headline = 'Established HVAC contractor, Upstate NY' where id = $1`,
        [listing],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a buyer with a signed NDA', async () => {
      // Reading the profile is not authority over the record.
      await setNda(listing, buyer, 'signed');
      const { rowCount } = await actingAs(
        db,
        buyer,
        `update public.listings set headline = 'Edited by a buyer' where id = $1`,
        [listing],
      );
      expect(rowCount).toBe(0);
    });

    it('refuses transferring a listing to another seller', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, seller, 'update public.listings set seller_id = $1 where id = $2', [
          otherSeller,
          listing,
        ]),
      );
      expect(denial.message).toMatch(/cannot be transferred/i);
    });

    it('refuses attaching a firm the seller does not belong to', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, seller, 'update public.listings set firm_id = $1 where id = $2', [
          otherFirm,
          draftListing,
        ]),
      );
      expect(denial.message).toMatch(/not a member of that firm/i);
    });

    it('ignores a caller-supplied published_at', async () => {
      const target = await makeListing(seller, 'Backdated publication attempt', 'live');
      await actingAs(
        db,
        seller,
        `update public.listings set published_at = '1999-01-01' where id = $1`,
        [target],
      );

      const { rows } = await db.query<{ year: string }>(
        'select extract(year from published_at)::text as year from public.listings where id = $1',
        [target],
      );
      expect(rows[0]!.year).not.toBe('1999');
    });

    it('lets an admin withdraw a listing but not rewrite it', async () => {
      const target = await makeListing(seller, 'Listing needing moderation', 'live');

      const moderated = await actingAs(
        db,
        admin,
        `update public.listings set status = 'withdrawn' where id = $1`,
        [target],
      );
      expect(moderated.rowCount).toBe(1);

      const other = await makeListing(seller, 'Listing an admin should not edit', 'live');
      const denial = await expectDenied(() =>
        actingAs(
          db,
          admin,
          `update public.listings set headline = 'Rewritten by staff' where id = $1`,
          [other],
        ),
      );
      expect(denial.message).toMatch(/only be moderated by changing its status/i);
    });

    it('refuses to delete a listing outright', async () => {
      // NDAs, status history and eventually commission records point at it.
      const denial = await expectDenied(() =>
        actingAs(db, seller, 'delete from public.listings where id = $1', [draftListing]),
      );
      expect(denial.code).toBe('42501');
    });
  });

  // ===========================================================================
  // Status lifecycle
  // ===========================================================================

  describe('status transitions', () => {
    it('walks the normal path', async () => {
      const target = await makeListing(seller, 'Listing walking the lifecycle', 'draft');

      for (const next of ['pending_review', 'live', 'under_loi', 'under_contract', 'closed']) {
        const { rowCount } = await actingAs(
          db,
          seller,
          'update public.listings set status = $1 where id = $2',
          [next, target],
        );
        expect(rowCount, `moving to ${next}`).toBe(1);
      }
    });

    it('refuses a draft jumping straight to live', async () => {
      const target = await makeListing(seller, 'Listing skipping review', 'draft');
      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.listings set status = 'live' where id = $1`, [target]),
      );
      expect(denial.message).toMatch(/cannot move a listing from draft to live/i);
    });

    it('treats closed as terminal', async () => {
      const target = await makeListing(seller, 'Listing already closed', 'closed');
      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.listings set status = 'live' where id = $1`, [target]),
      );
      expect(denial.message).toMatch(/cannot move a listing from closed to live/i);
    });

    it('treats withdrawn as terminal', async () => {
      // Relisting is a new listing. Reopening this one would rewrite what the
      // parties actually did, and the audit trail points at it.
      const target = await makeListing(seller, 'Listing already withdrawn', 'withdrawn');
      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.listings set status = 'live' where id = $1`, [target]),
      );
      expect(denial.message).toMatch(/cannot move a listing from withdrawn to live/i);
    });

    it('stamps published_at the first time it goes live', async () => {
      const target = await makeListing(seller, 'Listing being published now', 'pending_review');

      const before = await db.query<{ published_at: Date | null }>(
        'select published_at from public.listings where id = $1',
        [target],
      );
      expect(before.rows[0]!.published_at).toBeNull();

      await actingAs(db, seller, `update public.listings set status = 'live' where id = $1`, [
        target,
      ]);

      const after = await db.query<{ published_at: Date | null }>(
        'select published_at from public.listings where id = $1',
        [target],
      );
      expect(after.rows[0]!.published_at).not.toBeNull();
    });
  });

  describe('status history', () => {
    it('records the opening draft and every move after it', async () => {
      const target = await makeListing(seller, 'Listing with a paper trail', 'draft');
      await actingAs(
        db,
        seller,
        `update public.listings set status = 'pending_review' where id = $1`,
        [target],
      );
      await actingAs(db, seller, `update public.listings set status = 'live' where id = $1`, [
        target,
      ]);

      const { rows } = await db.query<{ from_status: string | null; to_status: string }>(
        'select from_status, to_status from public.listing_status_history where listing_id = $1 order by changed_at, id',
        [target],
      );

      expect(rows).toEqual([
        { from_status: null, to_status: 'draft' },
        { from_status: 'draft', to_status: 'pending_review' },
        { from_status: 'pending_review', to_status: 'live' },
      ]);
    });

    it('records who made the change', async () => {
      const target = await makeListing(seller, 'Listing recording its actor', 'draft');
      await actingAs(db, seller, `update public.listings set status = 'withdrawn' where id = $1`, [
        target,
      ]);

      const { rows } = await db.query<{ actor_id: string | null }>(
        `select actor_id from public.listing_status_history
          where listing_id = $1 and to_status = 'withdrawn'`,
        [target],
      );
      expect(rows[0]!.actor_id).toBe(seller);
    });

    it('cannot be written or rewritten by a client', async () => {
      // The log is produced by a trigger precisely so no code path — and no
      // client — can skip or edit it.
      const insert = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `insert into public.listing_status_history (listing_id, to_status) values ($1, 'closed')`,
          [listing],
        ),
      );
      expect(insert.code).toBe('42501');

      const update = await expectDenied(() =>
        actingAs(db, seller, `update public.listing_status_history set to_status = 'closed'`),
      );
      expect(update.code).toBe('42501');

      const remove = await expectDenied(() =>
        actingAs(db, seller, 'delete from public.listing_status_history'),
      );
      expect(remove.code).toBe('42501');
    });
  });

  // ===========================================================================
  // NDA lifecycle
  // ===========================================================================

  describe('NDA lifecycle', () => {
    async function request(listingId: string, asUser: string): Promise<string> {
      const { rows } = await actingAs<{ id: string }>(
        db,
        asUser,
        `insert into public.listing_ndas (listing_id, buyer_id) values ($1, $2) returning id`,
        [listingId, asUser],
      );
      return rows[0]!.id;
    }

    it('lets a buyer request one on a live listing', async () => {
      const id = await request(listing, buyer);
      expect(id).toBeTruthy();
    });

    it('refuses a request on a draft listing', async () => {
      const denial = await expectDenied(() => request(draftListing, buyer));
      expect(denial.code).toBe('42501');
    });

    it('refuses a request made in another buyer name', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `insert into public.listing_ndas (listing_id, buyer_id) values ($1, $2)`,
          [listing, otherBuyer],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses a buyer inserting one already signed', async () => {
      // The whole point of the gate. If a client can insert `signed`, the buyer
      // signs their own NDA and the seller is never involved.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `insert into public.listing_ndas (listing_id, buyer_id, status, signed_at)
           values ($1, $2, 'signed', now())`,
          [listing, buyer],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses a buyer signing before the seller has sent it', async () => {
      await request(listing, buyer);
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `update public.listing_ndas set status = 'signed' where listing_id = $1`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/must be sent before it can be signed/i);
    });

    it('refuses the seller signing on the buyer behalf', async () => {
      await request(listing, buyer);
      await actingAs(
        db,
        seller,
        `update public.listing_ndas set status = 'sent' where listing_id = $1`,
        [listing],
      );

      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `update public.listing_ndas set status = 'signed' where listing_id = $1`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/only the buyer named on an NDA can sign it/i);
    });

    it('refuses a buyer sending their own NDA to themselves', async () => {
      await request(listing, buyer);
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `update public.listing_ndas set status = 'sent' where listing_id = $1`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/only the seller can send an NDA/i);
    });

    it('completes the round trip and opens the gate', async () => {
      await request(listing, buyer);
      await actingAs(
        db,
        seller,
        `update public.listing_ndas set status = 'sent' where listing_id = $1`,
        [listing],
      );
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);

      await actingAs(
        db,
        buyer,
        `update public.listing_ndas set status = 'signed' where listing_id = $1`,
        [listing],
      );
      expect(await detailsVisibleTo(buyer, listing)).toBe(1);
    });

    it('stamps signed_at itself rather than trusting the client', async () => {
      await request(listing, buyer);
      await actingAs(
        db,
        seller,
        `update public.listing_ndas set status = 'sent' where listing_id = $1`,
        [listing],
      );
      await actingAs(
        db,
        buyer,
        `update public.listing_ndas set status = 'signed', signed_at = '1999-01-01' where listing_id = $1`,
        [listing],
      );

      const { rows } = await db.query<{ year: string }>(
        'select extract(year from signed_at)::text as year from public.listing_ndas where listing_id = $1',
        [listing],
      );
      expect(rows[0]!.year).not.toBe('1999');
    });

    it('refuses a buyer extending their own expiry', async () => {
      // Without this the gate is decorative: the buyer sets `expires_at` to
      // 2999 and keeps the profile open indefinitely.
      await setNda(listing, buyer, 'signed', '2026-01-01T00:00:00Z');
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `update public.listing_ndas set expires_at = '2999-01-01' where listing_id = $1`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/only the seller sets the terms/i);
    });

    it('lets the seller set the expiry', async () => {
      await setNda(listing, buyer, 'signed', null);
      const { rowCount } = await actingAs(
        db,
        seller,
        `update public.listing_ndas set expires_at = '2030-01-01' where listing_id = $1`,
        [listing],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses moving an NDA to another listing', async () => {
      await setNda(rivalListing, buyer, 'signed');
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          'update public.listing_ndas set listing_id = $1 where listing_id = $2',
          [listing, rivalListing],
        ),
      );
      expect(denial.message).toMatch(/cannot be moved to another listing or buyer/i);
    });

    it('refuses walking a signed NDA back to sent', async () => {
      await setNda(listing, buyer, 'signed');
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `update public.listing_ndas set status = 'sent' where listing_id = $1`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/cannot be returned to an earlier state/i);
    });

    it('lets either party revoke, and closes the gate immediately', async () => {
      await setNda(listing, buyer, 'signed');
      expect(await detailsVisibleTo(buyer, listing)).toBe(1);

      await actingAs(
        db,
        seller,
        `update public.listing_ndas set status = 'revoked' where listing_id = $1`,
        [listing],
      );
      expect(await detailsVisibleTo(buyer, listing)).toBe(0);
    });

    it('shows the seller every NDA on their listing and the buyer only their own', async () => {
      await setNda(listing, buyer, 'signed');
      await setNda(listing, otherBuyer, 'requested');

      const asSeller = await actingAs(db, seller, 'select id from public.listing_ndas');
      expect(asSeller.rowCount).toBe(2);

      const asBuyer = await actingAs(db, buyer, 'select id from public.listing_ndas');
      expect(asBuyer.rowCount).toBe(1);
    });

    it('holds one NDA per buyer per listing', async () => {
      await request(listing, buyer);
      const denial = await expectDenied(() => request(listing, buyer));
      expect(denial.code).toBe('23505');
    });
  });

  // ===========================================================================
  // Watchlist
  // ===========================================================================

  describe('watchlist', () => {
    it('lets a buyer save and unsave a live listing', async () => {
      const saved = await actingAs(
        db,
        buyer,
        'insert into public.listing_saves (listing_id, user_id) values ($1, $2)',
        [listing, buyer],
      );
      expect(saved.rowCount).toBe(1);

      const removed = await actingAs(
        db,
        buyer,
        'delete from public.listing_saves where listing_id = $1 and user_id = $2',
        [listing, buyer],
      );
      expect(removed.rowCount).toBe(1);
    });

    it('refuses saving on somebody else behalf', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          'insert into public.listing_saves (listing_id, user_id) values ($1, $2)',
          [listing, otherBuyer],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses saving a listing that is not on the market', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          'insert into public.listing_saves (listing_id, user_id) values ($1, $2)',
          [draftListing, buyer],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('keeps one buyer watchlist private from another', async () => {
      await db.query('insert into public.listing_saves (listing_id, user_id) values ($1, $2)', [
        listing,
        buyer,
      ]);

      const { rows } = await actingAs<{ n: string }>(
        db,
        otherBuyer,
        'select count(*)::text as n from public.listing_saves',
      );
      expect(rows[0]!.n).toBe('0');
    });
  });

  // ===========================================================================
  // Parity with the TypeScript model
  // ===========================================================================

  describe('parity with packages/core', () => {
    const actor = (roles: PlatformRole[]): Actor => ({
      userId: 'u',
      platformRoles: roles,
      firmMemberships: [],
    });

    it('agrees on who may create a listing', async () => {
      for (const role of PLATFORM_ROLES) {
        const user = await createAuthUser(db, `listing-parity-create-${role}@example.com`);
        await db.query('insert into public.user_roles (user_id, role) values ($1, $2)', [
          user,
          role,
        ]);

        const { rows } = await actingAs<{ allowed: boolean }>(
          db,
          user,
          'select app.can_create_listing() as allowed',
        );
        expect(rows[0]!.allowed, `${role} in SQL`).toBe(can(actor([role]), 'listing:create'));
      }
    });

    it('agrees on who may sign an NDA', async () => {
      // The bug this catches is a real one that was in the first draft of the
      // policy: `has_platform_role('buyer')` reads naturally but locks out
      // family offices, search funds and PE, all of which carry `nda:sign`.
      for (const role of PLATFORM_ROLES) {
        const user = await createAuthUser(db, `listing-parity-nda-${role}@example.com`);
        await db.query('insert into public.user_roles (user_id, role) values ($1, $2)', [
          user,
          role,
        ]);

        const { rows } = await actingAs<{ allowed: boolean }>(
          db,
          user,
          'select app.is_buy_side() as allowed',
        );
        expect(rows[0]!.allowed, `${role} in SQL`).toBe(can(actor([role]), 'nda:sign'));
      }
    });

    it('agrees with LISTING_TRANSITIONS on every possible move', async () => {
      // 49 pairs, every one driven through the real trigger. The UI reads
      // `LISTING_TRANSITIONS` to decide which buttons to render, so a divergence
      // here is a button that throws — or worse, a move the UI hides that the
      // database would have allowed.
      for (const from of LISTING_STATUSES) {
        for (const to of LISTING_STATUSES) {
          if (from === to) continue;

          const target = await makeListing(seller, `Transition ${from} to ${to}`, from);

          let acceptedBySql = true;
          try {
            await actingAs(db, seller, 'update public.listings set status = $1 where id = $2', [
              to,
              target,
            ]);
          } catch {
            acceptedBySql = false;
          }

          expect(acceptedBySql, `${from} → ${to}`).toBe(canTransition(from, to));
        }
      }
    });

    it('agrees with canViewFullListing across every NDA state', async () => {
      const ref: ListingRef = {
        id: listing,
        ownerUserId: seller,
        firmId: brokerFirm,
        status: 'live',
      };

      const cases: Array<{ status: string; expiresAt: string | null }> = [
        { status: 'requested', expiresAt: null },
        { status: 'sent', expiresAt: null },
        { status: 'signed', expiresAt: null },
        { status: 'signed', expiresAt: '2999-01-01T00:00:00Z' },
        { status: 'signed', expiresAt: '2020-01-01T00:00:00Z' },
        { status: 'revoked', expiresAt: null },
        { status: 'expired', expiresAt: null },
      ];

      for (const { status, expiresAt } of cases) {
        await clearNdas();
        await setNda(listing, buyer, status, expiresAt);

        const inSql = (await detailsVisibleTo(buyer, listing)) === 1;

        const inTypeScript = canViewFullListing(
          { userId: buyer, platformRoles: ['buyer'], firmMemberships: [] },
          ref,
          {
            listingId: listing,
            userId: buyer,
            // `revoked` carries a revocation timestamp in SQL; the TypeScript
            // model reads the same fact off the status word.
            status: status as never,
            expiresAt: expiresAt === null ? null : new Date(expiresAt),
          },
          new Date(),
        );

        expect(inSql, `${status} / expires ${expiresAt ?? 'never'}`).toBe(inTypeScript);
      }
    });
  });

  // ===========================================================================
  // Table-level invariants
  // ===========================================================================

  describe('invariants', () => {
    it('has RLS enabled and forced on every listings table', async () => {
      const { rows } = await db.query<{ relname: string }>(
        `select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and c.relname like 'listing%'
            and (not c.relrowsecurity or not c.relforcerowsecurity)`,
      );
      expect(rows).toEqual([]);
    });

    it('exposes no listings function to anon', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and p.proname in ('controls_listing','has_executed_nda','listing_is_discoverable',
                              'can_create_listing','is_buy_side')
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      expect(rows).toEqual([]);
    });

    it('pins search_path on every listings helper', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and (p.proname like '%listing%' or p.proname = 'is_buy_side' or p.proname like '%nda%')
            and (p.proconfig is null
                 or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`,
      );
      expect(rows).toEqual([]);
    });
  });
});

/**
 * The widening in 0018, and what it quietly changed elsewhere.
 *
 * `firms_select_listing_representative` lets a buyer see who is representing a
 * live listing, which is right and load-bearing — a deal offered by nobody in
 * particular does not get taken seriously.
 *
 * It also means `select * from firms` stopped answering "firms I belong to" on
 * the day it shipped, and no test noticed because there were no live listings
 * yet. `listMyFirms()` in the application read `firms` directly and started
 * offering brokers a rival brokerage as somewhere to file a deal.
 *
 * These tests pin both halves: the widening still works, and the membership
 * question still has a different, narrower answer.
 */
describe.skipIf(!hasDatabase)('firm visibility after the 0018 widening', () => {
  let db: Client;

  let seller: string;
  let rivalBroker: string;
  let brokerageId: string;
  let rivalFirmId: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    await db.query(
      `insert into public.jurisdictions (code, name, country_code, is_active)
       values ('US-NY','New York','US',true)`,
    );

    seller = await createAuthUser(db, 'firmvis-seller@example.com');
    rivalBroker = await createAuthUser(db, 'firmvis-rival@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'broker'), ($2,'broker')`,
      [seller, rivalBroker],
    );

    const firms = await db.query<{ id: string }>(
      `insert into public.firms (name, kind)
       values ('Anchor Brokerage','brokerage'), ('Rival Partners','brokerage') returning id`,
    );
    brokerageId = firms.rows[0]!.id;
    rivalFirmId = firms.rows[1]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role) values ($1,$2,'owner'), ($3,$4,'owner')`,
      [brokerageId, seller, rivalFirmId, rivalBroker],
    );

    const listing = await db.query<{ id: string }>(
      `insert into public.listings (seller_id, firm_id, headline, industry, jurisdiction_code)
       values ($1, $2, 'A route business', 'home_services', 'US-NY') returning id`,
      [seller, brokerageId],
    );

    await db.query(`update public.listings set status = 'pending_review' where id = $1`, [
      listing.rows[0]!.id,
    ]);
    await db.query(`update public.listings set status = 'live' where id = $1`, [
      listing.rows[0]!.id,
    ]);
  });

  afterAll(async () => {
    await db?.end();
  });

  it('lets a rival see the firm behind a live listing', async () => {
    // The widening working as intended. "Listed by Anchor Brokerage" is the
    // credential a buyer actually weighs.
    const { rows } = await actingAs<{ name: string }>(
      db,
      rivalBroker,
      'select name from public.firms order by name',
    );
    expect(rows.map((r) => r.name)).toContain('Anchor Brokerage');
  });

  it('does not make that firm one of theirs', async () => {
    // The half the application got wrong. Reading `firms` answers "firms I can
    // see"; membership is a different question with a narrower answer, and it
    // has to be asked of `firm_members`.
    const { rows } = await actingAs<{ firm_id: string }>(
      db,
      rivalBroker,
      'select firm_id from public.firm_members',
    );

    expect(rows.map((r) => r.firm_id)).toEqual([rivalFirmId]);
    expect(rows.map((r) => r.firm_id)).not.toContain(brokerageId);
  });

  it('shows the two questions giving different answers', async () => {
    // Stated as its own assertion because this is the shape of the bug: two
    // queries that agreed for months and then stopped, silently.
    const visible = await actingAs<{ id: string }>(db, rivalBroker, 'select id from public.firms');
    const mine = await actingAs<{ firm_id: string }>(
      db,
      rivalBroker,
      'select firm_id from public.firm_members',
    );

    expect(visible.rowCount).toBeGreaterThan(mine.rowCount);
  });
});
