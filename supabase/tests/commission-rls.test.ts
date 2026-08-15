import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { calculateCommission } from '@ib/core';

import {
  actingAs,
  applyMigrations,
  connect,
  createAuthUser,
  expectDenied,
  hasDatabase,
} from './helpers';

/**
 * Fee agreements and commission records.
 *
 * Two rules carry this file:
 *
 *   1. **Money is firm business.** A broker sees their own firm's fees and
 *      nobody else's — a competitor learning what a rival charges is a
 *      commercial disclosure the firm never made.
 *   2. **A closed fee is a record.** Once earned, the amounts are frozen and a
 *      settled fee cannot be reopened. A commission record whose numbers can
 *      move afterwards is not a record of anything.
 */
describe.skipIf(!hasDatabase)('commission', () => {
  let db: Client;

  let owner: string;
  let member: string;
  let rival: string;

  let firm: string;
  let rivalFirm: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    owner = await createAuthUser(db, 'fee-owner@example.com');
    member = await createAuthUser(db, 'fee-member@example.com');
    rival = await createAuthUser(db, 'fee-rival@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'broker'), ($2,'broker'), ($3,'broker')`,
      [owner, member, rival],
    );

    const firms = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values ('Ridge Brokerage','brokerage'), ('Rival Brokerage','brokerage') returning id`,
    );
    firm = firms.rows[0]!.id;
    rivalFirm = firms.rows[1]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role) values ($1,$2,'owner'), ($1,$3,'member'), ($4,$5,'owner')`,
      [firm, owner, member, rivalFirm, rival],
    );
  });

  beforeEach(async () => {
    await db.query('delete from public.commission_records');
    await db.query('delete from public.fee_agreements');
  });

  afterAll(async () => {
    await db?.end();
  });

  async function makeAgreement(firmId: string, asUser: string) {
    const { rows } = await actingAs<{ id: string }>(
      db,
      asUser,
      `insert into public.fee_agreements (firm_id, structure, minimum_fee_cents, created_by)
       values ($1, 'double_lehman', 5000000, $2) returning id`,
      [firmId, asUser],
    );
    return rows[0]!.id;
  }

  /** Writes a record the way the application does — from the core calculator. */
  async function makeRecord(firmId: string, salePriceCents: number, status = 'projected') {
    const result = calculateCommission(
      { structure: 'double_lehman', minimumFeeCents: 5_000_000 },
      salePriceCents,
    );

    const { rows } = await db.query<{ id: string }>(
      `insert into public.commission_records
         (firm_id, status, sale_price_cents, calculated_fee_cents, total_fee_cents,
          co_broker_fee_cents, net_fee_cents, bands, closed_at)
       values ($1, $2::app.commission_status, $3, $4, $5, $6, $7, $8::jsonb,
               case when $2::text in ('earned','settled') then now() end)
       returning id`,
      [
        firmId,
        status,
        salePriceCents,
        result.calculatedFeeCents,
        result.totalFeeCents,
        result.coBrokerFeeCents,
        result.netFeeCents,
        JSON.stringify(result.bands),
      ],
    );
    return rows[0]!.id;
  }

  describe('fee agreements', () => {
    it('lets a firm owner create one', async () => {
      expect(await makeAgreement(firm, owner)).toBeTruthy();
    });

    it('refuses a plain member', async () => {
      // A fee schedule decides what everyone at the firm gets paid.
      const denial = await expectDenied(() => makeAgreement(firm, member));
      expect(denial.code).toBe('42501');
    });

    it('refuses somebody at another firm', async () => {
      const denial = await expectDenied(() => makeAgreement(firm, rival));
      expect(denial.code).toBe('42501');
    });

    it('lets any member of the firm read it', async () => {
      await makeAgreement(firm, owner);
      const { rowCount } = await actingAs(db, member, 'select id from public.fee_agreements');
      expect(rowCount).toBe(1);
    });

    it('hides it from a rival firm', async () => {
      // What a brokerage charges is commercially sensitive to that brokerage.
      await makeAgreement(firm, owner);

      const { rows } = await actingAs<{ n: string }>(
        db,
        rival,
        'select count(*)::text as n from public.fee_agreements',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('refuses a flat structure with no rate', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          owner,
          `insert into public.fee_agreements (firm_id, structure, created_by) values ($1, 'flat', $2)`,
          [firm, owner],
        ),
      );
      expect(denial.code).toBe('23514');
    });

    it('refuses a tiered structure with no tiers', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          owner,
          `insert into public.fee_agreements (firm_id, structure, created_by) values ($1, 'tiered', $2)`,
          [firm, owner],
        ),
      );
      expect(denial.code).toBe('23514');
    });

    it('refuses deleting one', async () => {
      await makeAgreement(firm, owner);
      const denial = await expectDenied(() =>
        actingAs(db, owner, 'delete from public.fee_agreements'),
      );
      expect(denial.code).toBe('42501');
    });
  });

  describe('commission records', () => {
    it('requires the parts to sum to the total', async () => {
      // A statement whose lines do not add up is one nobody trusts.
      const denial = await expectDenied(() =>
        db.query(
          `insert into public.commission_records
             (firm_id, sale_price_cents, calculated_fee_cents, total_fee_cents, co_broker_fee_cents, net_fee_cents)
           values ($1, 100000000, 10000000, 10000000, 3000000, 3000000)`,
          [firm],
        ),
      );
      expect(denial.code).toBe('23514');
    });

    it('requires a close date once earned', async () => {
      const denial = await expectDenied(() =>
        db.query(
          `insert into public.commission_records
             (firm_id, status, sale_price_cents, calculated_fee_cents, total_fee_cents, net_fee_cents)
           values ($1, 'earned', 100000000, 10000000, 10000000, 10000000)`,
          [firm],
        ),
      );
      expect(denial.code).toBe('23514');
    });

    it('requires a reason to waive', async () => {
      // A write-off with no stated reason cannot be explained in an audit.
      const denial = await expectDenied(() =>
        db.query(
          `insert into public.commission_records
             (firm_id, status, sale_price_cents, calculated_fee_cents, total_fee_cents, net_fee_cents)
           values ($1, 'waived', 100000000, 10000000, 10000000, 10000000)`,
          [firm],
        ),
      );
      expect(denial.code).toBe('23514');
    });

    it('freezes the amounts once earned', async () => {
      const record = await makeRecord(firm, 200_000_000, 'earned');

      const denial = await expectDenied(() =>
        actingAs(
          db,
          owner,
          'update public.commission_records set total_fee_cents = 1 where id = $1',
          [record],
        ),
      );
      expect(denial.message).toMatch(/cannot be changed/i);
    });

    it('leaves a projected record editable', async () => {
      // Before closing, the price is an estimate and revising it is normal.
      const record = await makeRecord(firm, 200_000_000);

      const { rowCount } = await actingAs(
        db,
        owner,
        'update public.commission_records set sale_price_cents = 250000000 where id = $1',
        [record],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses settling a fee that was never earned', async () => {
      const record = await makeRecord(firm, 200_000_000);

      const denial = await expectDenied(() =>
        actingAs(
          db,
          owner,
          `update public.commission_records set status = 'settled' where id = $1`,
          [record],
        ),
      );
      expect(denial.message).toMatch(/must be earned/i);
    });

    it('stamps the settlement date itself', async () => {
      const record = await makeRecord(firm, 200_000_000, 'earned');
      await actingAs(
        db,
        owner,
        `update public.commission_records set status = 'settled' where id = $1`,
        [record],
      );

      const { rows } = await db.query<{ settled_at: Date | null }>(
        'select settled_at from public.commission_records where id = $1',
        [record],
      );
      expect(rows[0]!.settled_at).not.toBeNull();
    });

    it('treats settled as terminal', async () => {
      // An accountant has relied on it by then.
      const record = await makeRecord(firm, 200_000_000, 'earned');
      await actingAs(
        db,
        owner,
        `update public.commission_records set status = 'settled' where id = $1`,
        [record],
      );

      const denial = await expectDenied(() =>
        actingAs(
          db,
          owner,
          `update public.commission_records set status = 'earned' where id = $1`,
          [record],
        ),
      );
      expect(denial.message).toMatch(/cannot be reopened/i);
    });

    it('refuses reassigning a record to another firm', async () => {
      const record = await makeRecord(firm, 200_000_000);

      const denial = await expectDenied(() =>
        actingAs(db, owner, 'update public.commission_records set firm_id = $1 where id = $2', [
          rivalFirm,
          record,
        ]),
      );
      expect(denial.message).toMatch(/cannot be reassigned/i);
    });

    it('hides a firm records from a rival', async () => {
      await makeRecord(firm, 200_000_000, 'earned');

      const { rows } = await actingAs<{ n: string }>(
        db,
        rival,
        'select count(*)::text as n from public.commission_records',
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('refuses a plain member writing one', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          member,
          `insert into public.commission_records (firm_id, sale_price_cents, calculated_fee_cents, total_fee_cents, net_fee_cents)
           values ($1, 100000000, 10000000, 10000000, 10000000)`,
          [firm],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('refuses deleting one', async () => {
      // A mistaken fee is waived with a reason, which leaves a trail.
      await makeRecord(firm, 200_000_000);
      const denial = await expectDenied(() =>
        actingAs(db, owner, 'delete from public.commission_records'),
      );
      expect(denial.code).toBe('42501');
    });
  });

  describe('the calculator agrees with what is stored', () => {
    it('stores what calculateCommission produced, band for band', async () => {
      // The stored row and the core function are the same fee expressed twice.
      // Drift between them means a statement that cannot be reproduced.
      const record = await makeRecord(firm, 450_000_000);
      const expected = calculateCommission(
        { structure: 'double_lehman', minimumFeeCents: 5_000_000 },
        450_000_000,
      );

      const { rows } = await db.query<{ total_fee_cents: string; bands: unknown[] }>(
        'select total_fee_cents, bands from public.commission_records where id = $1',
        [record],
      );

      expect(Number(rows[0]!.total_fee_cents)).toBe(expected.totalFeeCents);
      expect(rows[0]!.bands).toHaveLength(expected.bands.length);
    });
  });
});
