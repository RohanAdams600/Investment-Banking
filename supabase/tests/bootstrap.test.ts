import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

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
 * Starting the platform for the first time.
 *
 * A fresh deployment of 0001–0027 could not be used at all: no administrator
 * existed, no policy or function could create one, and without an administrator
 * no jurisdiction could be opened — so the listing form's location dropdown was
 * empty and nobody could list a business. Every rule involved was correct on its
 * own; together they were a locked room with the key inside.
 *
 * The tests that matter here are the ones about the door closing again. A
 * bootstrap that can fire twice is not a bootstrap, it is a privilege-escalation
 * primitive left in the schema forever.
 */
describe.skipIf(!hasDatabase)('bootstrap', () => {
  let db: Client;

  let founder: string;
  let stranger: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    founder = await createAuthUser(db, 'Founder@Example.com');
    stranger = await createAuthUser(db, 'stranger@example.com');
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await db.query('delete from public.user_roles');
    await db.query('delete from public.audit_log');
  });

  // -------------------------------------------------------------------------
  // The deadlock this exists to break
  // -------------------------------------------------------------------------

  it('confirms nobody can grant themselves admin through the application', async () => {
    // The rule the bootstrap exists to work around, asserted here so that if it
    // is ever relaxed, this test is the thing that has to be argued with.
    await expectDenied(() =>
      actingAs(db, founder, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [
        founder,
      ]),
    );
  });

  it('ships every jurisdiction closed', async () => {
    // Not an oversight. Opening one is the operator asserting they have done
    // their own licensing work in that state, and nothing in this platform
    // verifies that — so the seed cannot make the assertion on their behalf.
    const { rows } = await db.query<{ total: string; open: string }>(
      `select count(*) as total, count(*) filter (where is_active) as open
         from public.jurisdictions`,
    );
    expect(Number(rows[0]!.total)).toBeGreaterThan(0);
    expect(Number(rows[0]!.open)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The bootstrap
  // -------------------------------------------------------------------------

  it('promotes the named account', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select app.bootstrap_admin('founder@example.com') as id`,
    );
    expect(rows[0]!.id).toBe(founder);

    const roles = await db.query(
      `select 1 from public.user_roles where user_id = $1 and role = 'admin'`,
      [founder],
    );
    expect(roles.rowCount).toBe(1);
  });

  it('matches the address case-insensitively', async () => {
    // The account was created as `Founder@Example.com`. Somebody typing their
    // own address in lowercase should not get "no such account".
    const { rows } = await db.query<{ id: string }>(
      `select app.bootstrap_admin('FOUNDER@EXAMPLE.COM') as id`,
    );
    expect(rows[0]!.id).toBe(founder);
  });

  it('refuses a second time', async () => {
    // The entire safety story. After one success this is inert for the life of
    // the platform, and every later operator is appointed from the admin panel.
    await db.query(`select app.bootstrap_admin('founder@example.com')`);

    await expect(db.query(`select app.bootstrap_admin('stranger@example.com')`)).rejects.toThrow(
      /already exists/i,
    );
  });

  it('refuses even for the same person twice', async () => {
    await db.query(`select app.bootstrap_admin('founder@example.com')`);

    await expect(db.query(`select app.bootstrap_admin('founder@example.com')`)).rejects.toThrow(
      /already exists/i,
    );
  });

  it('refuses when an admin exists who was never bootstrapped', async () => {
    // The guard is a property of the data, not a record of having run before.
    // An operator appointed through the panel closes the door just as firmly.
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [
      stranger,
    ]);

    await expect(db.query(`select app.bootstrap_admin('founder@example.com')`)).rejects.toThrow(
      /already exists/i,
    );
  });

  it('says so when the account does not exist', async () => {
    // Run by hand, once, by somebody who knows which account they meant. A
    // silent no-op here is an hour of confusion.
    await expect(db.query(`select app.bootstrap_admin('nobody@example.com')`)).rejects.toThrow(
      /sign up in the application first/i,
    );
  });

  it('leaves no administrator behind when the email is wrong', async () => {
    await expect(db.query(`select app.bootstrap_admin('nobody@example.com')`)).rejects.toThrow();

    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count from public.user_roles where role = 'admin'`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('records the grant in the audit log', async () => {
    // The first act of the platform's life is a privilege grant. Doing it by
    // hand in a SQL console would leave no trace of it at all, which is exactly
    // the event an audit log exists for.
    await db.query(`select app.bootstrap_admin('founder@example.com')`);

    const { rows } = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from public.audit_log where entity_id = $1`,
      [founder],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('user.role_granted');
    expect(rows[0]!.metadata).toMatchObject({ role: 'admin', via: 'bootstrap_admin', first: true });
  });

  // -------------------------------------------------------------------------
  // Nobody may call it over the API
  // -------------------------------------------------------------------------

  it('is not executable by a signed-in user', async () => {
    await expectDenied(() =>
      actingAs(db, stranger, `select app.bootstrap_admin('stranger@example.com')`),
    );
  });

  it('is not executable by a visitor', async () => {
    await expectDenied(() =>
      actingAsAnon(db, `select app.bootstrap_admin('stranger@example.com')`),
    );
  });

  // -------------------------------------------------------------------------
  // Launch readiness
  // -------------------------------------------------------------------------

  it('reports every check as not ready on a fresh deployment', async () => {
    const { rows } = await db.query<{ check_name: string; ready: boolean }>(
      'select check_name, ready from public.launch_readiness()',
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.ready, row.check_name).toBe(false);
    }
  });

  it('notices once an administrator exists', async () => {
    await db.query(`select app.bootstrap_admin('founder@example.com')`);

    const { rows } = await db.query<{ check_name: string; ready: boolean }>(
      `select check_name, ready from public.launch_readiness() where check_name = 'administrator'`,
    );
    expect(rows[0]!.ready).toBe(true);
  });

  it('notices once a jurisdiction is open', async () => {
    await db.query(`update public.jurisdictions set is_active = true where code = 'US-NY'`);

    const { rows } = await db.query<{ ready: boolean }>(
      `select ready from public.launch_readiness() where check_name = 'open jurisdiction'`,
    );
    expect(rows[0]!.ready).toBe(true);

    await db.query(`update public.jurisdictions set is_active = false where code = 'US-NY'`);
  });

  it('does not count an unpublished legal template', async () => {
    // A draft counsel is still marking up is not a published policy, and the
    // readiness answer must not say otherwise.
    await db.query(
      `insert into public.legal_templates (kind, version, title, body)
       values ('terms_of_use', 1, 'Terms of use', 'Draft.')`,
    );

    const { rows } = await db.query<{ ready: boolean }>(
      `select ready from public.launch_readiness() where check_name = 'terms of use published'`,
    );
    expect(rows[0]!.ready).toBe(false);

    await db.query(`delete from public.legal_templates`);
  });

  it('counts a published one', async () => {
    await db.query(
      `insert into public.legal_templates (kind, version, title, body, published_at)
       values ('terms_of_use', 1, 'Terms of use', 'The real thing.', now())`,
    );

    const { rows } = await db.query<{ ready: boolean }>(
      `select ready from public.launch_readiness() where check_name = 'terms of use published'`,
    );
    expect(rows[0]!.ready).toBe(true);

    await db.query(`delete from public.legal_templates`);
  });

  it('is readable by a signed-in user and not by a visitor', async () => {
    // It contains no customer data — five booleans about configuration — so any
    // operator can check it. A visitor has no business enumerating what the
    // platform has not finished setting up.
    const signedIn = await actingAs(
      db,
      stranger,
      'select check_name from public.launch_readiness()',
    );
    expect(signedIn.rowCount).toBeGreaterThan(0);

    await expectDenied(() => actingAsAnon(db, 'select check_name from public.launch_readiness()'));
  });
});
