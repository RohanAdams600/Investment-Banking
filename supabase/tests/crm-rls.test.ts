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
 * The CRM.
 *
 * A brokerage's pipeline is the most commercially sensitive thing it owns — it
 * *is* the business — so most of this file is one assertion in different
 * clothes: a broker at another firm sees nothing.
 *
 * The second theme is that a contact is not a user. Almost everybody in a real
 * pipeline has never signed up, so the tests work with contacts that have no
 * `user_id` and check that the schema is happy about it.
 */
describe.skipIf(!hasDatabase)('crm', () => {
  let db: Client;

  let brokerA: string;
  let colleagueA: string;
  let brokerB: string;
  let soloSeller: string;
  let admin: string;

  let firmA: string;
  let firmB: string;

  let contact = '';

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    brokerA = await createAuthUser(db, 'crm-broker-a@example.com');
    colleagueA = await createAuthUser(db, 'crm-colleague-a@example.com');
    brokerB = await createAuthUser(db, 'crm-broker-b@example.com');
    soloSeller = await createAuthUser(db, 'crm-solo@example.com');
    admin = await createAuthUser(db, 'crm-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'broker'), ($2,'broker'), ($3,'broker'), ($4,'seller'), ($5,'admin')`,
      [brokerA, colleagueA, brokerB, soloSeller, admin],
    );

    const firms = await db.query<{ id: string }>(
      `insert into public.firms (name, kind)
       values ('Anchor Brokerage','brokerage'), ('Rival Brokerage','brokerage')
       returning id`,
    );
    firmA = firms.rows[0]!.id;
    firmB = firms.rows[1]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role)
       values ($1,$2,'owner'), ($1,$3,'member'), ($4,$5,'owner')`,
      [firmA, brokerA, colleagueA, firmB, brokerB],
    );
  });

  beforeEach(async () => {
    // Leads first. `leads.contact_id` is `on delete restrict`, so a reset that
    // starts with contacts is refused — which is the constraint working, not
    // something the reset should route around.
    await db.query('delete from public.crm_tasks');
    await db.query('delete from public.crm_notes');
    await db.query('delete from public.leads');
    await db.query('delete from public.contacts');
    await db.query('delete from public.pipeline_stages');

    const { rows } = await db.query<{ id: string }>(
      `insert into public.contacts (firm_id, full_name, email, kind, created_by)
       values ($1, 'Dana Whitfield', 'dana@example.com', 'buyer', $2) returning id`,
      [firmA, brokerA],
    );
    contact = rows[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
  });

  // ===========================================================================
  // The firm boundary
  // ===========================================================================

  describe('the firm boundary', () => {
    it('shows a firm its own contacts', async () => {
      const { rowCount } = await actingAs(db, brokerA, 'select id from public.contacts');
      expect(rowCount).toBe(1);
    });

    it('shows a colleague at the same firm the same contacts', async () => {
      // A CRM that is private per broker is a CRM that loses the pipeline when
      // somebody leaves. The firm is the boundary, not the individual.
      const { rowCount } = await actingAs(db, colleagueA, 'select id from public.contacts');
      expect(rowCount).toBe(1);
    });

    it('shows a rival brokerage nothing at all', async () => {
      const { rowCount } = await actingAs(db, brokerB, 'select id from public.contacts');
      expect(rowCount).toBe(0);
    });

    it('shows a platform admin nothing either', async () => {
      // Deliberately no admin branch. Operations verifies people and moderates
      // listings; who a brokerage is talking to is none of its business, and an
      // escape hatch "for support" is how that stops being true.
      const { rowCount } = await actingAs(db, admin, 'select id from public.contacts');
      expect(rowCount).toBe(0);
    });

    it('refuses a rival writing a contact into somebody else’s firm', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          brokerB,
          `insert into public.contacts (firm_id, full_name) values ($1, 'Planted')`,
          [firmA],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses moving a contact to another firm', async () => {
      // The UPDATE policy's WITH CHECK is what catches this: the row would be
      // visible when USING ran and belong to somebody else afterwards.
      const attempt = await actingAs(
        db,
        brokerA,
        'update public.contacts set firm_id = $2 where id = $1',
        [contact, firmB],
      ).catch((error: { code?: string }) => error);

      expect((attempt as { code?: string }).code).toBe('42501');
    });
  });

  // ===========================================================================
  // A contact is not a user
  // ===========================================================================

  describe('contacts', () => {
    it('accepts somebody who has never signed up', async () => {
      // The normal case. Almost nobody in a real pipeline has an account.
      const { rows } = await actingAs<{ user_id: string | null }>(
        db,
        brokerA,
        'select user_id from public.contacts where id = $1',
        [contact],
      );
      expect(rows[0]!.user_id).toBeNull();
    });

    it('links to a user when that person eventually signs up', async () => {
      const { rowCount } = await actingAs(
        db,
        brokerA,
        'update public.contacts set user_id = $2 where id = $1',
        [contact, soloSeller],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a row that belongs to neither a firm nor a person', async () => {
      // Such a row is invisible to every policy — a leak in the other
      // direction, where data exists that nobody can reach or delete.
      const denial = await expectDenied(() =>
        db.query(`insert into public.contacts (full_name) values ('Orphan')`),
      );
      expect(denial.message).toMatch(/contacts_has_one_owner/);
    });

    it('refuses a row that belongs to both', async () => {
      const denial = await expectDenied(() =>
        db.query(
          `insert into public.contacts (firm_id, owner_id, full_name) values ($1,$2,'Both')`,
          [firmA, brokerA],
        ),
      );
      expect(denial.message).toMatch(/contacts_has_one_owner/);
    });
  });

  // ===========================================================================
  // Dedupe
  // ===========================================================================

  describe('deduplication', () => {
    it('refuses the same email twice in one firm', async () => {
      // The same person inquires on three listings and fills in the contact
      // form twice. Calling them five times is how a brokerage loses a referral
      // source, so Postgres refuses the duplicate rather than a nightly job
      // merging it later.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          brokerA,
          `insert into public.contacts (firm_id, full_name, email) values ($1, 'Dana W', 'dana@example.com')`,
          [firmA],
        ),
      );
      expect(denial.code).toBe('23505');
    });

    it('treats a differently-cased email as the same person', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          brokerA,
          `insert into public.contacts (firm_id, full_name, email) values ($1, 'Dana W', 'DANA@Example.com')`,
          [firmA],
        ),
      );
      expect(denial.code).toBe('23505');
    });

    it('lets two firms each hold the same person', async () => {
      // Not a duplicate. The same buyer talking to two brokerages is one person
      // and two relationships, and neither firm may see the other's.
      const { rowCount } = await actingAs(
        db,
        brokerB,
        `insert into public.contacts (firm_id, full_name, email) values ($1, 'Dana Whitfield', 'dana@example.com')`,
        [firmB],
      );
      expect(rowCount).toBe(1);
    });

    it('allows several contacts with no email', async () => {
      // A phone-only lead off a yard sign is legitimate, and nulls must not
      // collide with each other.
      await actingAs(
        db,
        brokerA,
        `insert into public.contacts (firm_id, full_name, phone) values ($1, 'Caller one', '555-0100')`,
        [firmA],
      );
      const { rowCount } = await actingAs(
        db,
        brokerA,
        `insert into public.contacts (firm_id, full_name, phone) values ($1, 'Caller two', '555-0101')`,
        [firmA],
      );
      expect(rowCount).toBe(1);
    });
  });

  // ===========================================================================
  // Solo sellers
  // ===========================================================================

  describe('a seller with no firm', () => {
    it('keeps their own contacts', async () => {
      await actingAs(
        db,
        soloSeller,
        `insert into public.contacts (owner_id, full_name, email) values ($1, 'My accountant', 'cpa@example.com')`,
        [soloSeller],
      );

      const mine = await actingAs(db, soloSeller, 'select id from public.contacts');
      expect(mine.rowCount).toBe(1);

      // ...and the brokerage's contacts are not among them.
      const theirs = await actingAs(db, brokerA, 'select id from public.contacts');
      expect(theirs.rowCount).toBe(1);
    });

    it('cannot claim a contact for somebody else', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          soloSeller,
          `insert into public.contacts (owner_id, full_name) values ($1, 'Not mine')`,
          [brokerA],
        ),
      );
      expect(denial.code).toBe('42501');
    });
  });

  // ===========================================================================
  // Pipeline
  // ===========================================================================

  describe('pipeline stages', () => {
    it('seeds a working board for a firm', async () => {
      const { rows } = await actingAs<{ seed_pipeline_stages: number }>(
        db,
        brokerA,
        'select public.seed_pipeline_stages($1)',
        [firmA],
      );
      expect(rows[0]!.seed_pipeline_stages).toBe(7);
    });

    it('does nothing the second time', async () => {
      await actingAs(db, brokerA, 'select public.seed_pipeline_stages($1)', [firmA]);

      const { rows } = await actingAs<{ seed_pipeline_stages: number }>(
        db,
        brokerA,
        'select public.seed_pipeline_stages($1)',
        [firmA],
      );
      expect(rows[0]!.seed_pipeline_stages).toBe(0);
    });

    it('refuses to seed a board for a firm the caller has no part in', async () => {
      // Invoker rights, so the insert inside goes through `pipeline_stages_own`
      // rather than around it — and an INSERT that fails a policy raises rather
      // than quietly inserting nothing. The louder answer is the right one
      // here: pointing this at another firm's id is not a near-miss.
      const denial = await expectDenied(() =>
        actingAs(db, brokerB, 'select public.seed_pipeline_stages($1)', [firmA]),
      );
      expect(denial.code).toBe('42501');
    });

    it('gives a solo seller their own board', async () => {
      const { rows } = await actingAs<{ seed_pipeline_stages: number }>(
        db,
        soloSeller,
        'select public.seed_pipeline_stages()',
      );
      expect(rows[0]!.seed_pipeline_stages).toBe(7);

      const visible = await actingAs(db, brokerA, 'select id from public.pipeline_stages');
      expect(visible.rowCount).toBe(0);
    });

    it('refuses a won stage that is not terminal', async () => {
      // "Closed won, and the lead carries on" is not a state anybody means.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          brokerA,
          `insert into public.pipeline_stages (firm_id, name, position, is_terminal, is_won)
           values ($1, 'Nonsense', 9, false, true)`,
          [firmA],
        ),
      );
      expect(denial.message).toMatch(/pipeline_stages_won_is_terminal/);
    });

    it('refuses two stages in the same position', async () => {
      await actingAs(
        db,
        brokerA,
        `insert into public.pipeline_stages (firm_id, name, position) values ($1, 'First', 0)`,
        [firmA],
      );

      const denial = await expectDenied(() =>
        actingAs(
          db,
          brokerA,
          `insert into public.pipeline_stages (firm_id, name, position) values ($1, 'Also first', 0)`,
          [firmA],
        ),
      );
      expect(denial.code).toBe('23505');
    });
  });

  // ===========================================================================
  // Leads
  // ===========================================================================

  describe('leads', () => {
    async function makeLead(): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.leads (firm_id, contact_id, source, message)
         values ($1, $2, 'listing_inquiry', 'Interested in the route business') returning id`,
        [firmA, contact],
      );
      return rows[0]!.id;
    }

    it('is visible to the firm and to nobody else', async () => {
      await makeLead();

      const mine = await actingAs(db, brokerA, 'select id from public.leads');
      const rival = await actingAs(db, brokerB, 'select id from public.leads');

      expect([mine.rowCount, rival.rowCount]).toEqual([1, 0]);
    });

    it('refuses to be marked converted without a timestamp', async () => {
      // "How many inquiries turn into something" has to be answerable from the
      // row rather than reconstructed from the audit log.
      const lead = await makeLead();

      const denial = await expectDenied(() =>
        actingAs(db, brokerA, `update public.leads set status = 'converted' where id = $1`, [lead]),
      );
      expect(denial.message).toMatch(/leads_converted_has_timestamp/);
    });

    it('accepts a conversion that records when', async () => {
      const lead = await makeLead();

      const { rowCount } = await actingAs(
        db,
        brokerA,
        `update public.leads set status = 'converted', converted_at = now() where id = $1`,
        [lead],
      );
      expect(rowCount).toBe(1);
    });

    it('does not let a contact with history be deleted out from under it', async () => {
      // `on delete restrict`. Tidying a contact that a lead points at is a
      // deliberate act, not a side effect.
      await makeLead();

      const denial = await expectDenied(() =>
        actingAs(db, brokerA, 'delete from public.contacts where id = $1', [contact]),
      );
      expect(denial.code).toBe('23503');
    });

    it('keeps the lead when the listing it came from goes away', async () => {
      // A lead outlives the listing that produced it, and usually becomes a
      // lead on the next one.
      await db.query(
        `insert into public.jurisdictions (code, name, country_code, is_active)
         values ('US-TX','Texas','US',true) on conflict do nothing`,
      );

      const listing = await db.query<{ id: string }>(
        `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
         values ($1, 'A business', 'home_services', 'US-TX') returning id`,
        [brokerA],
      );
      const listingId = listing.rows[0]!.id;

      await db.query(
        `insert into public.leads (firm_id, contact_id, listing_id) values ($1,$2,$3)`,
        [firmA, contact, listingId],
      );

      await db.query('delete from public.listings where id = $1', [listingId]);

      const { rows } = await actingAs<{ listing_id: string | null }>(
        db,
        brokerA,
        'select listing_id from public.leads',
      );
      expect(rows[0]!.listing_id).toBeNull();
    });
  });

  // ===========================================================================
  // Notes and tasks
  // ===========================================================================

  describe('notes', () => {
    it('follows the contact’s boundary', async () => {
      await actingAs(
        db,
        brokerA,
        `insert into public.crm_notes (contact_id, author_id, body) values ($1, $2, 'Left a voicemail')`,
        [contact, brokerA],
      );

      const mine = await actingAs(db, brokerA, 'select id from public.crm_notes');
      const rival = await actingAs(db, brokerB, 'select id from public.crm_notes');

      expect([mine.rowCount, rival.rowCount]).toEqual([1, 0]);
    });

    it('refuses a note attached to nothing', async () => {
      const denial = await expectDenied(() =>
        db.query(`insert into public.crm_notes (author_id, body) values ($1, 'Floating')`, [
          brokerA,
        ]),
      );
      expect(denial.message).toMatch(/crm_notes_has_subject/);
    });

    it('refuses a note on somebody else’s contact', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          brokerB,
          `insert into public.crm_notes (contact_id, body) values ($1, 'Prying')`,
          [contact],
        ),
      );
      expect(denial.code).toBe('42501');
    });
  });

  describe('tasks', () => {
    async function makeTask(): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.crm_tasks (firm_id, contact_id, title, assigned_to, created_by)
         values ($1, $2, 'Call Dana back', $3, $3) returning id`,
        [firmA, contact, brokerA],
      );
      return rows[0]!.id;
    }

    it('stamps who completed it rather than believing the client', async () => {
      const task = await makeTask();

      await actingAs(
        db,
        colleagueA,
        `update public.crm_tasks set status = 'done', completed_by = $2 where id = $1`,
        [task, brokerA],
      );

      const { rows } = await db.query<{ completed_by: string }>(
        'select completed_by from public.crm_tasks where id = $1',
        [task],
      );
      expect(rows[0]!.completed_by).toBe(colleagueA);
    });

    it('stamps the completion time itself', async () => {
      const task = await makeTask();

      await actingAs(
        db,
        brokerA,
        `update public.crm_tasks set status = 'done', completed_at = '1999-01-01' where id = $1`,
        [task],
      );

      const { rows } = await db.query<{ year: string }>(
        'select extract(year from completed_at)::text as year from public.crm_tasks where id = $1',
        [task],
      );
      expect(rows[0]!.year).not.toBe('1999');
    });

    it('clears the completion when a task is reopened', async () => {
      const task = await makeTask();

      await actingAs(db, brokerA, `update public.crm_tasks set status = 'done' where id = $1`, [
        task,
      ]);
      await actingAs(db, brokerA, `update public.crm_tasks set status = 'open' where id = $1`, [
        task,
      ]);

      const { rows } = await db.query<{ completed_at: Date | null; completed_by: string | null }>(
        'select completed_at, completed_by from public.crm_tasks where id = $1',
        [task],
      );
      expect(rows[0]!.completed_at).toBeNull();
      expect(rows[0]!.completed_by).toBeNull();
    });

    it('is invisible to another firm', async () => {
      await makeTask();
      const { rowCount } = await actingAs(db, brokerB, 'select id from public.crm_tasks');
      expect(rowCount).toBe(0);
    });
  });

  // ===========================================================================
  // Grants
  // ===========================================================================

  describe('grants', () => {
    it('does not let anon reach the CRM helpers', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and p.proname in ('owns_crm_row','owns_crm_note')
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      expect(rows).toEqual([]);
    });

    it('allows deletion, unlike the rest of the schema', async () => {
      // Stated as a test because it is the exception. An NDA and a commission
      // record are what happened to other people; a contact typed in wrong is
      // the firm's own working data, and a CRM you cannot tidy is one people
      // stop using.
      const { rowCount } = await actingAs(
        db,
        brokerA,
        'delete from public.contacts where id = $1',
        [contact],
      );
      expect(rowCount).toBe(1);
    });
  });
});
