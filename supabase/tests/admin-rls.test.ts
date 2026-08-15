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
 * The admin panel, and the line it must not cross.
 *
 * `admin` carries platform operations — verification, listing review,
 * jurisdictions, audit — and deliberately not access to the confidential half
 * of anybody's business. Building the panel is where that principle stops being
 * a comment and starts being inconvenient, because the easy way to build each
 * screen is broad read access filtered in the UI.
 *
 * Most of this file is therefore about what an administrator still cannot do.
 */
describe.skipIf(!hasDatabase)('admin', () => {
  let db: Client;

  let admin: string;
  let seller: string;
  let buyer: string;
  let listing = '';

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    await db.query(
      `insert into public.jurisdictions (code, name, country_code, is_active)
       values ('US-NY','New York','US',true), ('US-WY','Wyoming','US',false)
       on conflict (code) do update set is_active = excluded.is_active, name = excluded.name`,
    );

    admin = await createAuthUser(db, 'admin-panel@example.com');
    seller = await createAuthUser(db, 'admin-seller@example.com');
    buyer = await createAuthUser(db, 'admin-buyer@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'admin'), ($2,'seller'), ($3,'buyer')`,
      [admin, seller, buyer],
    );
  });

  /*
   * A fresh listing per test, rather than one listing wound back.
   *
   * The first version of this reset did `set status = 'draft'`, which worked
   * until a test approved the listing — and then every later test died in setup,
   * because `enforce_listing_status_transition` refuses `live -> draft`. That
   * refusal is the trigger doing its job: a published listing does not silently
   * become a draft again. Test setup that has to defeat a production invariant
   * to run is testing something other than production.
   */
  beforeEach(async () => {
    if (listing) await db.query('delete from public.listings where id = $1', [listing]);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
       values ($1, 'Admin review test listing', 'home_services', 'US-NY') returning id`,
      [seller],
    );
    listing = rows[0]!.id;

    await db.query(
      `insert into public.listing_details (listing_id, legal_name, revenue_cents)
       values ($1, 'Confidential Holdings LLC', 420000000)`,
      [listing],
    );

    await db.query(
      `update public.profiles set verification_status = 'unverified', verified_at = null`,
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  // ===========================================================================
  // The line
  // ===========================================================================

  describe('admin is not a superuser', () => {
    it('cannot read any confidential listing profile', async () => {
      // The single most important assertion about the admin role. An operator
      // moderating a headline does not need the seller's customer concentration.
      const { rows } = await actingAs<{ n: string }>(
        db,
        admin,
        'select count(*)::text as n from public.listing_details',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('cannot read listing financials either', async () => {
      await db.query(
        `insert into public.listing_financials (listing_id, fiscal_year, revenue_cents)
         values ($1, 2025, 420000000)`,
        [listing],
      );

      const { rows } = await actingAs<{ n: string }>(
        db,
        admin,
        'select count(*)::text as n from public.listing_financials',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('cannot rewrite a seller listing while moderating it', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      const denial = await expectDenied(() =>
        actingAs(
          db,
          admin,
          `update public.listings set headline = 'Rewritten by staff' where id = $1`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/only be moderated by changing its status/i);
    });
  });

  // ===========================================================================
  // Verification
  // ===========================================================================

  describe('verification', () => {
    it('lets an admin verify somebody', async () => {
      const { rowCount } = await actingAs(
        db,
        admin,
        `update public.profiles set verification_status = 'verified' where id = $1`,
        [seller],
      );
      expect(rowCount).toBe(1);
    });

    it('stamps the verification date itself', async () => {
      await actingAs(
        db,
        admin,
        `update public.profiles set verification_status = 'verified', verified_at = '1999-01-01' where id = $1`,
        [seller],
      );

      const { rows } = await db.query<{ year: string }>(
        'select extract(year from verified_at)::text as year from public.profiles where id = $1',
        [seller],
      );
      expect(rows[0]!.year).not.toBe('1999');
    });

    it('clears the date when verification is withdrawn', async () => {
      await actingAs(
        db,
        admin,
        `update public.profiles set verification_status = 'verified' where id = $1`,
        [seller],
      );
      await actingAs(
        db,
        admin,
        `update public.profiles set verification_status = 'rejected' where id = $1`,
        [seller],
      );

      const { rows } = await db.query<{ verified_at: Date | null }>(
        'select verified_at from public.profiles where id = $1',
        [seller],
      );
      expect(rows[0]!.verified_at).toBeNull();
    });

    it('refuses an admin editing anything else on the profile', async () => {
      // Verification is one column. Without this the policy is a general
      // licence to rewrite anybody's account.
      const denial = await expectDenied(() =>
        actingAs(db, admin, `update public.profiles set full_name = 'Renamed' where id = $1`, [
          seller,
        ]),
      );
      expect(denial.message).toMatch(/only change a verification status/i);
    });

    it('refuses somebody verifying themselves', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `update public.profiles set verification_status = 'verified' where id = $1`,
          [seller],
        ),
      );
      expect(denial.message).toMatch(/not by the account holder/i);
    });

    it('still lets a person edit their own name', async () => {
      const { rowCount } = await actingAs(
        db,
        seller,
        `update public.profiles set full_name = 'Sam Reyes' where id = $1`,
        [seller],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a non-admin verifying somebody else', async () => {
      const attempt = await actingAs(
        db,
        buyer,
        `update public.profiles set verification_status = 'verified' where id = $1`,
        [seller],
      );
      // No policy admits them, so the statement matches nothing.
      expect(attempt.rowCount).toBe(0);
    });
  });

  // ===========================================================================
  // The review queue
  // ===========================================================================

  describe('review queue', () => {
    it('shows listings awaiting review', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      const { rows } = await actingAs<{ id: string; has_profile: boolean }>(
        db,
        admin,
        'select id, has_profile from public.listing_review_queue',
      );

      expect(rows).toHaveLength(1);
      // A boolean, not the contents — the reviewer needs to know it is complete,
      // not what it says.
      expect(rows[0]!.has_profile).toBe(true);
    });

    it('excludes drafts and live listings', async () => {
      const { rowCount } = await actingAs(db, admin, 'select id from public.listing_review_queue');
      expect(rowCount).toBe(0);
    });

    it('runs as the caller, not the view owner', async () => {
      // `security_invoker` is the word that keeps this a convenience rather than
      // a hole. Without it the view would hand every caller the whole table.
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      const { rows } = await db.query<{ reloptions: string[] | null }>(
        `select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'listing_review_queue'`,
      );
      expect((rows[0]!.reloptions ?? []).join(',')).toContain('security_invoker=true');
    });

    it('tells the reviewer it is complete without telling them what it says', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      // The completeness helper runs with definer rights, so it is guarded in
      // its own body: a stranger pointing it at somebody else's listing learns
      // nothing, and the admin who may moderate the listing still gets an answer.
      const stranger = await actingAs<{ answer: boolean | null }>(
        db,
        buyer,
        'select app.listing_has_profile($1) as answer',
        [listing],
      );
      expect(stranger.rows[0]!.answer).not.toBe(true);

      const reviewer = await actingAs<{ answer: boolean | null }>(
        db,
        admin,
        'select app.listing_has_profile($1) as answer',
        [listing],
      );
      expect(reviewer.rows[0]!.answer).toBe(true);
    });

    it('lets an admin approve a listing', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      const { rowCount } = await actingAs(
        db,
        admin,
        `update public.listings set status = 'live' where id = $1`,
        [listing],
      );
      expect(rowCount).toBe(1);
    });
  });

  // ===========================================================================
  // Saying why
  // ===========================================================================

  describe('review decisions', () => {
    it('records the reviewer’s reason against the status change', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      const { rows } = await actingAs<{ change_listing_status: number }>(
        db,
        admin,
        `select public.change_listing_status($1, 'draft', $2)`,
        [listing, 'Add at least two years of financials before this can go live.'],
      );
      expect(rows[0]!.change_listing_status).toBe(1);

      const history = await db.query<{ reason: string | null; to_status: string }>(
        `select reason, to_status::text from public.listing_status_history
          where listing_id = $1 order by changed_at desc limit 1`,
        [listing],
      );
      expect(history.rows[0]!.to_status).toBe('draft');
      expect(history.rows[0]!.reason).toMatch(/two years of financials/);
    });

    it('does not let the reason leak into the next status change', async () => {
      await actingAs(db, seller, `select public.change_listing_status($1, 'pending_review', $2)`, [
        listing,
        'Ready for review.',
      ]);
      await actingAs(db, admin, `select public.change_listing_status($1, 'live', null)`, [listing]);

      const { rows } = await db.query<{ reason: string | null }>(
        `select reason from public.listing_status_history
          where listing_id = $1 order by changed_at desc limit 1`,
        [listing],
      );
      expect(rows[0]!.reason).toBeNull();
    });

    it('changes nothing when the caller has no business moving the listing', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);

      // Invoker rights, so the update inside matches zero rows rather than
      // succeeding on borrowed privileges.
      const { rows } = await actingAs<{ change_listing_status: number }>(
        db,
        buyer,
        `select public.change_listing_status($1, 'live', null)`,
        [listing],
      );
      expect(rows[0]!.change_listing_status).toBe(0);

      const after = await db.query<{ status: string }>(
        'select status::text from public.listings where id = $1',
        [listing],
      );
      expect(after.rows[0]!.status).toBe('pending_review');
    });

    it('still refuses an illegal move made through the function', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);
      await actingAs(db, admin, `select public.change_listing_status($1, 'live', null)`, [listing]);

      const denial = await expectDenied(() =>
        actingAs(db, admin, `select public.change_listing_status($1, 'draft', null)`, [listing]),
      );
      expect(denial.message).toMatch(/cannot move a listing from live to draft/i);
    });

    it('keeps the reason away from the market', async () => {
      // The reason is written for the seller. A buyer browsing the listing gets
      // the timeline and no explanation — and cannot ask the table for one.
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);
      await actingAs(db, admin, `select public.change_listing_status($1, 'live', $2)`, [
        listing,
        'Approved after checking the licence number.',
      ]);

      const direct = await actingAs(
        db,
        buyer,
        'select reason from public.listing_status_history where listing_id = $1',
        [listing],
      );
      expect(direct.rowCount).toBe(0);

      const timeline = await actingAs<{ to_status: string }>(
        db,
        buyer,
        'select to_status::text from public.listing_status_timeline where listing_id = $1',
        [listing],
      );
      expect(timeline.rowCount).toBeGreaterThan(0);

      // And the view has no column to leak in the first place.
      const columns = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'listing_status_timeline'`,
      );
      expect(columns.rows.map((c) => c.column_name)).not.toContain('reason');
    });

    it('does not show a stranger the timeline of a listing that is not on the market', async () => {
      /*
       * The test the whole view depends on.
       *
       * `listing_status_timeline` is a SECURITY DEFINER view — it exists to
       * show rows the caller's own policy withholds, so it runs as its owner
       * and bypasses RLS on `listing_status_history` completely. Supabase's
       * linter flags it as an ERROR for exactly that reason, and the linter is
       * right to: the WHERE clause is the *only* thing standing between a
       * stranger and every seller's history.
       *
       * A draft listing is not discoverable and the buyer does not control it,
       * so both surviving branches must be false. If this ever returns a row,
       * the view is publishing when a seller decided to list, when they pulled
       * it, and how many times they tried — for every business on the platform.
       */
      const draft = await db.query<{ id: string }>(
        `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
         values ($1, 'A quiet draft nobody has published', 'home_services', 'US-NY')
         returning id`,
        [seller],
      );
      const draftId = draft.rows[0]!.id;

      // A row exists to be leaked. Written directly, because the seller
      // reaching pending_review is a status change the trigger records.
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        draftId,
      ]);

      const history = await db.query<{ count: string }>(
        'select count(*) as count from public.listing_status_history where listing_id = $1',
        [draftId],
      );
      expect(Number(history.rows[0]!.count)).toBeGreaterThan(0);

      const leaked = await actingAs(
        db,
        buyer,
        'select id from public.listing_status_timeline where listing_id = $1',
        [draftId],
      );
      expect(leaked.rowCount).toBe(0);

      // And the seller still sees their own, which is the half the view is for.
      const own = await actingAs(
        db,
        seller,
        'select id from public.listing_status_timeline where listing_id = $1',
        [draftId],
      );
      expect(own.rowCount).toBeGreaterThan(0);

      await db.query('delete from public.listings where id = $1', [draftId]);
    });

    it('does not let a stranger read the whole timeline table', async () => {
      // The unfiltered version of the same question. A definer view with a
      // correct WHERE clause and a definer view queried without a predicate are
      // the same object; this asks it the way an attacker would.
      const everything = await actingAs<{ listing_id: string }>(
        db,
        buyer,
        'select listing_id from public.listing_status_timeline',
      );

      for (const row of everything.rows) {
        // Whatever comes back must be a listing the market can already see.
        const discoverable = await db.query<{ ok: boolean }>(
          `select status in ('live','under_loi','under_contract') as ok
             from public.listings where id = $1`,
          [row.listing_id],
        );
        expect(discoverable.rows[0]?.ok, row.listing_id).toBe(true);
      }
    });

    it('still shows the seller why their listing came back', async () => {
      await db.query("update public.listings set status = 'pending_review' where id = $1", [
        listing,
      ]);
      await actingAs(db, admin, `select public.change_listing_status($1, 'draft', $2)`, [
        listing,
        'The headline names the business.',
      ]);

      const { rows } = await actingAs<{ reason: string | null }>(
        db,
        seller,
        `select reason from public.listing_status_history
          where listing_id = $1 order by changed_at desc limit 1`,
        [listing],
      );
      expect(rows[0]!.reason).toMatch(/names the business/);
    });
  });

  // ===========================================================================
  // Platform functions
  // ===========================================================================

  describe('platform_stats', () => {
    it('reports counts to an admin', async () => {
      const { rows } = await actingAs<{ active_jurisdictions: number }>(
        db,
        admin,
        'select * from public.platform_stats()',
      );
      expect(rows[0]!.active_jurisdictions).toBe(1);
    });

    it('returns nothing to anybody else', async () => {
      // Definer rights, so the guard has to be inside the function body.
      const { rowCount } = await actingAs(db, seller, 'select * from public.platform_stats()');
      expect(rowCount).toBe(0);
    });
  });

  describe('verification_queue', () => {
    it('lists people with their roles', async () => {
      const { rows } = await actingAs<{ user_id: string; roles: string[] }>(
        db,
        admin,
        'select user_id, roles from public.verification_queue()',
      );

      const sellerRow = rows.find((r) => r.user_id === seller);
      expect(sellerRow?.roles).toContain('seller');
    });

    it('returns nothing to a non-admin', async () => {
      const { rowCount } = await actingAs(db, buyer, 'select * from public.verification_queue()');
      expect(rowCount).toBe(0);
    });

    it('is not callable by anon', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('platform_stats','verification_queue')
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      expect(rows).toEqual([]);
    });
  });

  // ===========================================================================
  // Jurisdictions and audit
  // ===========================================================================

  describe('jurisdictions', () => {
    it('lets an admin switch a state on', async () => {
      const { rowCount } = await actingAs(
        db,
        admin,
        `update public.jurisdictions set is_active = true where code = 'US-WY'`,
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a seller switching one on', async () => {
      const attempt = await actingAs(
        db,
        seller,
        `update public.jurisdictions set is_active = true where code = 'US-WY'`,
      );
      expect(attempt.rowCount).toBe(0);
    });
  });

  describe('audit log', () => {
    it('is readable by an admin', async () => {
      await db.query(
        `insert into public.audit_log (actor_user_id, action, entity_type)
         values ($1, 'test.event', 'test')`,
        [seller],
      );

      const { rowCount } = await actingAs(db, admin, 'select id from public.audit_log');
      expect(rowCount).toBeGreaterThan(0);
    });

    it('cannot be edited or deleted, even by an admin', async () => {
      await db.query(
        `insert into public.audit_log (actor_user_id, action, entity_type)
         values ($1, 'test.event', 'test')`,
        [seller],
      );

      const update = await expectDenied(() =>
        actingAs(db, admin, `update public.audit_log set action = 'rewritten'`),
      );
      expect(update.code).toBe('42501');

      const remove = await expectDenied(() => actingAs(db, admin, 'delete from public.audit_log'));
      expect(remove.code).toBe('42501');
    });
  });
});
