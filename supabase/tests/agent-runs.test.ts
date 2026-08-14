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
 * The orchestrator's record.
 *
 * Two things are being defended here. The first is that a run is a record and
 * not a mutable status field — reopening a finished run would rewrite what the
 * platform told somebody last week. The second is the one that matters
 * commercially: a `draft_outreach` run cannot report success, because
 * succeeding would mean it finished the job, and the job is not finished until
 * a person has read what it wrote.
 */
describe.skipIf(!hasDatabase)('agent runs', () => {
  let db: Client;

  let seller: string;
  let buyer: string;
  let broker: string;
  let admin: string;
  let firm: string;
  let listing: string;

  let run = '';

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    await db.query(
      `insert into public.jurisdictions (code, name, country_code, is_active)
       values ('US-NY','New York','US',true)`,
    );

    seller = await createAuthUser(db, 'agent-seller@example.com');
    buyer = await createAuthUser(db, 'agent-buyer@example.com');
    broker = await createAuthUser(db, 'agent-broker@example.com');
    admin = await createAuthUser(db, 'agent-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'seller'), ($2,'buyer'), ($3,'broker'), ($4,'admin')`,
      [seller, buyer, broker, admin],
    );

    const firmRow = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values ('Anchor Brokerage','brokerage') returning id`,
    );
    firm = firmRow.rows[0]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role) values ($1,$2,'owner')`,
      [firm, broker],
    );

    const listingRow = await db.query<{ id: string }>(
      `insert into public.listings (seller_id, firm_id, headline, industry, jurisdiction_code)
       values ($1, $2, 'A route business', 'home_services', 'US-NY') returning id`,
      [seller, firm],
    );
    listing = listingRow.rows[0]!.id;
  });

  beforeEach(async () => {
    await db.query('delete from public.agent_runs');

    const { rows } = await db.query<{ id: string }>(
      `insert into public.agent_runs (kind, status, listing_id, subject_user_id, firm_id, output)
       values ('analyse_listing', 'succeeded', $1, $2, $3, '{"blocking": 0}'::jsonb)
       returning id`,
      [listing, seller, firm],
    );
    run = rows[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
  });

  // ===========================================================================
  // The stop
  // ===========================================================================

  describe('the human gate', () => {
    it('refuses a drafting run that claims it succeeded', async () => {
      // The outreach table already refuses the send. This refuses the claim
      // that no send was needed — two mechanisms, because this is the one that
      // gets somebody sued.
      const denial = await expectDenied(() =>
        db.query(
          `insert into public.agent_runs (kind, status, listing_id, subject_user_id)
           values ('draft_outreach', 'succeeded', $1, $2)`,
          [listing, seller],
        ),
      );
      expect(denial.message).toMatch(/only a person can finish it/i);
    });

    it('accepts a drafting run that stops for approval', async () => {
      const { rowCount } = await db.query(
        `insert into public.agent_runs (kind, status, listing_id, subject_user_id)
         values ('draft_outreach', 'needs_approval', $1, $2)`,
        [listing, seller],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a drafting run promoted to succeeded after the fact', async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.agent_runs (kind, status, listing_id, subject_user_id)
         values ('draft_outreach', 'queued', $1, $2) returning id`,
        [listing, seller],
      );

      const denial = await expectDenied(() =>
        db.query(`update public.agent_runs set status = 'succeeded' where id = $1`, [rows[0]!.id]),
      );
      expect(denial.message).toMatch(/only a person can finish it/i);
    });
  });

  // ===========================================================================
  // A run is a record
  // ===========================================================================

  describe('immutability', () => {
    it('refuses reopening a finished run', async () => {
      // Re-running produces a new row, so "what did it say last week" stays
      // answerable.
      const denial = await expectDenied(() =>
        db.query(`update public.agent_runs set status = 'running' where id = $1`, [run]),
      );
      expect(denial.message).toMatch(/cannot be reopened/i);
    });

    it('refuses moving a run to another listing', async () => {
      const other = await db.query<{ id: string }>(
        `insert into public.listings (seller_id, headline, industry, jurisdiction_code)
         values ($1, 'Another business', 'construction', 'US-NY') returning id`,
        [seller],
      );

      const denial = await expectDenied(() =>
        db.query('update public.agent_runs set listing_id = $2 where id = $1', [
          run,
          other.rows[0]!.id,
        ]),
      );
      expect(denial.message).toMatch(/another subject/i);
    });

    it('stamps the finish time rather than leaving it absent', async () => {
      const { rows } = await db.query<{ finished_at: Date | null }>(
        'select finished_at from public.agent_runs where id = $1',
        [run],
      );
      expect(rows[0]!.finished_at).not.toBeNull();
    });

    it('refuses a failure with no reason', async () => {
      // A failed step somebody cannot act on is the same as no step at all.
      const denial = await expectDenied(() =>
        db.query(
          `insert into public.agent_runs (kind, status, listing_id) values ('value_listing','failed',$1)`,
          [listing],
        ),
      );
      expect(denial.message).toMatch(/agent_runs_failed_has_reason/);
    });
  });

  // ===========================================================================
  // Who may read it
  // ===========================================================================

  describe('visibility', () => {
    it('shows a seller their own runs', async () => {
      const { rowCount } = await actingAs(db, seller, 'select id from public.agent_runs');
      expect(rowCount).toBe(1);
    });

    it('shows the broker managing the listing', async () => {
      // Telling a broker to ask the seller why the matcher produced what it did
      // is not a workflow.
      const { rowCount } = await actingAs(db, broker, 'select id from public.agent_runs');
      expect(rowCount).toBe(1);
    });

    it('shows a matched buyer nothing', async () => {
      // The output explains the seller's business to the seller. A buyer's view
      // of the same matching is `match_scores`, which is redacted for exactly
      // this reason.
      const { rowCount } = await actingAs(db, buyer, 'select id from public.agent_runs');
      expect(rowCount).toBe(0);
    });

    it('shows a platform admin nothing', async () => {
      const { rowCount } = await actingAs(db, admin, 'select id from public.agent_runs');
      expect(rowCount).toBe(0);
    });

    it('lets nobody write a run', async () => {
      // Runs come from the orchestrator with the service role. A client that
      // could write here could fabricate an approval trail for outreach nobody
      // reviewed.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `insert into public.agent_runs (kind, status, listing_id) values ('match_buyers','succeeded',$1)`,
          [listing],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('lets nobody edit or delete one', async () => {
      const update = await expectDenied(() =>
        actingAs(db, seller, `update public.agent_runs set output = '{}'::jsonb where id = $1`, [
          run,
        ]),
      );
      expect(update.code).toBe('42501');

      const remove = await expectDenied(() =>
        actingAs(db, seller, 'delete from public.agent_runs where id = $1', [run]),
      );
      expect(remove.code).toBe('42501');
    });
  });

  // ===========================================================================
  // The state function
  // ===========================================================================

  describe('listing_pipeline_state', () => {
    it('returns the latest run of each kind, not the latest four runs', async () => {
      // The naive query — order by time, take four — returns four analyses when
      // the analysis has run four times. `distinct on (kind)` is the whole
      // reason this function exists.
      for (let i = 0; i < 4; i += 1) {
        await db.query(
          `insert into public.agent_runs (kind, status, listing_id, subject_user_id, output)
           values ('analyse_listing','succeeded',$1,$2,$3::jsonb)`,
          [listing, seller, JSON.stringify({ pass: i })],
        );
      }
      await db.query(
        `insert into public.agent_runs (kind, status, listing_id, subject_user_id, output)
         values ('value_listing','succeeded',$1,$2,'{}'::jsonb)`,
        [listing, seller],
      );

      const { rows } = await actingAs<{ kind: string; output: { pass?: number } }>(
        db,
        seller,
        'select kind, output from public.listing_pipeline_state($1)',
        [listing],
      );

      expect(rows.map((r) => r.kind).sort()).toEqual(['analyse_listing', 'value_listing']);
      expect(rows.find((r) => r.kind === 'analyse_listing')?.output.pass).toBe(3);
    });

    it('returns nothing for a listing the caller does not control', async () => {
      // Definer rights, so the control check has to be inside the body.
      const { rowCount } = await actingAs(
        db,
        buyer,
        'select * from public.listing_pipeline_state($1)',
        [listing],
      );
      expect(rowCount).toBe(0);
    });

    it('is not callable by anon', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'listing_pipeline_state'
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      expect(rows).toEqual([]);
    });
  });
});
