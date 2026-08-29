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
 * Buyer verification, which is the one table in this schema that holds a
 * statement about somebody's money.
 *
 * Two claims carry the file:
 *
 *   1. **A seller never reads the table.** They read a function that returns a
 *      status and a band. The evidence note, the reviewer's note and the
 *      reviewer's identity are not reachable by them through any path.
 *   2. **No buyer can award themselves a status.** Not on insert, not on
 *      update, not by withdrawing and resubmitting.
 *
 * The second is worth testing at the database rather than trusting to a server
 * action, because a verified badge a buyer can set is a badge that means the
 * opposite of what a seller reads it as.
 */
describe.skipIf(!hasDatabase)('buyer verification', () => {
  let db: Client;

  let seller: string;
  let otherSeller: string;
  let buyer: string;
  let strangerBuyer: string;
  let admin: string;

  let listing: string;

  async function submit(who: string, band = 'from_1m_to_5m') {
    return actingAs(
      db,
      who,
      `insert into public.buyer_verifications
         (buyer_id, evidence_kind, capacity_band, evidence_note)
       values ($1, 'sba_preapproval', $2::text::app.capacity_band,
               'Pre-approval letter from Northfield Bank, dated last month.')
       returning id`,
      [who, band],
    );
  }

  async function badge(caller: string, target: string) {
    return actingAs<{
      status: string;
      capacity_band: string;
      is_current: boolean;
    }>(db, caller, 'select * from public.buyer_verification_badge($1)', [target]);
  }

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'ver-seller@example.com');
    otherSeller = await createAuthUser(db, 'ver-seller-2@example.com');
    buyer = await createAuthUser(db, 'ver-buyer@example.com');
    strangerBuyer = await createAuthUser(db, 'ver-buyer-2@example.com');
    admin = await createAuthUser(db, 'ver-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values
         ($1,'seller'), ($2,'seller'), ($3,'buyer'), ($4,'buyer'), ($5,'admin')`,
      [seller, otherSeller, buyer, strangerBuyer, admin],
    );

    await db.query(`update public.jurisdictions set is_active = true where code = 'US-NY'`);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.listings
         (seller_id, headline, industry, jurisdiction_code, status, published_at)
       values ($1, 'Established HVAC contractor', 'home_services', 'US-NY', 'live', now())
       returning id`,
      [seller],
    );
    listing = rows[0]!.id;

    // The buyer has approached this seller's listing. Not signed — requested,
    // which is the moment the badge has to work.
    await db.query(
      `insert into public.listing_ndas (listing_id, buyer_id, status)
       values ($1, $2, 'requested')`,
      [listing, buyer],
    );
  });

  beforeEach(async () => {
    await db.query('delete from public.buyer_verifications');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ==========================================================================
  // Submitting
  // ==========================================================================

  it('lets a buyer submit their own capacity', async () => {
    const result = await submit(buyer);
    expect(result.rowCount).toBe(1);
  });

  it('refuses a buyer submitting on behalf of somebody else', async () => {
    await expectDenied(() =>
      actingAs(
        db,
        buyer,
        `insert into public.buyer_verifications (buyer_id, evidence_kind, capacity_band)
         values ($1, 'cash', 'over_25m')`,
        [strangerBuyer],
      ),
    );
  });

  it('refuses a submission that arrives already verified', async () => {
    // The obvious attack, and the reason the insert policy pins the status
    // rather than relying on the column default.
    await expectDenied(() =>
      actingAs(
        db,
        buyer,
        `insert into public.buyer_verifications
           (buyer_id, evidence_kind, capacity_band, status, expires_at)
         values ($1, 'cash', 'over_25m', 'verified', now() + interval '180 days')`,
        [buyer],
      ),
    );
  });

  it('refuses a submission that pre-fills the review', async () => {
    await expectDenied(() =>
      actingAs(
        db,
        buyer,
        `insert into public.buyer_verifications
           (buyer_id, evidence_kind, capacity_band, reviewed_at, reviewed_by)
         values ($1, 'cash', 'over_25m', now(), $1)`,
        [buyer],
      ),
    );
  });

  it('holds one submission per buyer', async () => {
    await submit(buyer);
    await expectDenied(() => submit(buyer));
  });

  // ==========================================================================
  // Who may decide
  // ==========================================================================

  it('refuses a buyer promoting their own pending submission', async () => {
    await submit(buyer);
    await expectDenied(() =>
      actingAs(
        db,
        buyer,
        `update public.buyer_verifications
            set status = 'verified', expires_at = now() + interval '180 days'
          where buyer_id = $1`,
        [buyer],
      ),
    );
  });

  it('lets a buyer correct a pending submission', async () => {
    await submit(buyer);
    const result = await actingAs(
      db,
      buyer,
      `update public.buyer_verifications
          set capacity_band = 'from_5m_to_25m', evidence_note = 'Updated letter.'
        where buyer_id = $1`,
      [buyer],
    );
    expect(result.rowCount).toBe(1);
  });

  it('lets an operator verify, and records who decided', async () => {
    await submit(buyer);

    await actingAs(
      db,
      admin,
      `update public.buyer_verifications
          set status = 'verified', expires_at = now() + interval '180 days',
              review_note = 'Letter sighted.'
        where buyer_id = $1`,
      [buyer],
    );

    const { rows } = await db.query<{ reviewed_by: string; reviewed_at: string }>(
      'select reviewed_by, reviewed_at from public.buyer_verifications where buyer_id = $1',
      [buyer],
    );
    // Taken from the session, not from what the statement supplied — a decision
    // recorded against the wrong operator is worse than no record.
    expect(rows[0]!.reviewed_by).toBe(admin);
    expect(rows[0]!.reviewed_at).not.toBeNull();
  });

  it('refuses an operator rewriting the buyer’s own claim', async () => {
    await submit(buyer);
    await expectDenied(() =>
      actingAs(
        db,
        admin,
        `update public.buyer_verifications set capacity_band = 'over_25m' where buyer_id = $1`,
        [buyer],
      ),
    );
  });

  it('refuses a buyer editing a claim after it was approved', async () => {
    await submit(buyer);
    await actingAs(
      db,
      admin,
      `update public.buyer_verifications
          set status = 'verified', expires_at = now() + interval '180 days'
        where buyer_id = $1`,
      [buyer],
    );

    // Otherwise a verified badge sits attached to a statement nobody reviewed.
    await expectDenied(() =>
      actingAs(
        db,
        buyer,
        `update public.buyer_verifications set capacity_band = 'over_25m' where buyer_id = $1`,
        [buyer],
      ),
    );
  });

  it('lets a buyer withdraw, and nobody delete', async () => {
    await submit(buyer);

    const withdrawn = await actingAs(
      db,
      buyer,
      `update public.buyer_verifications set status = 'withdrawn' where buyer_id = $1`,
      [buyer],
    );
    expect(withdrawn.rowCount).toBe(1);

    /*
     * Refused at the grant, not merely filtered by a policy — the table grants
     * select, insert and update and nothing else. A rejected buyer therefore
     * cannot clear the record and resubmit until somebody says yes, and the
     * refusal is a privilege error rather than a quiet zero-row delete, which
     * is the difference between "you may not" and "there was nothing there".
     */
    const denial = await expectDenied(() =>
      actingAs(db, buyer, 'delete from public.buyer_verifications where buyer_id = $1', [buyer]),
    );
    expect(denial.code).toBe('42501');
  });

  // ==========================================================================
  // Reading — the part that leaks finances if it is wrong
  // ==========================================================================

  it('does not let a seller read the table at all', async () => {
    await submit(buyer);

    // Not a narrowed policy. None. RLS is row-level, so any policy that let a
    // seller see the row would hand them the evidence note with it.
    const result = await actingAs(
      db,
      seller,
      'select * from public.buyer_verifications where buyer_id = $1',
      [buyer],
    );
    expect(result.rowCount).toBe(0);
  });

  it('gives a seller the badge for a buyer who approached their listing', async () => {
    await submit(buyer);
    await actingAs(
      db,
      admin,
      `update public.buyer_verifications
          set status = 'verified', expires_at = now() + interval '180 days'
        where buyer_id = $1`,
      [buyer],
    );

    const result = await badge(seller, buyer);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.status).toBe('verified');
    expect(result.rows[0]!.capacity_band).toBe('from_1m_to_5m');
    expect(result.rows[0]!.is_current).toBe(true);
  });

  it('gives the badge while the NDA is only requested', async () => {
    // The whole point. A seller deciding whether to disclose needs this before
    // disclosing, not after.
    await submit(buyer);
    const result = await badge(seller, buyer);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.status).toBe('pending');
  });

  it('returns nothing to a seller the buyer never approached', async () => {
    await submit(buyer);
    const result = await badge(otherSeller, buyer);
    expect(result.rowCount).toBe(0);
  });

  it('returns nothing to a buyer about another buyer', async () => {
    await submit(buyer);
    const result = await badge(strangerBuyer, buyer);
    expect(result.rowCount).toBe(0);
  });

  it('returns nothing to anon', async () => {
    await submit(buyer);
    await expectDenied(() =>
      actingAsAnon(db, 'select * from public.buyer_verification_badge($1)', [buyer]),
    );
  });

  it('never returns the evidence, the reviewer or an exact figure', async () => {
    /*
     * The structural claim, asserted against the function's actual signature
     * rather than against a query somebody wrote. A later change that adds a
     * column here would be adding it to every seller's view of every buyer who
     * ever approached them.
     */
    await submit(buyer);

    // Read from the catalogue rather than from a result set: a query only shows
    // the columns that query asked for, which would make this test agree with
    // whatever it happened to select. `proargnames` is the signature itself.
    const { rows } = await db.query<{ name: string }>(
      `select unnest(p.proargnames[2:]) as name
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'buyer_verification_badge'`,
    );
    const columns = rows.map((row) => row.name);

    expect(columns).toEqual([
      'status',
      'capacity_band',
      'verified_at',
      'expires_at',
      'is_current',
    ]);
    expect(columns).not.toContain('evidence_note');
    expect(columns).not.toContain('review_note');
    expect(columns).not.toContain('reviewed_by');
  });

  it('reports a lapsed verification as no longer current', async () => {
    await submit(buyer);
    await actingAs(
      db,
      admin,
      `update public.buyer_verifications
          set status = 'verified', expires_at = now() + interval '180 days'
        where buyer_id = $1`,
      [buyer],
    );
    /*
     * Backdated by the operator, which is the only path the trigger allows and
     * is the same edit the passage of time performs. A direct superuser update
     * would not work here — the trigger fires for that too, sees no admin in
     * the session, and takes the buyer branch.
     */
    await actingAs(
      db,
      admin,
      `update public.buyer_verifications set expires_at = now() - interval '1 day'
        where buyer_id = $1`,
      [buyer],
    );

    const result = await badge(seller, buyer);
    // Still 'verified' — that is what happened — but not current, because proof
    // of funds from last year tells a seller nothing.
    expect(result.rows[0]!.status).toBe('verified');
    expect(result.rows[0]!.is_current).toBe(false);
  });

  // ==========================================================================
  // Integrity
  // ==========================================================================

  it('refuses a verified row with no expiry', async () => {
    await submit(buyer);
    await expectDenied(() =>
      actingAs(
        db,
        admin,
        `update public.buyer_verifications set status = 'verified' where buyer_id = $1`,
        [buyer],
      ),
    );
  });

  it('does not grant execute on the badge to public', async () => {
    // Postgres grants EXECUTE to PUBLIC on creation. For a definer function
    // reading somebody's finances that default has to be revoked, and this has
    // caught the omission twice already in this schema.
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.buyer_verification_badge(uuid)', 'execute')
              as ok`,
    );
    expect(rows[0]!.ok).toBe(false);
  });
});
