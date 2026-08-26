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
 * Credentials handed to an external AI agent.
 *
 * A token here authenticates as a real person against their own live deal data,
 * and unlike a password there is no second factor in front of it. So the
 * questions this file asks are the ones that matter when one leaks:
 *
 *   - Does the table hold anything usable? (No — a digest.)
 *   - Can somebody else read or use mine? (No, including an administrator.)
 *   - Can a revoked or expired token still resolve? (No.)
 *   - Can a read-only token quietly become something else? (No — revoke only.)
 */
describe.skipIf(!hasDatabase)('mcp tokens', () => {
  let db: Client;

  let owner: string;
  let stranger: string;
  let admin: string;

  const digestOf = (value: string) =>
    db
      .query<{ d: string }>(`select encode(sha256($1::bytea), 'hex') as d`, [value])
      .then((r) => r.rows[0]!.d);

  async function issue(
    user: string,
    label = 'Manus',
    opts: { scopes?: string; expires?: string; secret?: string } = {},
  ) {
    const secret = opts.secret ?? `ash_mcp_${label}_${user.slice(0, 8)}`;
    return actingAs(
      db,
      user,
      `insert into public.mcp_tokens (user_id, label, token_sha256, token_hint, scopes, expires_at)
       values ($1, $2, encode(sha256($3::bytea), 'hex'), 'ash_mcp_', $4::app.mcp_scope[],
               now() + ($5)::interval)
       returning id`,
      [user, label, secret, opts.scopes ?? '{read:listings}', opts.expires ?? '90 days'],
    );
  }

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    owner = await createAuthUser(db, 'mcp-owner@example.com');
    stranger = await createAuthUser(db, 'mcp-stranger@example.com');
    admin = await createAuthUser(db, 'mcp-admin@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'buyer'), ($2,'buyer'), ($3,'admin')`,
      [owner, stranger, admin],
    );
  });

  beforeEach(async () => {
    await db.query('delete from public.mcp_tokens');
  });

  afterAll(async () => {
    await db?.end();
  });

  // ==========================================================================
  // A token is its owner's business and nobody else's
  // ==========================================================================

  it('lets a user issue one for themselves', async () => {
    const result = await issue(owner);
    expect(result.rowCount).toBe(1);
  });

  it('refuses a token issued on behalf of somebody else', async () => {
    await expectDenied(() =>
      actingAs(
        db,
        stranger,
        `insert into public.mcp_tokens (user_id, label, token_sha256, token_hint, scopes, expires_at)
         values ($1, 'stolen', repeat('a', 64), 'ash_mcp_', '{read:listings}'::app.mcp_scope[],
                 now() + interval '90 days')`,
        [owner],
      ),
    );
  });

  it('hides a token from another user', async () => {
    await issue(owner);
    const seen = await actingAs(db, stranger, `select id from public.mcp_tokens`);
    expect(seen.rowCount).toBe(0);
  });

  it('hides a token from an administrator', async () => {
    /*
     * Deliberate, and the reason there is no admin branch on this table. An
     * operator has no business enumerating which agents a user connected, and
     * the digest would be useless to them if they did.
     */
    await issue(owner);
    const seen = await actingAs(db, admin, `select id from public.mcp_tokens`);
    expect(seen.rowCount).toBe(0);
  });

  it('shows a visitor nothing', async () => {
    await issue(owner);
    await expectDenied(() => actingAsAnon(db, `select id from public.mcp_tokens`));
  });

  // ==========================================================================
  // The table holds nothing usable
  // ==========================================================================

  it('stores a digest that is not the token', async () => {
    const secret = 'ash_mcp_a_real_looking_secret';
    await issue(owner, 'Manus', { secret });

    const { rows } = await db.query<{ token_sha256: string }>(
      `select token_sha256 from public.mcp_tokens`,
    );
    expect(rows[0]!.token_sha256).toBe(await digestOf(secret));
    expect(rows[0]!.token_sha256).not.toContain('ash_mcp');
  });

  it('refuses a digest that is not a sha-256 hex string', async () => {
    // Guards against a column that has quietly started holding something else.
    await expect(
      actingAs(
        db,
        owner,
        `insert into public.mcp_tokens (user_id, label, token_sha256, token_hint, scopes, expires_at)
         values ($1, 'x', 'not-a-digest', 'ash_mcp_', '{read:listings}'::app.mcp_scope[],
                 now() + interval '1 day')`,
        [owner],
      ),
    ).rejects.toThrow();
  });

  it('refuses a token with no expiry', async () => {
    await expect(
      actingAs(
        db,
        owner,
        `insert into public.mcp_tokens (user_id, label, token_sha256, token_hint, scopes)
         values ($1, 'forever', repeat('b', 64), 'ash_mcp_', '{read:listings}'::app.mcp_scope[])`,
        [owner],
      ),
    ).rejects.toThrow();
  });

  it('refuses duplicate scopes', async () => {
    await expect(
      issue(owner, 'dupes', { scopes: '{read:listings,read:listings}' }),
    ).rejects.toThrow();
  });

  // ==========================================================================
  // A token may be revoked, not widened
  // ==========================================================================

  it('allows revocation', async () => {
    await issue(owner);
    const revoked = await actingAs(db, owner, `update public.mcp_tokens set revoked_at = now()`);
    expect(revoked.rowCount).toBe(1);
  });

  it('refuses widening the scopes of a live token', async () => {
    // The failure mode: a read-only agent quietly becoming something else.
    // Issuing a new token is cheap; mutating an old one loses the record of what
    // it was permitted to do while it was in use.
    await issue(owner);
    await expect(
      actingAs(
        db,
        owner,
        `update public.mcp_tokens set scopes = '{read:listings,draft:outreach}'::app.mcp_scope[]`,
      ),
    ).rejects.toThrow(/revoked, not rewritten/i);
  });

  it('refuses extending the expiry', async () => {
    await issue(owner);
    await expect(
      actingAs(db, owner, `update public.mcp_tokens set expires_at = now() + interval '3650 days'`),
    ).rejects.toThrow(/revoked, not rewritten/i);
  });

  it('lets a user delete one outright', async () => {
    await issue(owner);
    const deleted = await actingAs(db, owner, `delete from public.mcp_tokens`);
    expect(deleted.rowCount).toBe(1);
  });

  // ==========================================================================
  // Resolving one
  // ==========================================================================

  it('resolves a live token to its owner and scopes', async () => {
    const secret = 'ash_mcp_live_one';
    await issue(owner, 'Manus', { secret, scopes: '{read:listings,run:valuation}' });

    // `scopes` comes back as a Postgres array literal over the wire for a
    // user-defined enum array, so it is unnested rather than parsed here.
    const { rows } = await db.query<{ owner: string; scope: string }>(
      `select owner, unnest(scopes)::text as scope from public.resolve_mcp_token($1)`,
      [await digestOf(secret)],
    );
    expect(rows[0]!.owner).toBe(owner);
    expect(rows.map((r) => r.scope).sort()).toEqual(['read:listings', 'run:valuation']);
  });

  it('stamps last_used_at when it resolves', async () => {
    const secret = 'ash_mcp_stamped';
    await issue(owner, 'Manus', { secret });
    await db.query(`select * from public.resolve_mcp_token($1)`, [await digestOf(secret)]);

    const { rows } = await db.query<{ last_used_at: Date | null }>(
      `select last_used_at from public.mcp_tokens`,
    );
    expect(rows[0]!.last_used_at).not.toBeNull();
  });

  it('resolves nothing for a revoked token', async () => {
    const secret = 'ash_mcp_revoked';
    await issue(owner, 'Manus', { secret });
    await actingAs(db, owner, `update public.mcp_tokens set revoked_at = now()`);

    const { rowCount } = await db.query(`select * from public.resolve_mcp_token($1)`, [
      await digestOf(secret),
    ]);
    expect(rowCount).toBe(0);
  });

  it('resolves nothing for an expired token', async () => {
    const secret = 'ash_mcp_expired';
    /*
     * Inserted already expired rather than back-dated afterwards. The update
     * trigger freezes expires_at for every caller including a superuser — which
     * is the behaviour the previous test asserts — so there is no way to age a
     * token in place, and that is the correct answer.
     */
    await db.query(
      `insert into public.mcp_tokens
         (user_id, label, token_sha256, token_hint, scopes, created_at, expires_at)
       values ($1, 'stale', encode(sha256($2::bytea), 'hex'), 'ash_mcp_',
               '{read:listings}'::app.mcp_scope[],
               now() - interval '2 days', now() - interval '1 day')`,
      [owner, secret],
    );

    const { rowCount } = await db.query(`select * from public.resolve_mcp_token($1)`, [
      await digestOf(secret),
    ]);
    expect(rowCount).toBe(0);
  });

  it('resolves nothing for a digest nobody issued', async () => {
    const { rowCount } = await db.query(`select * from public.resolve_mcp_token($1)`, [
      'f'.repeat(64),
    ]);
    expect(rowCount).toBe(0);
  });

  it('is not callable by a signed-in user or a visitor', async () => {
    // It resolves credentials; reaching it from a session would be a way to
    // confirm a guessed digest.
    await expectDenied(() =>
      actingAs(db, owner, `select * from public.resolve_mcp_token(repeat('a', 64))`),
    );
    await expectDenied(() =>
      actingAsAnon(db, `select * from public.resolve_mcp_token(repeat('a', 64))`),
    );
  });
});
