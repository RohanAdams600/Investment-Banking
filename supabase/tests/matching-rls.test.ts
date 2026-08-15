import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  actingAs,
  applyMigrations,
  connect,
  createAuthUser,
  expectDenied,
  hasDatabase,
} from './helpers';

/**
 * Matching, identity, and outreach nobody sent by accident.
 *
 * Three rules carry this file:
 *
 *   1. **The business is confidential; the people are not.** A seller sees who
 *      matched and who asked for access, by name, because they cannot otherwise
 *      decide who to approach or whose request to grant. Knowing who is selling
 *      is still not knowing what is for sale — the NDA gate is untouched.
 *   2. **A buyer's raw scores are their own.** The seller reaches buyers through
 *      `matched_buyers()`, which respects the buyer's `is_discoverable` consent;
 *      the `match_scores` table itself stays keyed to `auth.uid()`.
 *   3. **Nothing reaches a third party without a person approving it.** A
 *      standing requirement of the specification, and here an invariant of the
 *      data rather than a habit of the code.
 */
describe.skipIf(!hasDatabase)('matching', () => {
  let db: Client;

  let seller: string;
  let broker: string;
  let buyer: string;
  let otherBuyer: string;

  let listing: string;
  let rivalListing: string;

  async function makeLiveListing(ownerId: string, headline: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
       values ($1, $2, 'home_services', 'US-NY') returning id`,
      [ownerId, headline],
    );
    const id = rows[0]!.id;
    await db.query("update public.listings set status = 'pending_review' where id = $1", [id]);
    await db.query("update public.listings set status = 'live' where id = $1", [id]);
    return id;
  }

  /** Writes a score the way the matcher does — with the service role, not a user. */
  async function setScore(
    listingId: string,
    buyerId: string,
    score: number,
    excluded = false,
  ): Promise<void> {
    await db.query(
      `insert into public.match_scores (listing_id, buyer_id, score, excluded, reasons)
       values ($1, $2, $3, $4, '[{"label":"Industry match","detail":"This sector is on your list.","points":30}]'::jsonb)
       on conflict (listing_id, buyer_id) do update
         set score = excluded.score, excluded = excluded.excluded`,
      [listingId, buyerId, score, excluded],
    );
  }

  async function makeDraft(listingId: string, recipientId: string, authorId: string) {
    const { rows } = await actingAs<{ id: string }>(
      db,
      authorId,
      `insert into public.outreach_drafts (listing_id, recipient_id, created_by, body)
       values ($1, $2, $3, 'We think this may fit what you are looking for.') returning id`,
      [listingId, recipientId, authorId],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    await db.query(
      `insert into public.jurisdictions (code, name, country_code, is_active)
       values ('US-NY', 'New York', 'US', true)
       on conflict (code) do update set is_active = excluded.is_active, name = excluded.name`,
    );

    seller = await createAuthUser(db, 'match-seller@example.com');
    broker = await createAuthUser(db, 'match-broker@example.com');
    buyer = await createAuthUser(db, 'match-buyer@example.com');
    otherBuyer = await createAuthUser(db, 'match-other-buyer@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values
         ($1,'seller'), ($2,'broker'), ($3,'buyer'), ($4,'buyer')`,
      [seller, broker, buyer, otherBuyer],
    );

    listing = await makeLiveListing(seller, 'Matching HVAC contractor');
    rivalListing = await makeLiveListing(broker, 'Matching logistics operator');
  });

  beforeEach(async () => {
    await db.query('delete from public.outreach_drafts');
    await db.query('delete from public.match_scores');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ===========================================================================
  // Score isolation
  // ===========================================================================

  describe('match scores', () => {
    it('shows a buyer their own scores', async () => {
      await setScore(listing, buyer, 88);

      const { rowCount } = await actingAs(db, buyer, 'select score from public.match_scores');
      expect(rowCount).toBe(1);
    });

    it("does not show a buyer another buyer's scores", async () => {
      await setScore(listing, buyer, 88);
      await setScore(listing, otherBuyer, 92);

      const { rows } = await actingAs<{ score: number }>(
        db,
        buyer,
        'select score from public.match_scores',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.score).toBe(88);
    });

    it('does not hand the seller the raw score table', async () => {
      // The seller reaches matched buyers through `matched_buyers()`, which
      // applies the buyer's `is_discoverable` consent. Reading `match_scores`
      // directly would route around that consent, so the table itself stays
      // keyed to `auth.uid()`.
      await setScore(listing, buyer, 88);
      await setScore(listing, otherBuyer, 92);

      const { rows } = await actingAs<{ n: string }>(
        db,
        seller,
        'select count(*)::text as n from public.match_scores',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('refuses a buyer writing their own score', async () => {
      // Otherwise a buyer promotes themselves to the top of every seller's list.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyer,
          `insert into public.match_scores (listing_id, buyer_id, score) values ($1, $2, 100)`,
          [listing, buyer],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses a buyer editing a score', async () => {
      await setScore(listing, buyer, 40);

      const denial = await expectDenied(() =>
        actingAs(db, buyer, 'update public.match_scores set score = 99 where buyer_id = $1', [
          buyer,
        ]),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses a buyer deleting an unflattering score', async () => {
      await setScore(listing, buyer, 12);

      const denial = await expectDenied(() =>
        actingAs(db, buyer, 'delete from public.match_scores where buyer_id = $1', [buyer]),
      );
      expect(denial.code).toBe('42501');
    });

    it('keeps excluded listings on record so a buyer can be told why', async () => {
      // A buyer seeing an empty list should be able to find out that their own
      // limits produced it, rather than concluding the market is empty.
      await setScore(listing, buyer, 0, true);

      const { rows } = await actingAs<{ excluded: boolean }>(
        db,
        buyer,
        'select excluded from public.match_scores',
      );
      expect(rows[0]!.excluded).toBe(true);
    });
  });

  // ===========================================================================
  // The seller's view
  // ===========================================================================

  describe('match_summary', () => {
    it('reports counts to the seller', async () => {
      await setScore(listing, buyer, 88);
      await setScore(listing, otherBuyer, 41);

      const { rows } = await actingAs<{
        total_buyers: number;
        strong_matches: number;
        best_score: number;
      }>(db, seller, 'select * from public.match_summary($1)', [listing]);

      expect(rows[0]!.total_buyers).toBe(2);
      expect(rows[0]!.strong_matches).toBe(1);
    });

    it('rounds the best score down to a band', async () => {
      // An exact best score, watched day to day, tells a seller the moment one
      // particular buyer's criteria changed.
      await setScore(listing, buyer, 88);

      const { rows } = await actingAs<{ best_score: number }>(
        db,
        seller,
        'select best_score from public.match_summary($1)',
        [listing],
      );
      expect(rows[0]!.best_score).toBe(80);
    });

    it('reports nothing for a listing the caller does not control', async () => {
      await setScore(rivalListing, buyer, 95);

      const { rows } = await actingAs<{ total_buyers: number }>(
        db,
        seller,
        'select total_buyers from public.match_summary($1)',
        [rivalListing],
      );
      // Definer rights would otherwise let anyone read demand for any listing.
      expect(rows[0]!.total_buyers).toBe(0);
    });

    it('leaves excluded matches out of the count', async () => {
      await setScore(listing, buyer, 0, true);

      const { rows } = await actingAs<{ total_buyers: number }>(
        db,
        seller,
        'select total_buyers from public.match_summary($1)',
        [listing],
      );
      expect(rows[0]!.total_buyers).toBe(0);
    });
  });

  // ===========================================================================
  // Outreach approval
  // ===========================================================================

  describe('outreach drafts', () => {
    it('lets the seller create a draft', async () => {
      const id = await makeDraft(listing, buyer, seller);
      expect(id).toBeTruthy();
    });

    it('creates it as a draft even when asked for something else', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `insert into public.outreach_drafts (listing_id, recipient_id, created_by, body, status)
           values ($1, $2, $3, 'Pre-approved', 'approved')`,
          [listing, buyer, seller],
        ),
      );
      expect(denial.message).toMatch(/created as a draft and approved separately/i);
    });

    it('refuses to send a draft nobody approved', async () => {
      // The single rule this table exists to hold.
      const id = await makeDraft(listing, buyer, seller);

      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.outreach_drafts set status = 'sent' where id = $1`, [
          id,
        ]),
      );
      expect(denial.message).toMatch(/approved by a person before it can be sent/i);
    });

    it('sends once a person has approved it', async () => {
      const id = await makeDraft(listing, buyer, seller);

      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );
      const sent = await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'sent' where id = $1`,
        [id],
      );
      expect(sent.rowCount).toBe(1);
    });

    it('records who approved it, not who the caller says approved it', async () => {
      const id = await makeDraft(listing, buyer, seller);

      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved', approved_by = $1 where id = $2`,
        [broker, id],
      );

      const { rows } = await db.query<{ approved_by: string }>(
        'select approved_by from public.outreach_drafts where id = $1',
        [id],
      );
      // An approver who can name somebody else as the approver is not a record.
      expect(rows[0]!.approved_by).toBe(seller);
    });

    it('voids approval if the message is rewritten', async () => {
      // Otherwise the approval step is theatre: approve something bland, then
      // change the words before it goes.
      const id = await makeDraft(listing, buyer, seller);
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );

      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `update public.outreach_drafts set body = 'Something else' where id = $1`,
          [id],
        ),
      );
      expect(denial.message).toMatch(/withdraws the approval/i);
    });

    it('refuses to redirect an approved draft to somebody else', async () => {
      const id = await makeDraft(listing, buyer, seller);
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );

      const denial = await expectDenied(() =>
        actingAs(db, seller, 'update public.outreach_drafts set recipient_id = $1 where id = $2', [
          otherBuyer,
          id,
        ]),
      );
      expect(denial.message).toMatch(/cannot be redirected/i);
    });

    it('refuses to unsend', async () => {
      const id = await makeDraft(listing, buyer, seller);
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'sent' where id = $1`,
        [id],
      );

      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.outreach_drafts set status = 'draft' where id = $1`, [
          id,
        ]),
      );
      expect(denial.message).toMatch(/cannot be unsent/i);
    });

    it('refuses to edit a sent message', async () => {
      const id = await makeDraft(listing, buyer, seller);
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'sent' where id = $1`,
        [id],
      );

      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.outreach_drafts set body = 'Rewritten' where id = $1`, [
          id,
        ]),
      );
      expect(denial.message).toMatch(/cannot be edited/i);
    });

    it('hides an unsent draft from its recipient', async () => {
      // A recipient reading a draft the sender has not decided to send would be
      // seeing a decision that has not been made.
      await makeDraft(listing, buyer, seller);

      const { rows } = await actingAs<{ n: string }>(
        db,
        buyer,
        'select count(*)::text as n from public.outreach_drafts',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('shows it to the recipient once sent', async () => {
      const id = await makeDraft(listing, buyer, seller);
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'sent' where id = $1`,
        [id],
      );

      const { rowCount } = await actingAs(db, buyer, 'select id from public.outreach_drafts');
      expect(rowCount).toBe(1);
    });

    it('hides it from somebody who is neither party', async () => {
      const id = await makeDraft(listing, buyer, seller);
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );
      await actingAs(
        db,
        seller,
        `update public.outreach_drafts set status = 'sent' where id = $1`,
        [id],
      );

      const { rows } = await actingAs<{ n: string }>(
        db,
        otherBuyer,
        'select count(*)::text as n from public.outreach_drafts',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('refuses a draft on somebody else listing', async () => {
      const denial = await expectDenied(() => makeDraft(rivalListing, buyer, seller));
      expect(denial.code).toBe('42501');
    });

    it('refuses a recipient approving their own message', async () => {
      const id = await makeDraft(listing, buyer, seller);

      const attempt = await actingAs(
        db,
        buyer,
        `update public.outreach_drafts set status = 'approved' where id = $1`,
        [id],
      );
      // No update policy admits them, so the statement matches nothing.
      expect(attempt.rowCount).toBe(0);
    });
  });

  // ===========================================================================
  // Identity
  // ===========================================================================
  //
  // The correction 0018 makes. The business stays confidential; the people do
  // not. A seller who cannot see who matched cannot decide who to approach, and
  // one shown "identity withheld" on an access request cannot judge whether to
  // release their financials at all.

  describe('who the seller can see', () => {
    beforeEach(async () => {
      await db.query('delete from public.acquisition_criteria');
      await db.query('delete from public.buyer_profiles');
    });

    /** Gives the buyer criteria and a profile, and returns the criteria id. */
    async function makeBuyer(buyerId: string, discoverable: boolean): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.acquisition_criteria (user_id, is_discoverable)
         values ($1, $2) returning id`,
        [buyerId, discoverable],
      );
      await db.query(
        `insert into public.buyer_profiles (user_id, entity_name, funding_source)
         values ($1, 'Okafor Capital LLC', 'SBA 7(a)')
         on conflict (user_id) do update set entity_name = excluded.entity_name`,
        [buyerId],
      );
      return rows[0]!.id;
    }

    async function scoreWithCriteria(
      listingId: string,
      buyerId: string,
      criteriaId: string,
      score: number,
    ): Promise<void> {
      await db.query(
        `insert into public.match_scores (listing_id, buyer_id, criteria_id, score)
         values ($1, $2, $3, $4)
         on conflict (listing_id, buyer_id) do update set score = excluded.score`,
        [listingId, buyerId, criteriaId, score],
      );
    }

    it('names the buyers who matched', async () => {
      const criteria = await makeBuyer(buyer, true);
      await scoreWithCriteria(listing, buyer, criteria, 88);

      const { rows } = await actingAs<{ buyer_id: string; entity_name: string }>(
        db,
        seller,
        'select buyer_id, entity_name from public.matched_buyers($1)',
        [listing],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.entity_name).toBe('Okafor Capital LLC');
    });

    it('hides a buyer who turned discoverability off', async () => {
      // Consent, not a setting nobody reads. A buyer who opts out keeps their
      // own match feed and disappears from every seller's outreach queue.
      const criteria = await makeBuyer(buyer, false);
      await scoreWithCriteria(listing, buyer, criteria, 95);

      const { rows } = await actingAs(
        db,
        seller,
        'select buyer_id from public.matched_buyers($1)',
        [listing],
      );
      expect(rows).toHaveLength(0);
    });

    it('refuses to report on a listing the caller does not control', async () => {
      const criteria = await makeBuyer(buyer, true);
      await scoreWithCriteria(rivalListing, buyer, criteria, 91);

      const { rows } = await actingAs(
        db,
        seller,
        'select buyer_id from public.matched_buyers($1)',
        [rivalListing],
      );
      expect(rows).toHaveLength(0);
    });

    it('carries the seller-fit score and frictions through to the seller', async () => {
      // `scoreSellerFit` was built, tested, and initially wired to nothing —
      // the same gap `scoreFit` had. This asserts the column reaches the
      // function the seller's page actually calls.
      const criteria = await makeBuyer(buyer, true);
      await db.query(
        `insert into public.match_scores
           (listing_id, buyer_id, criteria_id, score, seller_fit_score, seller_frictions)
         values ($1, $2, $3, 88, 42,
           '["This buyer has not settled how they would pay."]'::jsonb)`,
        [listing, buyer, criteria],
      );

      const { rows } = await actingAs<{
        seller_fit_score: number;
        seller_frictions: string[];
      }>(db, seller, 'select seller_fit_score, seller_frictions from public.matched_buyers($1)', [
        listing,
      ]);

      expect(rows[0]!.seller_fit_score).toBe(42);
      expect(rows[0]!.seller_frictions).toHaveLength(1);
    });

    it('leaves the seller-fit score null rather than guessing', async () => {
      // A score computed from defaults would look like a finding. A seller
      // would act on it.
      const criteria = await makeBuyer(buyer, true);
      await scoreWithCriteria(listing, buyer, criteria, 88);

      const { rows } = await actingAs<{ seller_fit_score: number | null }>(
        db,
        seller,
        'select seller_fit_score from public.matched_buyers($1)',
        [listing],
      );
      expect(rows[0]!.seller_fit_score).toBeNull();
    });

    it('lets the seller read a matched buyer profile directly', async () => {
      const criteria = await makeBuyer(buyer, true);
      await scoreWithCriteria(listing, buyer, criteria, 88);

      const { rowCount } = await actingAs(
        db,
        seller,
        'select entity_name from public.buyer_profiles where user_id = $1',
        [buyer],
      );
      expect(rowCount).toBe(1);
    });

    it('does not let an unrelated seller read that profile', async () => {
      const criteria = await makeBuyer(buyer, true);
      await scoreWithCriteria(listing, buyer, criteria, 88);

      const { rows } = await actingAs<{ n: string }>(
        db,
        broker,
        'select count(*)::text as n from public.buyer_profiles',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('does not let one buyer read another buyer profile', async () => {
      const criteria = await makeBuyer(buyer, true);
      await scoreWithCriteria(listing, buyer, criteria, 88);

      const { rows } = await actingAs<{ n: string }>(
        db,
        otherBuyer,
        'select count(*)::text as n from public.buyer_profiles',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('lets a buyer edit their own profile and nobody else', async () => {
      await makeBuyer(buyer, true);

      const own = await actingAs(
        db,
        buyer,
        `update public.buyer_profiles set headline = 'Operator' where user_id = $1`,
        [buyer],
      );
      expect(own.rowCount).toBe(1);

      const other = await actingAs(
        db,
        otherBuyer,
        `update public.buyer_profiles set headline = 'Hijacked' where user_id = $1`,
        [buyer],
      );
      expect(other.rowCount).toBe(0);
    });
  });

  describe('who the buyer can see', () => {
    it('names the person representing a live listing', async () => {
      // The half that was simply missing. A deal offered by nobody in
      // particular does not get taken seriously.
      const { rowCount } = await actingAs(
        db,
        buyer,
        'select full_name from public.profiles where id = $1',
        [seller],
      );
      expect(rowCount).toBe(1);
    });

    it('does not name the seller of a draft listing', async () => {
      const draftOnly = await createAuthUser(db, 'match-draft-seller@example.com');
      await db.query(`insert into public.user_roles (user_id, role) values ($1, 'seller')`, [
        draftOnly,
      ]);
      await db.query(
        `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
         values ($1, 'Unpublished draft listing', 'home_services', 'US-NY')`,
        [draftOnly],
      );

      const { rowCount } = await actingAs(
        db,
        buyer,
        'select full_name from public.profiles where id = $1',
        [draftOnly],
      );
      expect(rowCount).toBe(0);
    });

    it('still does not show the buyer the confidential profile', async () => {
      // Knowing who is selling is not knowing what is for sale. The NDA gate is
      // untouched by any of this.
      await db.query(
        `insert into public.listing_details (listing_id, legal_name)
         values ($1, 'Verification Holdings LLC')
         on conflict (listing_id) do nothing`,
        [listing],
      );

      const { rows } = await actingAs<{ n: string }>(
        db,
        buyer,
        'select count(*)::text as n from public.listing_details',
      );
      expect(rows[0]!.n).toBe('0');
    });
  });

  // ===========================================================================
  // Invariants
  // ===========================================================================

  describe('invariants', () => {
    it('has RLS enabled and forced on both tables', async () => {
      const { rows } = await db.query<{ relname: string }>(
        `select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('match_scores', 'outreach_drafts')
            and (not c.relrowsecurity or not c.relforcerowsecurity)`,
      );
      expect(rows).toEqual([]);
    });

    it('grants no client the ability to write a match score', async () => {
      const { rows } = await db.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where grantee in ('anon','authenticated')
            and table_name = 'match_scores'
            and privilege_type <> 'SELECT'`,
      );
      expect(rows).toEqual([]);
    });

    it('does not expose match_summary to anon', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'match_summary'
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      expect(rows).toEqual([]);
    });
  });
});
