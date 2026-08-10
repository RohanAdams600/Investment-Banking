import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { PLATFORM_ROLES, can, type Actor, type PlatformRole } from '@ib/core';

import {
  actingAs,
  applyMigrations,
  connect,
  createAuthUser,
  expectDenied,
  hasDatabase,
} from './helpers';

/**
 * Opening a deal.
 *
 * This is the route into the deal room, and before 0014 there was none — every
 * messaging policy keys on conversation membership, and membership could only
 * be granted by an existing administrator, so nothing could ever be created.
 * These tests cover the way in, and that it is not a way around.
 */
describe.skipIf(!hasDatabase)('deal creation', () => {
  let db: Client;

  let seller: string;
  let broker: string;
  let buyer: string;
  let roleless: string;

  let brokerFirm: string;
  let otherFirm: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'deal-seller@example.com');
    broker = await createAuthUser(db, 'deal-broker@example.com');
    buyer = await createAuthUser(db, 'deal-buyer@example.com');
    roleless = await createAuthUser(db, 'deal-roleless@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values
         ($1,'seller'), ($2,'broker'), ($3,'buyer')`,
      [seller, broker, buyer],
    );

    const firms = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values
         ('Broker Firm','brokerage'), ('Unrelated Firm','private_equity') returning id`,
    );
    brokerFirm = firms.rows[0]!.id;
    otherFirm = firms.rows[1]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'owner')`,
      [brokerFirm, broker],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  // -------------------------------------------------------------------------

  describe('capability parity', () => {
    it('agrees with the TypeScript capability model on who may open a deal', async () => {
      // `deal:create` in the capability catalog and `app.can_create_deal()` in
      // SQL are the same rule expressed twice, because the database cannot
      // import TypeScript. Drift between them would mean the UI offers an
      // action the database refuses, or worse, the reverse.
      const actor = (roles: PlatformRole[]): Actor => ({
        userId: 'u',
        platformRoles: roles,
        firmMemberships: [],
      });

      for (const role of PLATFORM_ROLES) {
        const user = await createAuthUser(db, `parity-${role}@example.com`);
        await db.query('insert into public.user_roles (user_id, role) values ($1, $2)', [
          user,
          role,
        ]);

        const { rows } = await actingAs<{ allowed: boolean }>(
          db,
          user,
          'select app.can_create_deal() as allowed',
        );

        expect(rows[0]!.allowed, `${role} in SQL`).toBe(can(actor([role]), 'deal:create'));
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('create_deal', () => {
    it('creates the deal, a first conversation, and seats the creator as banker', async () => {
      const { rows } = await actingAs<{ create_deal: string }>(
        db,
        seller,
        `select public.create_deal('Project Anchor', 'Buyer and seller') as create_deal`,
      );
      const dealId = rows[0]!.create_deal;

      const conversation = await db.query<{ id: string; name: string }>(
        'select id, name from public.deal_conversations where deal_id = $1',
        [dealId],
      );
      expect(conversation.rows).toHaveLength(1);
      expect(conversation.rows[0]!.name).toBe('Buyer and seller');

      const membership = await db.query<{ role: string }>(
        'select role from public.conversation_members where conversation_id = $1 and user_id = $2',
        [conversation.rows[0]!.id, seller],
      );
      // Banker, not seller: the creator has to be able to bring the other side
      // in, and only banker/admin can administer membership.
      expect(membership.rows[0]!.role).toBe('banker');
    });

    it('leaves the deal immediately visible and usable to its creator', async () => {
      const created = await actingAs<{ create_deal: string }>(
        db,
        seller,
        `select public.create_deal('Project Visible') as create_deal`,
      );
      const dealId = created.rows[0]!.create_deal;

      // The bug this whole migration exists to prevent: a deal that nobody,
      // including its author, can see.
      const visible = await actingAs(db, seller, 'select id from public.deals where id = $1', [
        dealId,
      ]);
      expect(visible.rows).toHaveLength(1);

      const conversation = await actingAs<{ id: string }>(
        db,
        seller,
        'select id from public.deal_conversations where deal_id = $1',
        [dealId],
      );
      expect(conversation.rows).toHaveLength(1);

      // And can actually post in it.
      const sent = await actingAs(
        db,
        seller,
        `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'First')`,
        [conversation.rows[0]!.id, seller],
      );
      expect(sent.rowCount).toBe(1);
    });

    it('never leaves a deal without a conversation, or a conversation without a member', async () => {
      const { rows } = await db.query<{ orphan_deals: string; orphan_conversations: string }>(
        `select
           (select count(*)::text from public.deals d
             where not exists (select 1 from public.deal_conversations c where c.deal_id = d.id))
             as orphan_deals,
           (select count(*)::text from public.deal_conversations c
             where not exists (
               select 1 from public.conversation_members m
                where m.conversation_id = c.id and m.role in ('banker','admin')))
             as orphan_conversations`,
      );

      expect(rows[0]!.orphan_deals).toBe('0');
      expect(rows[0]!.orphan_conversations).toBe('0');
    });

    it('refuses a buyer', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, buyer, `select public.create_deal('Buyer Attempt')`),
      );

      expect(denial.message).toMatch(/seller, broker or admin/i);
    });

    it('refuses a user with no roles', async () => {
      // A fresh account holds nothing until onboarding. Deny by default has to
      // extend to this route or registration becomes the way around it.
      const denial = await expectDenied(() =>
        actingAs(db, roleless, `select public.create_deal('Roleless Attempt')`),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses direct inserts into deals, bypassing the function', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, seller, `insert into public.deals (name) values ('Bypass')`),
      );

      expect(denial.code).toBe('42501');
    });

    it('lets a broker attach a firm they belong to', async () => {
      const { rows } = await actingAs<{ create_deal: string }>(
        db,
        broker,
        `select public.create_deal('Firm Deal', 'General', 'buyer_seller', $1) as create_deal`,
        [brokerFirm],
      );

      const check = await db.query<{ firm_id: string }>(
        'select firm_id from public.deals where id = $1',
        [rows[0]!.create_deal],
      );
      expect(check.rows[0]!.firm_id).toBe(brokerFirm);
    });

    it('refuses attaching a firm the caller does not belong to', async () => {
      // Otherwise the caller-supplied id lets anyone attribute their deal to any
      // firm on the platform — and firm membership drives visibility.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          broker,
          `select public.create_deal('Misattributed', 'General', 'buyer_seller', $1)`,
          [otherFirm],
        ),
      );

      expect(denial.message).toMatch(/not a member of that firm/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('create_deal_conversation', () => {
    let dealId: string;
    let firstConversation: string;

    beforeAll(async () => {
      const created = await actingAs<{ create_deal: string }>(
        db,
        seller,
        `select public.create_deal('Project Rooms') as create_deal`,
      );
      dealId = created.rows[0]!.create_deal;

      const conversation = await db.query<{ id: string }>(
        'select id from public.deal_conversations where deal_id = $1',
        [dealId],
      );
      firstConversation = conversation.rows[0]!.id;
    });

    it('adds a room and seats the creator in it', async () => {
      const { rows } = await actingAs<{ create_deal_conversation: string }>(
        db,
        seller,
        `select public.create_deal_conversation($1, 'Diligence', 'diligence') as create_deal_conversation`,
        [dealId],
      );

      const membership = await db.query<{ role: string }>(
        'select role from public.conversation_members where conversation_id = $1 and user_id = $2',
        [rows[0]!.create_deal_conversation, seller],
      );
      expect(membership.rows[0]!.role).toBe('banker');
    });

    it('refuses somebody with no standing in the deal', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, broker, `select public.create_deal_conversation($1, 'Intruder')`, [dealId]),
      );

      // Same message as a non-existent deal, so the response does not confirm
      // that a deal with this id exists.
      expect(denial.message).toMatch(/deal not found/i);
    });

    it('refuses a plain member who is not a banker or admin', async () => {
      const analyst = await createAuthUser(db, 'deal-analyst@example.com');
      await db.query(
        `insert into public.conversation_members (conversation_id, user_id, role) values ($1, $2, 'buyer')`,
        [firstConversation, analyst],
      );

      // Sitting in a room is not authority to open another one on the deal.
      const denial = await expectDenied(() =>
        actingAs(db, analyst, `select public.create_deal_conversation($1, 'Side room')`, [dealId]),
      );

      expect(denial.message).toMatch(/deal not found/i);
    });

    it('gives the same answer for a deal that does not exist', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          seller,
          `select public.create_deal_conversation('00000000-0000-0000-0000-000000000000', 'Ghost')`,
        ),
      );

      expect(denial.message).toMatch(/deal not found/i);
    });
  });
});
