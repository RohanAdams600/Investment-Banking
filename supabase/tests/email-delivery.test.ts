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
 * Unsubscribing, and the record of what was sent.
 *
 * The opt-out has an unusual shape for this codebase: it is the one function
 * `anon` may execute, on purpose. CAN-SPAM requires a working opt-out in every
 * commercial message, and one that demands a password first is not working —
 * the person who most wants out is the one who no longer remembers the account.
 *
 * That makes the questions here different from the rest of the suite. Not "who
 * may call this" but "what can somebody learn by calling it with a guess".
 */
describe.skipIf(!hasDatabase)('email delivery', () => {
  let db: Client;

  let alice: string;
  let bob: string;

  const tokenFor = async (user: string): Promise<string> => {
    const { rows } = await db.query<{ t: string }>(`select public.unsubscribe_token_for($1) as t`, [
      user,
    ]);
    return rows[0]!.t;
  };

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    alice = await createAuthUser(db, 'alice@example.com');
    bob = await createAuthUser(db, 'bob@example.com');
  });

  beforeEach(async () => {
    await db.query('delete from public.email_deliveries');
    await db.query('delete from public.notification_preferences');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ==========================================================================
  // The token
  // ==========================================================================

  it('creates the preference row on first ask', async () => {
    // Most users never open the preferences page, so most have no row — but an
    // email cannot go out without an opt-out link, so the row has to exist by
    // the time one is sent. This is where it comes into being.
    const before = await db.query('select 1 from public.notification_preferences');
    expect(before.rowCount).toBe(0);

    await tokenFor(alice);

    const after = await db.query('select 1 from public.notification_preferences');
    expect(after.rowCount).toBe(1);
  });

  it('returns the same token twice', async () => {
    // Otherwise every email carries a different link and the old ones die.
    expect(await tokenFor(alice)).toBe(await tokenFor(alice));
  });

  it('gives different people different tokens', async () => {
    expect(await tokenFor(alice)).not.toBe(await tokenFor(bob));
  });

  it('is not callable by a signed-in user or a visitor', async () => {
    // It mints an opt-out credential for an arbitrary user id.
    await expectDenied(() => actingAs(db, bob, `select public.unsubscribe_token_for($1)`, [alice]));
    await expectDenied(() => actingAsAnon(db, `select public.unsubscribe_token_for($1)`, [alice]));
  });

  // ==========================================================================
  // Opting out from a link
  // ==========================================================================

  it('lets a visitor opt out with a valid token', async () => {
    const token = await tokenFor(alice);

    const { rows } = await actingAsAnon<{ ok: boolean }>(
      db,
      `select public.unsubscribe_by_token($1, 'new_matches') as ok`,
      [token],
    );
    expect(rows[0]!.ok).toBe(true);

    const { rows: prefs } = await db.query<{ email_new_matches: boolean }>(
      `select email_new_matches from public.notification_preferences where user_id = $1`,
      [alice],
    );
    expect(prefs[0]!.email_new_matches).toBe(false);
  });

  it('turns off only the category asked for', async () => {
    // "Stop emailing me about new matches" and "stop emailing me entirely" are
    // different requests, and a product that conflates them gets the second.
    const token = await tokenFor(alice);
    await actingAsAnon(db, `select public.unsubscribe_by_token($1, 'new_matches')`, [token]);

    const { rows } = await db.query<{
      email_new_matches: boolean;
      email_deal_activity: boolean;
      email_messages: boolean;
    }>(
      `select email_new_matches, email_deal_activity, email_messages
         from public.notification_preferences where user_id = $1`,
      [alice],
    );
    expect(rows[0]!.email_new_matches).toBe(false);
    expect(rows[0]!.email_deal_activity).toBe(true);
    expect(rows[0]!.email_messages).toBe(true);
  });

  it('answers a bad token the same way it answers a good one, minus the effect', async () => {
    /*
     * It returns false rather than raising, and the route renders the same page
     * either way. Distinguishing them would turn this into an oracle for
     * guessing tokens, which is the only attack the endpoint has.
     */
    const { rows } = await actingAsAnon<{ ok: boolean }>(
      db,
      `select public.unsubscribe_by_token('99999999-9999-9999-9999-999999999999', 'new_matches') as ok`,
    );
    expect(rows[0]!.ok).toBe(false);
  });

  it('refuses a category that is not one of the four', async () => {
    // Otherwise a crafted link is a way to probe the column list.
    const token = await tokenFor(alice);
    const { rows } = await actingAsAnon<{ ok: boolean }>(
      db,
      `select public.unsubscribe_by_token($1, 'email_digest') as ok`,
      [token],
    );
    expect(rows[0]!.ok).toBe(false);
  });

  it("cannot touch anybody else's preferences", async () => {
    const token = await tokenFor(alice);
    await tokenFor(bob);

    await actingAsAnon(db, `select public.unsubscribe_by_token($1, 'messages')`, [token]);

    const { rows } = await db.query<{ email_messages: boolean }>(
      `select email_messages from public.notification_preferences where user_id = $1`,
      [bob],
    );
    expect(rows[0]!.email_messages).toBe(true);
  });

  // ==========================================================================
  // The delivery log
  // ==========================================================================

  it('lets a person see what was sent to them', async () => {
    await db.query(
      `insert into public.email_deliveries (recipient_id, kind, outcome)
       values ($1, 'nda_requested', 'sent')`,
      [alice],
    );

    const seen = await actingAs(db, alice, `select id from public.email_deliveries`);
    expect(seen.rowCount).toBe(1);
  });

  it("shows nobody else's", async () => {
    await db.query(
      `insert into public.email_deliveries (recipient_id, kind, outcome)
       values ($1, 'nda_requested', 'sent')`,
      [alice],
    );

    const seen = await actingAs(db, bob, `select id from public.email_deliveries`);
    expect(seen.rowCount).toBe(0);
  });

  it('cannot be written by a signed-in user', async () => {
    // It is a record of what the platform did, not something a client asserts.
    await expectDenied(() =>
      actingAs(
        db,
        alice,
        `insert into public.email_deliveries (recipient_id, kind, outcome)
         values ($1, 'nda_requested', 'sent')`,
        [alice],
      ),
    );
  });

  it('refuses an outcome that is not one of the three', async () => {
    await expect(
      db.query(
        `insert into public.email_deliveries (recipient_id, kind, outcome)
         values ($1, 'nda_requested', 'delivered')`,
        [alice],
      ),
    ).rejects.toThrow();
  });
});
