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
 * Revision history for legal drafts.
 *
 * The value of a revision history is entirely in the guarantee that nobody
 * edited it afterwards. A history that can be rewritten answers no question
 * worth asking — so most of this file is about what cannot be done to it.
 */
describe.skipIf(!hasDatabase)('legal document versions', () => {
  let db: Client;

  let author: string;
  let stranger: string;
  let draft: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    author = await createAuthUser(db, 'doc-author@example.com');
    stranger = await createAuthUser(db, 'doc-stranger@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'seller'), ($2,'buyer')`,
      [author, stranger],
    );
  });

  beforeEach(async () => {
    await db.query('delete from public.legal_document_versions');
    await db.query('delete from public.legal_document_drafts');

    const { rows } = await db.query<{ id: string }>(
      `insert into public.legal_document_drafts (created_by, kind, title, body)
       values ($1, 'nda', 'Mutual NDA', 'Version one text.') returning id`,
      [author],
    );
    draft = rows[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
  });

  async function addVersion(asUser: string, body: string, note?: string) {
    return actingAs<{ version: number }>(
      db,
      asUser,
      `insert into public.legal_document_versions (draft_id, body, note)
       values ($1, $2, $3) returning version`,
      [draft, body, note ?? null],
    );
  }

  it('numbers the first version 1', async () => {
    const { rows } = await addVersion(author, 'First.');
    expect(rows[0]!.version).toBe(1);
  });

  it('increments per draft', async () => {
    await addVersion(author, 'First.');
    await addVersion(author, 'Second.');
    const third = await addVersion(author, 'Third.');

    expect(third.rows[0]!.version).toBe(3);
  });

  it('ignores a version number the client supplies', async () => {
    // Client-supplied numbering is a race: two people revising in the same
    // minute both read 3 and both write 4.
    const { rows } = await actingAs<{ version: number }>(
      db,
      author,
      `insert into public.legal_document_versions (draft_id, body, version)
       values ($1, 'Sneaky.', 99) returning version`,
      [draft],
    );
    expect(rows[0]!.version).toBe(1);
  });

  it('records who made the revision, not who the caller names', async () => {
    await actingAs(
      db,
      author,
      `insert into public.legal_document_versions (draft_id, body, created_by)
       values ($1, 'Misattributed.', $2)`,
      [draft, stranger],
    );

    const { rows } = await db.query<{ created_by: string }>(
      'select created_by from public.legal_document_versions where draft_id = $1',
      [draft],
    );
    expect(rows[0]!.created_by).toBe(author);
  });

  it('refuses to edit a stored version', async () => {
    // The whole point. A rewritable history is not evidence of anything.
    await addVersion(author, 'Original.');

    const denial = await expectDenied(() =>
      actingAs(db, author, `update public.legal_document_versions set body = 'Rewritten.'`),
    );
    expect(denial.code).toBe('42501');
  });

  it('refuses to delete a stored version', async () => {
    await addVersion(author, 'Original.');

    const denial = await expectDenied(() =>
      actingAs(db, author, 'delete from public.legal_document_versions'),
    );
    expect(denial.code).toBe('42501');
  });

  it('refuses a stranger adding a version to somebody else document', async () => {
    const denial = await expectDenied(() => addVersion(stranger, 'Intruder.'));
    expect(denial.code).toBe('42501');
  });

  it('hides versions of a document the caller cannot see', async () => {
    await addVersion(author, 'Confidential terms.');

    const { rows } = await actingAs<{ n: string }>(
      db,
      stranger,
      'select count(*)::text as n from public.legal_document_versions',
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('keeps every version, in order', async () => {
    await addVersion(author, 'One.', 'initial');
    await addVersion(author, 'Two.', 'buyer redline');
    await addVersion(author, 'Three.');

    const { rows } = await actingAs<{ version: number; body: string }>(
      db,
      author,
      'select version, body from public.legal_document_versions order by version',
    );

    expect(rows.map((r) => r.body)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('numbers each draft independently', async () => {
    const { rows: other } = await db.query<{ id: string }>(
      `insert into public.legal_document_drafts (created_by, kind, title, body)
       values ($1, 'loi', 'LOI', 'Body.') returning id`,
      [author],
    );

    await addVersion(author, 'Draft one, version one.');

    const { rows } = await actingAs<{ version: number }>(
      db,
      author,
      `insert into public.legal_document_versions (draft_id, body) values ($1, 'Other.') returning version`,
      [other[0]!.id],
    );
    expect(rows[0]!.version).toBe(1);
  });

  it('has RLS enabled and forced', async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'legal_document_versions'
          and (not c.relrowsecurity or not c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });
});
