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
 * The inbox.
 *
 * Three things are being defended, and they are not the usual ones.
 *
 * **Nobody reads anybody else's, including an administrator.** Most tables here
 * carry an admin branch for support. This one does not, on purpose: what a
 * person has been told is between them and the platform, and there is no
 * support case that needs reading somebody's inbox rather than asking them.
 *
 * **Nobody writes one.** A client that could insert a notification could put a
 * sentence in a stranger's inbox — which is the shape of every phishing message
 * ever sent, with the platform's own name on it. There is no insert policy at
 * all; the service role writes.
 *
 * **A recipient may mark it read and nothing else.** "Read" and "make it never
 * have happened" are different, and only the first is theirs to decide. RLS
 * cannot express "this column only", so a trigger does.
 */
describe.skipIf(!hasDatabase)('notifications', () => {
  let db: Client;

  let alice: string;
  let bob: string;
  let admin: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    alice = await createAuthUser(db, 'notify-alice@example.com');
    bob = await createAuthUser(db, 'notify-bob@example.com');
    admin = await createAuthUser(db, 'notify-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'seller'), ($2,'buyer'), ($3,'admin')`,
      [alice, bob, admin],
    );
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await db.query('delete from public.notifications');
    await db.query('delete from public.notification_preferences');
  });

  /** Writes one the way the application does: with the owner role, not a client. */
  async function give(recipient: string, kind = 'nda_requested', ageMinutes = 0): Promise<string> {
    // `created_at` is set on the way in rather than corrected afterwards,
    // because the update trigger refuses to let anything but `read_at` change —
    // and it refuses it for every role, which is the behaviour under test.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.notifications (recipient_id, kind, title, body, href, created_at)
       values ($1, $2::app.notification_kind, 'Someone asked to see your business',
               'A buyer has requested a confidentiality agreement.', '/listings/mine',
               now() - make_interval(mins => $3::int))
       returning id`,
      [recipient, kind, ageMinutes],
    );
    return rows[0]!.id;
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  it('shows a recipient their own', async () => {
    await give(alice);

    const { rowCount } = await actingAs(db, alice, 'select id from public.notifications');
    expect(rowCount).toBe(1);
  });

  it('hides one person’s inbox from another', async () => {
    await give(alice);

    const { rowCount } = await actingAs(db, bob, 'select id from public.notifications');
    expect(rowCount).toBe(0);
  });

  it('hides it from an administrator too', async () => {
    // The deliberate omission. Every other table in this schema has an admin
    // branch somewhere; if one appears here, this test is the thing that has to
    // be argued with first.
    await give(alice);

    const { rowCount } = await actingAs(db, admin, 'select id from public.notifications');
    expect(rowCount).toBe(0);
  });

  it('refuses a signed-out visitor outright', async () => {
    // Not "returns nothing" — `anon` holds no grant on the table at all, so the
    // refusal happens before any policy is consulted. The louder answer, and
    // the right one: there is no such thing as an anonymous inbox.
    await give(alice);

    await expectDenied(() => actingAsAnon(db, 'select id from public.notifications'));
  });

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  it('refuses to let anybody put a notification in their own inbox', async () => {
    // Harmless on its own — but the same grant would let them write one into
    // somebody else's, and there is no version of that which is wanted.
    await expectDenied(() =>
      actingAs(
        db,
        alice,
        `insert into public.notifications (recipient_id, kind, title)
         values ($1, 'listing_approved', 'Your listing is on the market')`,
        [alice],
      ),
    );
  });

  it('refuses to let anybody write into somebody else’s', async () => {
    await expectDenied(() =>
      actingAs(
        db,
        bob,
        `insert into public.notifications (recipient_id, kind, title)
         values ($1, 'nda_issued', 'A seller sent you an agreement')`,
        [alice],
      ),
    );
  });

  it('refuses to let a recipient delete the record of what they were told', async () => {
    const id = await give(alice);

    // No DELETE grant, so this is a privilege error rather than zero rows.
    await expectDenied(() =>
      actingAs(db, alice, 'delete from public.notifications where id = $1', [id]),
    );
  });

  // -------------------------------------------------------------------------
  // The one legitimate edit
  // -------------------------------------------------------------------------

  it('lets a recipient mark their own read', async () => {
    const id = await give(alice);

    const { rowCount } = await actingAs(
      db,
      alice,
      'update public.notifications set read_at = now() where id = $1',
      [id],
    );
    expect(rowCount).toBe(1);
  });

  it('lets them mark it unread again', async () => {
    // Not a hypothetical: somebody clears the badge on a phone, then wants the
    // one that mattered back at the top of the list.
    const id = await give(alice);
    await db.query('update public.notifications set read_at = now() where id = $1', [id]);

    const { rowCount } = await actingAs(
      db,
      alice,
      'update public.notifications set read_at = null where id = $1',
      [id],
    );
    expect(rowCount).toBe(1);
  });

  it('refuses to let a recipient rewrite what it says', async () => {
    // The reason the trigger exists. A recipient who could edit the title could
    // dispute having been told — and the row is the platform's record that they
    // were.
    const id = await give(alice);

    await expectDenied(() =>
      actingAs(db, alice, 'update public.notifications set title = $2 where id = $1', [
        id,
        'Nothing happened',
      ]),
    );
  });

  it('refuses to let a recipient redirect where it points', async () => {
    const id = await give(alice);

    await expectDenied(() =>
      actingAs(db, alice, 'update public.notifications set href = $2 where id = $1', [
        id,
        '/admin',
      ]),
    );
  });

  it('refuses to let a recipient hand it to somebody else', async () => {
    const id = await give(alice);

    await expectDenied(() =>
      actingAs(db, alice, 'update public.notifications set recipient_id = $2 where id = $1', [
        id,
        bob,
      ]),
    );
  });

  it('refuses to let a recipient forge an email receipt', async () => {
    // `emailed_at` is how a sender added later avoids re-sending the backlog.
    // A recipient who could stamp it could silence their own notifications in a
    // way that looks, from the outside, like delivery.
    const id = await give(alice);

    await expectDenied(() =>
      actingAs(db, alice, 'update public.notifications set emailed_at = now() where id = $1', [id]),
    );
  });

  it('does not let one person mark another’s read', async () => {
    const id = await give(alice);

    // Zero rows rather than an error: the policy hides the row, so there is
    // nothing to update. Both answers are safe; this is the one to expect.
    const { rowCount } = await actingAs(
      db,
      bob,
      'update public.notifications set read_at = now() where id = $1',
      [id],
    );
    expect(rowCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The bell
  // -------------------------------------------------------------------------

  it('counts only the caller’s unread', async () => {
    await give(alice);
    await give(alice);
    await give(bob);

    const read = await give(alice);
    await db.query('update public.notifications set read_at = now() where id = $1', [read]);

    const { rows } = await actingAs<{ count: number }>(
      db,
      alice,
      'select public.unread_notification_count() as count',
    );
    expect(Number(rows[0]!.count)).toBe(2);
  });

  it('counts zero for somebody with an empty inbox', async () => {
    await give(alice);

    const { rows } = await actingAs<{ count: number }>(
      db,
      bob,
      'select public.unread_notification_count() as count',
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('marks everything read without touching anybody else', async () => {
    await give(alice);
    await give(alice);
    await give(bob);

    const { rows } = await actingAs<{ marked: number }>(
      db,
      alice,
      'select public.mark_notifications_read() as marked',
    );
    expect(Number(rows[0]!.marked)).toBe(2);

    const remaining = await db.query<{ count: string }>(
      'select count(*) as count from public.notifications where read_at is null',
    );
    // Bob's is the one left.
    expect(Number(remaining.rows[0]!.count)).toBe(1);
  });

  it('leaves anything that arrived after the cutoff', async () => {
    // The reason the function takes a timestamp at all: "mark all read" on a
    // page that was rendered a minute ago must not swallow something that
    // arrived while the user was reading it.
    await give(alice, 'nda_requested', 60);
    await give(alice);

    const { rows } = await actingAs<{ marked: number }>(
      db,
      alice,
      `select public.mark_notifications_read(now() - interval '30 minutes') as marked`,
    );
    expect(Number(rows[0]!.marked)).toBe(1);
  });

  it('refuses the count and the marker to a signed-out visitor', async () => {
    await expectDenied(() => actingAsAnon(db, 'select public.unread_notification_count()'));
    await expectDenied(() => actingAsAnon(db, 'select public.mark_notifications_read()'));
  });

  // -------------------------------------------------------------------------
  // Constraints on what a notification may be
  // -------------------------------------------------------------------------

  it('refuses an absolute URL as a destination', async () => {
    // A stored absolute URL is how a notification written on staging links a
    // customer to staging six months later — and how an attacker with any write
    // path would point one off-platform.
    await expect(
      db.query(
        `insert into public.notifications (recipient_id, kind, title, href)
         values ($1, 'new_match', 'A new match', 'https://elsewhere.example/phish')`,
        [alice],
      ),
    ).rejects.toThrow();
  });

  it('refuses a protocol-relative destination', async () => {
    // `//evil.example` is a URL, not a path, and `like '/%'` alone admits it —
    // a browser reads it as "that other host". This test is why the constraint
    // has three clauses instead of one.
    await expect(
      db.query(
        `insert into public.notifications (recipient_id, kind, title, href)
         values ($1, 'new_match', 'A new match', '//evil.example/phish')`,
        [alice],
      ),
    ).rejects.toThrow();
  });

  it('refuses the backslash version of the same trick', async () => {
    // Browsers normalise `/\` to `//`, so excluding only `//` leaves the door
    // open by one character.
    await expect(
      db.query(
        `insert into public.notifications (recipient_id, kind, title, href)
         values ($1, 'new_match', 'A new match', '/\\evil.example/phish')`,
        [alice],
      ),
    ).rejects.toThrow();
  });

  it('still accepts an ordinary path', async () => {
    // The constraint is three exclusions deep; this is the test that stops the
    // fourth one from breaking every link on the platform.
    await expect(
      db.query(
        `insert into public.notifications (recipient_id, kind, title, href)
         values ($1, 'new_match', 'A new match', '/matches')`,
        [alice],
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses an empty title', async () => {
    await expect(
      db.query(
        `insert into public.notifications (recipient_id, kind, title) values ($1, 'new_match', '   ')`,
        [alice],
      ),
    ).rejects.toThrow();
  });

  it('removes an inbox with the account', async () => {
    const gone = await createAuthUser(db, 'notify-departing@example.com');
    await give(gone);

    await db.query('delete from auth.users where id = $1', [gone]);

    const { rows } = await db.query<{ count: string }>(
      'select count(*) as count from public.notifications where recipient_id = $1',
      [gone],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  it('lets somebody set their own preferences', async () => {
    const { rowCount } = await actingAs(
      db,
      alice,
      `insert into public.notification_preferences (user_id, email_messages)
       values ($1, false)`,
      [alice],
    );
    expect(rowCount).toBe(1);
  });

  it('refuses to let somebody set preferences for another account', async () => {
    // Otherwise turning off a competitor's match emails is a one-line request.
    await expectDenied(() =>
      actingAs(
        db,
        bob,
        `insert into public.notification_preferences (user_id, email_new_matches)
         values ($1, false)`,
        [alice],
      ),
    );
  });

  it('hides one person’s preferences from another', async () => {
    await db.query(
      'insert into public.notification_preferences (user_id, email_digest) values ($1, true)',
      [alice],
    );

    const { rowCount } = await actingAs(
      db,
      bob,
      'select user_id from public.notification_preferences',
    );
    expect(rowCount).toBe(0);
  });

  it('defaults every email category on', async () => {
    // A marketplace where notifications are opt-in is one where the first NDA
    // request is missed, and the first one is the one that matters.
    await db.query('insert into public.notification_preferences (user_id) values ($1)', [alice]);

    const { rows } = await db.query<{
      email_deal_activity: boolean;
      email_new_matches: boolean;
      email_listing_status: boolean;
      email_messages: boolean;
      email_digest: boolean;
    }>('select * from public.notification_preferences where user_id = $1', [alice]);

    const row = rows[0]!;
    expect(row.email_deal_activity).toBe(true);
    expect(row.email_new_matches).toBe(true);
    expect(row.email_listing_status).toBe(true);
    expect(row.email_messages).toBe(true);
    // The one that is off: somebody whose listing has just gone live wants the
    // first access request within the hour, not tomorrow morning.
    expect(row.email_digest).toBe(false);
  });
});
