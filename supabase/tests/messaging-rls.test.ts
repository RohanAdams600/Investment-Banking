import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Deal room messaging: isolation between deals, and impersonation within one.
 *
 * These are the two failures that would matter most on this product. A buyer
 * reading another deal's room sees a competitor's confidential negotiation. A
 * message attributed to the wrong sender corrupts the record of who agreed to
 * what, which is the thing a deal room exists to produce.
 *
 * Everything here runs against the database directly, as the wrong user, with
 * no application code in the path — because the application code is not what is
 * being tested. The question is what the database refuses on its own.
 */
describe.skipIf(!hasDatabase)('deal room messaging', () => {
  let db: Client;

  // Two unrelated deals. Alpha is the one under test; Beta exists so "can this
  // buyer see a deal they are not in" has a concrete answer.
  let dealAlpha: string;
  let dealBeta: string;
  let alphaConversation: string;
  let alphaInternal: string;
  let betaConversation: string;

  let alphaBuyer: string;
  let alphaSeller: string;
  let alphaBanker: string;
  let betaBuyer: string;
  let removedBuyer: string;
  let outsider: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    alphaBuyer = await createAuthUser(db, 'alpha-buyer@example.com');
    alphaSeller = await createAuthUser(db, 'alpha-seller@example.com');
    alphaBanker = await createAuthUser(db, 'alpha-banker@example.com');
    betaBuyer = await createAuthUser(db, 'beta-buyer@example.com');
    removedBuyer = await createAuthUser(db, 'removed-buyer@example.com');
    outsider = await createAuthUser(db, 'outsider@example.com');

    const deals = await db.query<{ id: string }>(
      `insert into public.deals (name) values ('Project Alpha'), ('Project Beta') returning id`,
    );
    dealAlpha = deals.rows[0]!.id;
    dealBeta = deals.rows[1]!.id;

    const conversations = await db.query<{ id: string }>(
      `insert into public.deal_conversations (deal_id, name, type) values
         ($1, 'Alpha — buyer and seller', 'buyer_seller'),
         ($1, 'Alpha — internal', 'internal'),
         ($2, 'Beta — buyer and seller', 'buyer_seller')
       returning id`,
      [dealAlpha, dealBeta],
    );
    alphaConversation = conversations.rows[0]!.id;
    alphaInternal = conversations.rows[1]!.id;
    betaConversation = conversations.rows[2]!.id;

    await db.query(
      `insert into public.conversation_members (conversation_id, user_id, role) values
         ($1, $2, 'buyer'), ($1, $3, 'seller'), ($1, $4, 'banker'),
         ($5, $4, 'banker'),
         ($6, $7, 'buyer')`,
      [
        alphaConversation,
        alphaBuyer,
        alphaSeller,
        alphaBanker,
        alphaInternal,
        betaConversation,
        betaBuyer,
      ],
    );

    // A buyer who was in the Alpha room and has since been removed.
    await db.query(
      `insert into public.conversation_members (conversation_id, user_id, role, removed_at)
       values ($1, $2, 'buyer', now())`,
      [alphaConversation, removedBuyer],
    );

    await db.query(
      `insert into public.messages (conversation_id, sender_id, body) values
         ($1, $2, 'Alpha: opening position from the buyer.'),
         ($1, $3, 'Alpha: seller response.'),
         ($4, $5, 'Beta: confidential to the other deal.')`,
      [alphaConversation, alphaBuyer, alphaSeller, betaConversation, betaBuyer],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  // -------------------------------------------------------------------------

  describe('cross-deal isolation', () => {
    it("does not let a buyer read another deal's messages", async () => {
      const { rows } = await actingAs(
        db,
        alphaBuyer,
        'select id from public.messages where conversation_id = $1',
        [betaConversation],
      );

      expect(rows).toHaveLength(0);
    });

    it('does not let a buyer read another deal at all', async () => {
      const { rows } = await actingAs(db, alphaBuyer, 'select id from public.deals where id = $1', [
        dealBeta,
      ]);

      expect(rows).toHaveLength(0);
    });

    it("does not let a buyer enumerate another deal's conversations", async () => {
      const { rows } = await actingAs(
        db,
        alphaBuyer,
        'select id from public.deal_conversations where deal_id = $1',
        [dealBeta],
      );

      expect(rows).toHaveLength(0);
    });

    it('shows a buyer only the messages in rooms they sit in', async () => {
      // The Alpha buyer is in the buyer/seller room but not the internal one,
      // even though both belong to a deal they are part of. Deal access is not
      // room access.
      const { rows } = await actingAs<{ conversation_id: string }>(
        db,
        alphaBuyer,
        'select conversation_id from public.messages',
      );

      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.conversation_id))).toEqual(new Set([alphaConversation]));
    });

    it("does not let a buyer post into another deal's room", async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Injected')`,
          [betaConversation, alphaBuyer],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('does not let an outsider with no membership read anything', async () => {
      const messages = await actingAs(db, outsider, 'select id from public.messages');
      const deals = await actingAs(db, outsider, 'select id from public.deals');

      expect(messages.rows).toHaveLength(0);
      expect(deals.rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('sender impersonation', () => {
    it('refuses a message sent as another user', async () => {
      // The buyer is a legitimate member of this room. The only thing wrong
      // with this insert is the sender.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `insert into public.messages (conversation_id, sender_id, body)
           values ($1, $2, 'Agreed on behalf of the seller.')`,
          [alphaConversation, alphaSeller],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses reattributing an existing message', async () => {
      // A trigger, not a policy: WITH CHECK sees only the new row, so it cannot
      // express "this column did not change".
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `update public.messages set sender_id = $1
            where conversation_id = $2 and sender_id = $3`,
          [alphaSeller, alphaConversation, alphaBuyer],
        ),
      );

      expect(denial.message).toMatch(/reattributed/i);
    });

    it("refuses editing another member's message", async () => {
      const { rowCount } = await actingAs(
        db,
        alphaBuyer,
        `update public.messages set body = 'Rewritten by the buyer'
          where conversation_id = $1 and sender_id = $2`,
        [alphaConversation, alphaSeller],
      );

      // Filtered by the policy rather than refused: no row is visible to update.
      expect(rowCount).toBe(0);
    });

    it('lets a member edit their own message and stamps edited_at', async () => {
      const { rowCount } = await actingAs(
        db,
        alphaSeller,
        `update public.messages set body = 'Alpha: revised seller response.'
          where conversation_id = $1 and sender_id = $2`,
        [alphaConversation, alphaSeller],
      );

      expect(rowCount).toBe(1);

      const { rows } = await db.query<{ edited_at: string | null }>(
        'select edited_at from public.messages where conversation_id = $1 and sender_id = $2',
        [alphaConversation, alphaSeller],
      );

      // Stamped by the trigger, not by the client.
      expect(rows[0]!.edited_at).not.toBeNull();
    });

    it('refuses moving a message into another conversation', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `update public.messages set conversation_id = $1
            where conversation_id = $2 and sender_id = $3`,
          [betaConversation, alphaConversation, alphaBuyer],
        ),
      );

      expect(denial.message).toMatch(/moved between conversations/i);
    });

    it('refuses rewriting a message send time', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `update public.messages set created_at = now() - interval '30 days'
            where conversation_id = $1 and sender_id = $2`,
          [alphaConversation, alphaBuyer],
        ),
      );

      expect(denial.message).toMatch(/send time/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('removed members', () => {
    it('cuts off a removed member immediately', async () => {
      const { rows } = await actingAs(db, removedBuyer, 'select id from public.messages');
      expect(rows).toHaveLength(0);
    });

    it('does not let a removed member post', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          removedBuyer,
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Still here')`,
          [alphaConversation, removedBuyer],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('keeps the membership row so the access record survives', async () => {
      // The point of soft removal: "who could read this room, and when" has to
      // remain answerable after the fact.
      const { rows } = await db.query<{ removed_at: string | null }>(
        'select removed_at from public.conversation_members where conversation_id = $1 and user_id = $2',
        [alphaConversation, removedBuyer],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.removed_at).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------

  describe('membership administration', () => {
    it('lets a banker add a member', async () => {
      const newcomer = await createAuthUser(db, 'newcomer-analyst@example.com');

      const { rowCount } = await actingAs(
        db,
        alphaBanker,
        `insert into public.conversation_members (conversation_id, user_id, role)
         values ($1, $2, 'buyer')`,
        [alphaConversation, newcomer],
      );

      expect(rowCount).toBe(1);
    });

    it('does not let a buyer add anyone', async () => {
      // A buyer sitting in the room must not be able to widen it — that is the
      // seller's confidentiality, not the buyer's to give away.
      const accomplice = await createAuthUser(db, 'accomplice-analyst@example.com');

      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `insert into public.conversation_members (conversation_id, user_id, role)
           values ($1, $2, 'buyer')`,
          [alphaConversation, accomplice],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('does not let a buyer add themselves to another deal', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `insert into public.conversation_members (conversation_id, user_id, role)
           values ($1, $2, 'buyer')`,
          [betaConversation, alphaBuyer],
        ),
      );

      expect(denial.code).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------

  describe('deletion and audit', () => {
    it('hides a soft-deleted message from everyone', async () => {
      const inserted = await actingAs<{ id: string }>(
        db,
        alphaBuyer,
        `insert into public.messages (conversation_id, sender_id, body)
         values ($1, $2, 'To be withdrawn') returning id`,
        [alphaConversation, alphaBuyer],
      );
      const messageId = inserted.rows[0]!.id;

      await actingAs(db, alphaBuyer, 'select public.withdraw_message($1)', [messageId]);

      // Gone for the sender and for everyone else. The body never leaves the
      // database over any path once deleted.
      const asSender = await actingAs(
        db,
        alphaBuyer,
        'select id from public.messages where id = $1',
        [messageId],
      );
      const asOther = await actingAs(
        db,
        alphaSeller,
        'select id from public.messages where id = $1',
        [messageId],
      );

      expect(asSender.rows).toHaveLength(0);
      expect(asOther.rows).toHaveLength(0);
    });

    it('refuses restoring a deleted message', async () => {
      const inserted = await actingAs<{ id: string }>(
        db,
        alphaBuyer,
        `insert into public.messages (conversation_id, sender_id, body)
         values ($1, $2, 'Withdrawn then restored') returning id`,
        [alphaConversation, alphaBuyer],
      );
      const messageId = inserted.rows[0]!.id;

      await actingAs(db, alphaBuyer, 'select public.withdraw_message($1)', [messageId]);

      // The policy already hides it, so this updates nothing rather than
      // erroring — but the trigger is there for any path that can see the row.
      const { rowCount } = await actingAs(
        db,
        alphaBuyer,
        'update public.messages set deleted_at = null where id = $1',
        [messageId],
      );

      expect(rowCount).toBe(0);

      const { rows } = await db.query<{ deleted_at: string | null }>(
        'select deleted_at from public.messages where id = $1',
        [messageId],
      );
      expect(rows[0]!.deleted_at).not.toBeNull();
    });

    it('records create, edit and delete without the application asking', async () => {
      const inserted = await actingAs<{ id: string }>(
        db,
        alphaBuyer,
        `insert into public.messages (conversation_id, sender_id, body)
         values ($1, $2, 'Audited message') returning id`,
        [alphaConversation, alphaBuyer],
      );
      const messageId = inserted.rows[0]!.id;

      await actingAs(db, alphaBuyer, 'update public.messages set body = $2 where id = $1', [
        messageId,
        'Audited message, revised',
      ]);
      await actingAs(db, alphaBuyer, 'select public.withdraw_message($1)', [messageId]);

      const { rows } = await db.query<{ action: string; actor_id: string }>(
        'select action, actor_id from public.message_audit_log where message_id = $1 order by event_at',
        [messageId],
      );

      expect(rows.map((r) => r.action)).toEqual(['created', 'edited', 'deleted']);
      // Actor comes from auth.uid(), not from a parameter the caller controls.
      expect(new Set(rows.map((r) => r.actor_id))).toEqual(new Set([alphaBuyer]));
    });

    it('never records a message body in the audit log', async () => {
      const { rows } = await db.query<{ metadata: Record<string, unknown> }>(
        'select metadata from public.message_audit_log',
      );

      for (const row of rows) {
        expect(Object.keys(row.metadata)).toEqual(['body_length']);
      }
    });

    it('refuses client writes to the message audit log', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `insert into public.message_audit_log (message_id, conversation_id, action)
           select id, conversation_id, 'exported' from public.messages limit 1`,
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses deleting audit entries', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, alphaBanker, 'delete from public.message_audit_log'),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses a client setting deleted_at directly', async () => {
      // The SELECT policy makes the new row invisible to its own author, and
      // Postgres rejects an UPDATE that produces a row the author cannot see.
      // Withdrawal has to go through withdraw_message().
      const inserted = await actingAs<{ id: string }>(
        db,
        alphaBuyer,
        `insert into public.messages (conversation_id, sender_id, body)
         values ($1, $2, 'Direct delete attempt') returning id`,
        [alphaConversation, alphaBuyer],
      );

      const denial = await expectDenied(() =>
        actingAs(db, alphaBuyer, 'update public.messages set deleted_at = now() where id = $1', [
          inserted.rows[0]!.id,
        ]),
      );

      expect(denial.code).toBe('42501');
    });

    it("does not let a member withdraw another member's message", async () => {
      const inserted = await actingAs<{ id: string }>(
        db,
        alphaSeller,
        `insert into public.messages (conversation_id, sender_id, body)
         values ($1, $2, 'Seller message') returning id`,
        [alphaConversation, alphaSeller],
      );

      // The function re-checks sender identity, so bypassing the policy does
      // not mean bypassing the rule.
      const { rows } = await actingAs<{ withdraw_message: boolean }>(
        db,
        alphaBuyer,
        'select public.withdraw_message($1)',
        [inserted.rows[0]!.id],
      );

      expect(rows[0]!.withdraw_message).toBe(false);

      const check = await db.query<{ deleted_at: string | null }>(
        'select deleted_at from public.messages where id = $1',
        [inserted.rows[0]!.id],
      );
      expect(check.rows[0]!.deleted_at).toBeNull();
    });

    it('refuses hard-deleting a message', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, alphaBuyer, 'delete from public.messages'),
      );

      expect(denial.code).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------

  describe('realtime channel authorization', () => {
    it('lets an active member subscribe to their conversation topic', async () => {
      const { rows } = await actingAs<{ ok: boolean }>(
        db,
        alphaBuyer,
        `select app.is_active_conversation_member(app.topic_conversation_id(realtime.topic())) as ok`,
        [],
        { realtimeTopic: `conversation:${alphaConversation}` },
      );

      expect(rows[0]?.ok).toBe(true);
    });

    it("refuses a subscription to another deal's topic", async () => {
      // Without this the realtime layer would be a second, weaker path to the
      // same content — private channels are only private if the topic is
      // checked rather than trusted.
      const { rows } = await actingAs<{ ok: boolean }>(
        db,
        alphaBuyer,
        `select app.is_active_conversation_member(app.topic_conversation_id(realtime.topic())) as ok`,
        [],
        { realtimeTopic: `conversation:${betaConversation}` },
      );

      expect(rows[0]?.ok).toBe(false);
    });

    it('refuses a malformed topic rather than parsing it loosely', async () => {
      for (const topic of ['conversation:not-a-uuid', 'conversation:', 'deals:*', '']) {
        const { rows } = await actingAs<{ parsed: string | null }>(
          db,
          alphaBuyer,
          `select app.topic_conversation_id(realtime.topic()) as parsed`,
          [],
          { realtimeTopic: topic },
        );

        expect(rows[0]?.parsed, topic).toBeNull();
      }
    });

    it('broadcasts on send without putting the body on the wire', async () => {
      await actingAs(
        db,
        alphaBuyer,
        `insert into public.messages (conversation_id, sender_id, body)
         values ($1, $2, 'Secret negotiating position')`,
        [alphaConversation, alphaBuyer],
      );

      const { rows } = await db.query<{ topic: string; payload: Record<string, unknown> }>(
        `select topic, payload from realtime.messages order by id desc limit 1`,
      );

      expect(rows[0]!.topic).toBe(`conversation:${alphaConversation}`);
      // A signal to refetch, not the content. Refetching goes through RLS again.
      expect(JSON.stringify(rows[0]!.payload)).not.toContain('Secret negotiating position');
      expect(Object.keys(rows[0]!.payload).sort()).toEqual([
        'conversation_id',
        'event',
        'message_id',
        'sender_id',
      ]);
    });
  });

  // -------------------------------------------------------------------------

  describe('attachments bucket', () => {
    it('is private, so no object has a permanent public URL', async () => {
      const { rows } = await db.query<{ public: boolean }>(
        `select public from storage.buckets where id = 'deal-attachments'`,
      );

      expect(rows[0]!.public).toBe(false);
    });

    it("does not let a member read another deal's attachments", async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name, owner_id)
         values ('deal-attachments', $1, $2)`,
        [`${betaConversation}/msg/confidential.pdf`, betaBuyer],
      );

      const { rows } = await actingAs(
        db,
        alphaBuyer,
        `select id from storage.objects where bucket_id = 'deal-attachments'`,
      );

      expect(rows).toHaveLength(0);
    });

    it("refuses uploading into another deal's path", async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          alphaBuyer,
          `insert into storage.objects (bucket_id, name, owner_id)
           values ('deal-attachments', $1, $2)`,
          [`${betaConversation}/msg/planted.pdf`, alphaBuyer],
        ),
      );

      expect(denial.code).toBe('42501');
    });
  });
});
