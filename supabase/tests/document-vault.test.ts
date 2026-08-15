import { randomUUID } from 'node:crypto';

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
 * The document vault.
 *
 * The scenario throughout is the one that makes a data room hard: a seller with
 * two bidders in the same deal room. Everything here is about the second bidder
 * not seeing what the first one was shown.
 */
describe.skipIf(!hasDatabase)('document vault', () => {
  let db: Client;

  let seller: string;
  let colleague: string;
  let buyerOne: string;
  let buyerTwo: string;
  let outsider: string;

  let firm: string;
  let deal: string;
  let conversation: string;

  let document = '';

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'vault-seller@example.com');
    colleague = await createAuthUser(db, 'vault-colleague@example.com');
    buyerOne = await createAuthUser(db, 'vault-buyer-one@example.com');
    buyerTwo = await createAuthUser(db, 'vault-buyer-two@example.com');
    outsider = await createAuthUser(db, 'vault-outsider@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'broker'), ($2,'broker'), ($3,'buyer'), ($4,'buyer'), ($5,'buyer')`,
      [seller, colleague, buyerOne, buyerTwo, outsider],
    );

    const firmRow = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values ('Ridge Brokerage','brokerage') returning id`,
    );
    firm = firmRow.rows[0]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role)
       values ($1,$2,'owner'), ($1,$3,'member')`,
      [firm, seller, colleague],
    );

    const dealRow = await db.query<{ id: string }>(
      `insert into public.deals (name, firm_id, created_by) values ('Project Anchor', $1, $2)
       returning id`,
      [firm, seller],
    );
    deal = dealRow.rows[0]!.id;

    const conversationRow = await db.query<{ id: string }>(
      `insert into public.deal_conversations (deal_id, name, type)
       values ($1, 'Diligence', 'diligence') returning id`,
      [deal],
    );
    conversation = conversationRow.rows[0]!.id;

    // Everybody but the outsider is in the room, the colleague included.
    //
    // That is the point rather than a convenience: firm membership is not deal
    // membership. A brokerage runs twenty deals and not every broker belongs in
    // every room, so `can_read_document` requires deal access in every branch.
    // What the firm branch buys is narrower — a colleague who is *already in the
    // room* reads their own side's documents without a separate grant.
    await db.query(
      `insert into public.conversation_members (conversation_id, user_id, role)
       values ($1,$2,'seller'), ($1,$3,'seller'), ($1,$4,'buyer'), ($1,$5,'buyer')`,
      [conversation, seller, colleague, buyerOne, buyerTwo],
    );
  });

  /**
   * Puts a document in the vault, as the platform would.
   *
   * The id is generated here rather than by the database because the storage
   * path contains it — `<deal_id>/<document_id>/<file_name>` is what ties the
   * object to the row, and building it needs the id before the insert. The
   * application does the same thing for the same reason.
   */
  async function putDocument(options: {
    uploader: string;
    title?: string;
    fileName?: string;
    visibility?: 'private' | 'restricted' | 'deal';
    withFirm?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const fileName = options.fileName ?? 'fy2025.pdf';

    await db.query(
      `insert into public.deal_documents
         (id, deal_id, uploaded_by, firm_id, title, category, visibility,
          storage_path, file_name, content_type, size_bytes)
       values ($1, $2, $3, $4, $5, 'tax_return', $6, $7, $8, 'application/pdf', 120000)`,
      [
        id,
        deal,
        options.uploader,
        options.withFirm === false ? null : firm,
        options.title ?? 'FY2025 tax return',
        options.visibility ?? 'restricted',
        `${deal}/${id}/${fileName}`,
        fileName,
      ],
    );

    return id;
  }

  beforeEach(async () => {
    if (document) await db.query('delete from public.deal_documents where id = $1', [document]);
    document = await putDocument({ uploader: seller });
  });

  afterAll(async () => {
    await db?.end();
  });

  // ===========================================================================
  // Restriction
  // ===========================================================================

  describe('a restricted document', () => {
    it('is invisible to a buyer in the room who was not named', async () => {
      // The assertion the whole table exists for. Both bidders are members of
      // the same deal; membership alone must not open the file.
      const { rowCount } = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(rowCount).toBe(0);
    });

    it('opens to the buyer it was released to, and to nobody else', async () => {
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      const released = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(released.rowCount).toBe(1);

      const other = await actingAs(
        db,
        buyerTwo,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(other.rowCount).toBe(0);
    });

    it('closes again when the grant is revoked', async () => {
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );
      await actingAs(
        db,
        seller,
        'update public.document_grants set revoked_at = now() where document_id = $1 and grantee_id = $2',
        [document, buyerOne],
      );

      const { rowCount } = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(rowCount).toBe(0);
    });

    it('keeps the revoked grant on record', async () => {
      // "Was this person ever shown the customer list" is asked after a deal
      // falls apart, and a deleted row answers it wrongly.
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );
      await actingAs(
        db,
        seller,
        'update public.document_grants set revoked_at = now() where document_id = $1 and grantee_id = $2',
        [document, buyerOne],
      );

      const { rows } = await actingAs<{ revoked_at: Date | null; granted_at: Date }>(
        db,
        seller,
        'select revoked_at, granted_at from public.document_grants where document_id = $1',
        [document],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.revoked_at).not.toBeNull();
    });

    it('lets the grantee see their own access', async () => {
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      const { rowCount } = await actingAs(
        db,
        buyerOne,
        'select id from public.document_grants where document_id = $1',
        [document],
      );
      expect(rowCount).toBe(1);
    });

    it('does not let one bidder see what the other was granted', async () => {
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      const { rowCount } = await actingAs(
        db,
        buyerTwo,
        'select id from public.document_grants where document_id = $1',
        [document],
      );
      expect(rowCount).toBe(0);
    });
  });

  // ===========================================================================
  // Who may release
  // ===========================================================================

  describe('releasing', () => {
    it('refuses a buyer releasing a seller document to the other bidder', async () => {
      // Without `controls_document`, `document:set_permissions` would let a
      // buyer who can read a tax return hand it to a rival.
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      const attempt = await expectDenied(() =>
        actingAs(
          db,
          buyerOne,
          'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
          [document, buyerTwo],
        ),
      );
      expect(attempt.code).toBe('42501');
    });

    it('stamps who released it rather than believing the client', async () => {
      await actingAs(
        db,
        seller,
        `insert into public.document_grants (document_id, grantee_id, granted_by) values ($1,$2,$3)`,
        [document, buyerOne, buyerTwo],
      );

      const { rows } = await actingAs<{ granted_by: string }>(
        db,
        seller,
        'select granted_by from public.document_grants where document_id = $1',
        [document],
      );
      expect(rows[0]!.granted_by).toBe(seller);
    });

    it('lets a firm administrator release a colleague’s document', async () => {
      const uploaded = await putDocument({
        uploader: colleague,
        title: 'Lease',
        fileName: 'lease.pdf',
      });

      const { rowCount } = await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [uploaded, buyerOne],
      );
      expect(rowCount).toBe(1);
    });
  });

  // ===========================================================================
  // The room boundary
  // ===========================================================================

  describe('the deal boundary', () => {
    it('shuts out somebody who is not in the room at all', async () => {
      const { rowCount } = await actingAs(db, outsider, 'select id from public.deal_documents');
      expect(rowCount).toBe(0);
    });

    it('shuts out a grantee who is not in the room', async () => {
      // A grant outlives the membership that justified it. Deal access is
      // required in every branch, so removing somebody from the room closes
      // their documents even if nobody remembered to revoke the grants.
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, outsider],
      );

      const { rowCount } = await actingAs(
        db,
        outsider,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(rowCount).toBe(0);
    });

    it('closes documents when a member is removed from the room', async () => {
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      await db.query(
        'update public.conversation_members set removed_at = now() where conversation_id = $1 and user_id = $2',
        [conversation, buyerOne],
      );

      const { rowCount } = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(rowCount).toBe(0);

      await db.query(
        'update public.conversation_members set removed_at = null where conversation_id = $1 and user_id = $2',
        [conversation, buyerOne],
      );
    });

    it('refuses an upload to a deal the caller is not part of', async () => {
      const attempt = await expectDenied(() =>
        actingAs(
          db,
          outsider,
          `insert into public.deal_documents
             (deal_id, uploaded_by, title, storage_path, file_name, content_type, size_bytes)
           values ($1, $2, 'Planted', $3, 'x.pdf', 'application/pdf', 10)`,
          [deal, outsider, `${deal}/${randomUUID()}/x.pdf`],
        ),
      );
      expect(attempt.code).toBe('42501');
    });

    it('refuses an upload attributed to somebody else', async () => {
      const attempt = await expectDenied(() =>
        actingAs(
          db,
          buyerOne,
          `insert into public.deal_documents
             (deal_id, uploaded_by, title, storage_path, file_name, content_type, size_bytes)
           values ($1, $2, 'Not mine', $3, 'x.pdf', 'application/pdf', 10)`,
          [deal, seller, `${deal}/${randomUUID()}/x.pdf`],
        ),
      );
      expect(attempt.code).toBe('42501');
    });
  });

  // ===========================================================================
  // Visibility levels
  // ===========================================================================

  describe('visibility', () => {
    it('keeps a private document to the uploader and their side of the room', async () => {
      await db.query("update public.deal_documents set visibility = 'private' where id = $1", [
        document,
      ]);

      const owner = await actingAs(
        db,
        seller,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(owner.rowCount).toBe(1);

      const sameFirm = await actingAs(
        db,
        colleague,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(sameFirm.rowCount).toBe(1);

      const buyer = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(buyer.rowCount).toBe(0);
    });

    it('does not let a grant override private', async () => {
      // Private means staging. A grant on a staged document is a mistake, and
      // the level wins so the mistake is not a disclosure.
      await db.query("update public.deal_documents set visibility = 'private' where id = $1", [
        document,
      ]);
      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      const { rowCount } = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(rowCount).toBe(0);
    });

    it('opens a deal-wide document to everybody in the room', async () => {
      await db.query("update public.deal_documents set visibility = 'deal' where id = $1", [
        document,
      ]);

      const one = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      const two = await actingAs(
        db,
        buyerTwo,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect([one.rowCount, two.rowCount]).toEqual([1, 1]);
    });

    it('closes a withdrawn document to everybody, including the room', async () => {
      await db.query("update public.deal_documents set visibility = 'deal' where id = $1", [
        document,
      ]);
      await actingAs(
        db,
        seller,
        `update public.deal_documents set withdrawn_at = now(), withdrawn_reason = 'Superseded by counsel'
          where id = $1`,
        [document],
      );

      const buyer = await actingAs(
        db,
        buyerOne,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(buyer.rowCount).toBe(0);

      // ...but not to the person who withdrew it. A withdrawn document is still
      // part of the record of what was disclosed and when it was pulled, and
      // hiding it from its owner would also make the row unupdatable — Postgres
      // applies SELECT policies to `UPDATE ... WHERE`, so the next statement
      // would match zero rows instead of being refused.
      const owner = await actingAs(
        db,
        seller,
        'select id from public.deal_documents where id = $1',
        [document],
      );
      expect(owner.rowCount).toBe(1);
    });
  });

  // ===========================================================================
  // Immutability
  // ===========================================================================

  describe('what cannot change', () => {
    it('refuses repointing a document at another file', async () => {
      // Otherwise "release" and "swap the file" are the same grant: release
      // something harmless, wait for it to be reviewed, then repoint the row.
      const denial = await expectDenied(() =>
        actingAs(db, seller, `update public.deal_documents set storage_path = $2 where id = $1`, [
          document,
          `${deal}/${document}/something-else.pdf`,
        ]),
      );
      expect(denial.message).toMatch(/upload a new version instead/i);
    });

    it('refuses moving a document to another deal', async () => {
      const other = await db.query<{ id: string }>(
        `insert into public.deals (name, created_by) values ('Other', $1) returning id`,
        [seller],
      );

      const denial = await expectDenied(() =>
        actingAs(db, seller, 'update public.deal_documents set deal_id = $2 where id = $1', [
          document,
          other.rows[0]!.id,
        ]),
      );
      expect(denial.message).toMatch(/fixed/i);
    });

    it('refuses reattributing the upload', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, seller, 'update public.deal_documents set uploaded_by = $2 where id = $1', [
          document,
          buyerOne,
        ]),
      );
      expect(denial.message).toMatch(/fixed/i);
    });

    it('still lets the owner re-file and re-title it', async () => {
      const { rowCount } = await actingAs(
        db,
        seller,
        `update public.deal_documents set title = 'FY2025 federal return', category = 'financial_statement'
          where id = $1`,
        [document],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses restoring a withdrawn document', async () => {
      await actingAs(
        db,
        seller,
        'update public.deal_documents set withdrawn_at = now() where id = $1',
        [document],
      );

      const denial = await expectDenied(() =>
        actingAs(db, seller, 'update public.deal_documents set withdrawn_at = null where id = $1', [
          document,
        ]),
      );
      expect(denial.message).toMatch(/cannot be restored/i);
    });

    it('stamps the withdrawal time rather than accepting one', async () => {
      await actingAs(
        db,
        seller,
        `update public.deal_documents set withdrawn_at = '1999-01-01' where id = $1`,
        [document],
      );

      const { rows } = await db.query<{ year: string }>(
        'select extract(year from withdrawn_at)::text as year from public.deal_documents where id = $1',
        [document],
      );
      expect(rows[0]!.year).not.toBe('1999');
    });
  });

  // ===========================================================================
  // The access log
  // ===========================================================================

  describe('access log', () => {
    it('cannot be written by a client', async () => {
      // A client that could write here could fabricate a read, or omit their
      // own — which is the only one they would want to omit.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          buyerOne,
          `insert into public.document_access_log (document_id, actor_id, action)
           values ($1, $2, 'download')`,
          [document, seller],
        ),
      );
      expect(denial.code).toBe('42501');
    });

    it('shows the owner who opened their document', async () => {
      await db.query(
        `insert into public.document_access_log (document_id, actor_id, action)
         values ($1, $2, 'download')`,
        [document, buyerOne],
      );

      const { rows } = await actingAs<{ actor_id: string }>(
        db,
        seller,
        'select actor_id from public.document_access_log where document_id = $1',
        [document],
      );
      expect(rows.map((r) => r.actor_id)).toContain(buyerOne);
    });

    it('shows a reader their own record and nobody else’s', async () => {
      await db.query(
        `insert into public.document_access_log (document_id, actor_id, action)
         values ($1, $2, 'download'), ($1, $3, 'download')`,
        [document, buyerOne, buyerTwo],
      );

      const { rows } = await actingAs<{ actor_id: string }>(
        db,
        buyerOne,
        'select actor_id from public.document_access_log where document_id = $1',
        [document],
      );
      expect(rows.map((r) => r.actor_id)).toEqual([buyerOne]);
    });

    it('cannot be edited or deleted, even by the document owner', async () => {
      await db.query(
        `insert into public.document_access_log (document_id, actor_id, action)
         values ($1, $2, 'download')`,
        [document, buyerOne],
      );

      const update = await expectDenied(() =>
        actingAs(db, seller, `update public.document_access_log set action = 'view'`),
      );
      expect(update.code).toBe('42501');

      const remove = await expectDenied(() =>
        actingAs(db, seller, 'delete from public.document_access_log'),
      );
      expect(remove.code).toBe('42501');
    });
  });

  // ===========================================================================
  // Storage
  // ===========================================================================

  describe('storage', () => {
    it('keeps the bucket private', async () => {
      const { rows } = await db.query<{ public: boolean }>(
        `select public from storage.buckets where id = 'deal-documents'`,
      );
      expect(rows[0]!.public).toBe(false);
    });

    it('answers false for a path segment that is not a uuid', async () => {
      // A policy that raises on malformed input is a denial of service on every
      // other object in the bucket, so the parse failure has to be a `false`.
      const { rows } = await actingAs<{ allowed: boolean }>(
        db,
        seller,
        `select app.can_read_document_path('../other-deal') as allowed`,
      );
      expect(rows[0]!.allowed).toBe(false);
    });

    it('gates an object on the document, not just the deal', async () => {
      const denied = await actingAs<{ allowed: boolean }>(
        db,
        buyerOne,
        'select app.can_read_document_path($1) as allowed',
        [document],
      );
      expect(denied.rows[0]!.allowed).toBe(false);

      await actingAs(
        db,
        seller,
        'insert into public.document_grants (document_id, grantee_id) values ($1,$2)',
        [document, buyerOne],
      );

      const allowed = await actingAs<{ allowed: boolean }>(
        db,
        buyerOne,
        'select app.can_read_document_path($1) as allowed',
        [document],
      );
      expect(allowed.rows[0]!.allowed).toBe(true);
    });

    it('does not let anon reach the vault helpers', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and p.proname in ('can_read_document','controls_document','can_read_document_path')
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      expect(rows).toEqual([]);
    });
  });
});
