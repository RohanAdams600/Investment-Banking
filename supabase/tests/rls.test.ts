import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * A skipped suite and a passing suite look identical in CI output.
 *
 * The database tests skip without DATABASE_URL, which is what keeps `pnpm test`
 * working on a laptop with no Postgres. That same behaviour would let a
 * misconfigured pipeline drop every RLS check and still report green, so in CI
 * the absence of a database is a failure rather than a skip.
 */
describe('database test prerequisites', () => {
  it('has a database configured when running in CI', () => {
    if (process.env.CI) {
      expect(
        hasDatabase,
        'DATABASE_URL is not set in CI — the RLS suite would silently skip.',
      ).toBe(true);
    }
  });
});

/**
 * Row Level Security behaviour, exercised against a real Postgres.
 *
 * The application-level permission model is tested separately and exhaustively
 * in packages/core/src/access/can.test.ts. This suite tests the *second* line
 * of defence: what the database itself refuses when a request reaches it
 * without going through those checks.
 */
describe.skipIf(!hasDatabase)('row level security', () => {
  let db: Client;

  // Two firms with no relationship to each other — the setup that makes
  // cross-tenant leakage visible.
  let brokerageId: string;
  let rivalFirmId: string;

  let ownerId: string; // owner of the brokerage
  let memberId: string; // plain member of the brokerage
  let rivalId: string; // owner of the rival firm, no relationship to the brokerage
  let adminId: string; // platform admin
  let strangerId: string; // authenticated, belongs to nothing

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    ownerId = await createAuthUser(db, 'owner@example.com');
    memberId = await createAuthUser(db, 'member@example.com');
    rivalId = await createAuthUser(db, 'rival@example.com');
    adminId = await createAuthUser(db, 'admin@example.com');
    strangerId = await createAuthUser(db, 'stranger@example.com');

    // Seeded as superuser, standing in for the service role.
    const firms = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values
         ('Cairn Brokerage', 'brokerage'),
         ('Rival Partners', 'private_equity')
       returning id`,
    );
    brokerageId = firms.rows[0]!.id;
    rivalFirmId = firms.rows[1]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role) values
         ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`,
      [brokerageId, ownerId, memberId, rivalFirmId, rivalId],
    );

    // Profiles are not inserted here — the 0007 trigger creates one for every
    // auth user, and this suite asserting on them is how we know it fires.

    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [adminId]);
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'broker')`, [
      ownerId,
    ]);

    await db.query(
      `insert into public.jurisdictions (code, name, country_code, is_active) values
         ('US-NY', 'New York', 'US', true),
         ('US-WY', 'Wyoming', 'US', false)`,
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  // -------------------------------------------------------------------------

  describe('schema-wide guarantees', () => {
    it('has RLS enabled AND forced on every table in public', async () => {
      // FORCE is the half that gets forgotten. Without it, any connection that
      // happens to be the table owner bypasses every policy silently.
      const { rows } = await db.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
          order by c.relname`,
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const table of rows) {
        expect(table.relrowsecurity, `${table.relname} has RLS disabled`).toBe(true);
        expect(table.relforcerowsecurity, `${table.relname} does not FORCE RLS`).toBe(true);
      }
    });

    it('grants authenticated exactly the privileges it should have', async () => {
      // Supabase's default privileges grant ALL on every new table in `public`
      // to anon and authenticated. 0008 revokes that down to this allowlist.
      //
      // The local shim reproduces Supabase's defaults on purpose, so this test
      // fails if 0008 is dropped or if a new table is added without a matching
      // grant. Before the shim was made faithful, this whole class of bug was
      // invisible locally and live on the real project.
      const expected: Record<string, string[]> = {
        audit_log: ['SELECT'],
        consent_records: ['INSERT', 'SELECT'],
        firm_members: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        firms: ['SELECT', 'UPDATE'],
        jurisdictions: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        legal_templates: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        profiles: ['INSERT', 'SELECT', 'UPDATE'],
        user_roles: ['DELETE', 'INSERT', 'SELECT'],

        // Messaging. Note what is missing: no INSERT on deals or conversations
        // (created server-side), no DELETE on messages (withdrawal is a soft
        // delete through withdraw_message), and SELECT only on the audit log.
        deals: ['SELECT'],
        deal_conversations: ['SELECT'],
        conversation_members: ['INSERT', 'SELECT', 'UPDATE'],
        messages: ['INSERT', 'SELECT', 'UPDATE'],
        message_audit_log: ['SELECT'],

        // Valuation, criteria and legal drafts. Note no DELETE on criteria
        // (superseded, not removed) or on drafts (part of the negotiating
        // record once shared).
        valuation_estimates: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        acquisition_criteria: ['INSERT', 'SELECT', 'UPDATE'],
        legal_document_drafts: ['INSERT', 'SELECT', 'UPDATE'],
      };

      const { rows } = await db.query<{ table_name: string; privs: string }>(
        `select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
           from information_schema.role_table_grants
          where grantee = 'authenticated' and table_schema = 'public'
          group by table_name
          order by table_name`,
      );

      const actual = Object.fromEntries(rows.map((r) => [r.table_name, r.privs.split(',')]));
      expect(actual).toEqual(expected);
    });

    it('never grants TRUNCATE or TRIGGER to a client role', async () => {
      // TRUNCATE ignores RLS entirely — a client holding it could empty the
      // audit log regardless of any policy.
      const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type
           from information_schema.role_table_grants
          where grantee in ('anon', 'authenticated')
            and table_schema = 'public'
            and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')`,
      );

      expect(rows).toEqual([]);
    });

    it('does not let anon execute any function in the exposed public schema', async () => {
      // PostgREST publishes `public` functions as /rest/v1/rpc/<name>, and
      // Supabase's default privileges grant EXECUTE to anon. A SECURITY DEFINER
      // function reachable that way runs with its owner's privileges for a
      // caller who never signed in.
      //
      // `revoke ... from public` does NOT cover this: PUBLIC is the implicit
      // everyone-role, and the grant to anon is a separate explicit one.
      const { rows } = await db.query<{ proname: string }>(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );

      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it('lets authenticated execute create_firm', async () => {
      // The other half of the check above — locking anon out must not have
      // locked out the role that is supposed to call it.
      const { rows } = await db.query<{ allowed: boolean }>(
        `select has_function_privilege('authenticated', p.oid, 'EXECUTE') as allowed
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_firm'`,
      );

      expect(rows[0]?.allowed).toBe(true);
    });

    it('pins search_path on every function in the app schema', async () => {
      // Widened from SECURITY DEFINER only. The original version keyed on
      // `prosecdef`, which skipped the invoker-rights trigger helper entirely —
      // Supabase's linter caught what this test was shaped not to look at.
      const { rows } = await db.query<{ proname: string; proconfig: string[] | null }>(
        `select p.proname, p.proconfig
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'`,
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const fn of rows) {
        expect(
          fn.proconfig?.some((c) => c.startsWith('search_path=')),
          `${fn.proname}`,
        ).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('shows a firm member their own firm and nothing else', async () => {
      const { rows } = await actingAs<{ id: string }>(db, ownerId, 'select id from public.firms');

      expect(rows.map((r) => r.id)).toEqual([brokerageId]);
    });

    it('hides the rival firm from a brokerage member', async () => {
      const { rows } = await actingAs(db, memberId, 'select id from public.firms where id = $1', [
        rivalFirmId,
      ]);

      expect(rows).toHaveLength(0);
    });

    it('shows a user with no firm nothing at all', async () => {
      const { rows } = await actingAs(db, strangerId, 'select id from public.firms');
      expect(rows).toHaveLength(0);
    });

    it('lets a platform admin see every firm, for verification', async () => {
      const { rows } = await actingAs(db, adminId, 'select id from public.firms');
      expect(rows).toHaveLength(2);
    });

    it('hides firm membership across tenants', async () => {
      const { rows } = await actingAs(
        db,
        rivalId,
        'select user_id from public.firm_members where firm_id = $1',
        [brokerageId],
      );

      expect(rows).toHaveLength(0);
    });

    it('refuses a cross-tenant update even from a firm administrator', async () => {
      // The owner of the brokerage attempting to rename a rival firm. The
      // policy filters the row out, so this updates nothing rather than erroring.
      const { rowCount } = await actingAs(
        db,
        ownerId,
        `update public.firms set name = 'Seized' where id = $1`,
        [rivalFirmId],
      );

      expect(rowCount).toBe(0);

      const { rows } = await db.query<{ name: string }>(
        'select name from public.firms where id = $1',
        [rivalFirmId],
      );
      expect(rows[0]!.name).toBe('Rival Partners');
    });
  });

  // -------------------------------------------------------------------------

  describe('firm membership', () => {
    it('lets a firm owner add a member', async () => {
      const newcomer = await createAuthUser(db, 'newcomer@example.com');

      const { rowCount } = await actingAs(
        db,
        ownerId,
        `insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'member')`,
        [brokerageId, newcomer],
      );

      expect(rowCount).toBe(1);
    });

    it('refuses a plain member adding somebody', async () => {
      const outsider = await createAuthUser(db, 'outsider@example.com');

      const denial = await expectDenied(() =>
        actingAs(
          db,
          memberId,
          `insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'member')`,
          [brokerageId, outsider],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses a stranger self-inserting as owner of any firm', async () => {
      // There is no self-join branch at all. The only route to a first member
      // is create_firm(), which does it in the same transaction as the firm.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          strangerId,
          `insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'owner')`,
          [brokerageId, strangerId],
        ),
      );

      expect(denial.code).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------

  describe('create_firm', () => {
    it('creates the firm and installs the caller as owner atomically', async () => {
      const founder = await createAuthUser(db, 'founder@example.com');

      const { rows } = await actingAs<{ create_firm: string }>(
        db,
        founder,
        `select public.create_firm('New Search Fund', 'search_fund')`,
      );
      const newFirmId = rows[0]!.create_firm;

      const membership = await db.query<{ role: string }>(
        'select role from public.firm_members where firm_id = $1 and user_id = $2',
        [newFirmId, founder],
      );

      expect(membership.rows[0]!.role).toBe('owner');

      // And the creator can now read it back through the ordinary select policy.
      const readBack = await actingAs(db, founder, 'select id from public.firms where id = $1', [
        newFirmId,
      ]);
      expect(readBack.rows).toHaveLength(1);
    });

    it('never leaves a firm without an owner', async () => {
      // The property that matters: no window exists in which a firm has no
      // members and could be claimed by whoever inserts first.
      const { rows } = await db.query<{ count: string }>(
        `select count(*)::text as count
           from public.firms f
          where not exists (
            select 1 from public.firm_members m
             where m.firm_id = f.id and m.role = 'owner'
          )`,
      );

      // Fixture firms are seeded with owners; anything created through the
      // function is owned by construction.
      expect(rows[0]!.count).toBe('0');
    });

    it('refuses direct inserts into firms, bypassing the function', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, strangerId, `insert into public.firms (name) values ('Bypass')`),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses an anonymous caller', async () => {
      // The function is SECURITY DEFINER, so an unguarded version would let the
      // anon role create firms. Execute is not granted to anon, and the
      // auth.uid() guard inside is the second stop.
      const denial = await expectDenied(() =>
        actingAsAnon(db, `select public.create_firm('Anonymous Firm')`),
      );

      expect(denial.code).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------

  describe('platform roles', () => {
    it('lets a user grant themselves an ordinary role', async () => {
      const { rowCount } = await actingAs(
        db,
        strangerId,
        `insert into public.user_roles (user_id, role) values ($1, 'buyer')`,
        [strangerId],
      );

      expect(rowCount).toBe(1);
    });

    it('refuses a user granting themselves admin', async () => {
      // Without the explicit `role <> 'admin'` exclusion, any authenticated
      // user could take over the platform with one insert.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          strangerId,
          `insert into public.user_roles (user_id, role) values ($1, 'admin')`,
          [strangerId],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses a user granting a role to somebody else', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          strangerId,
          `insert into public.user_roles (user_id, role) values ($1, 'seller')`,
          [rivalId],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses a user deleting somebody else’s role', async () => {
      const { rowCount } = await actingAs(
        db,
        strangerId,
        `delete from public.user_roles where user_id = $1`,
        [ownerId],
      );

      expect(rowCount).toBe(0);
    });

    it('hides other users’ roles', async () => {
      const { rows } = await actingAs(
        db,
        strangerId,
        'select role from public.user_roles where user_id = $1',
        [adminId],
      );

      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('profiles', () => {
    it('provisions a profile automatically for every new auth user', async () => {
      const fresh = await createAuthUser(db, 'auto-provisioned@example.com');

      const { rows } = await db.query<{ email: string }>(
        'select email from public.profiles where id = $1',
        [fresh],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.email).toBe('auto-provisioned@example.com');
    });

    it('grants a new user no platform role', async () => {
      // Deny by default extends to registration. An account that defaults to
      // `buyer` would hand listing access to every automated sign-up.
      const fresh = await createAuthUser(db, 'no-roles@example.com');

      const { rows } = await db.query('select role from public.user_roles where user_id = $1', [
        fresh,
      ]);

      expect(rows).toHaveLength(0);
    });

    it('is not a directory — a stranger cannot read another profile', async () => {
      const { rows } = await actingAs(
        db,
        strangerId,
        'select id from public.profiles where id = $1',
        [ownerId],
      );

      expect(rows).toHaveLength(0);
    });

    it('lets firm colleagues see each other', async () => {
      const { rows } = await actingAs(
        db,
        memberId,
        'select id from public.profiles where id = $1',
        [ownerId],
      );

      expect(rows).toHaveLength(1);
    });

    it('refuses editing another user’s profile', async () => {
      const { rowCount } = await actingAs(
        db,
        strangerId,
        `update public.profiles set full_name = 'Hijacked' where id = $1`,
        [ownerId],
      );

      expect(rowCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('append-only tables', () => {
    it('refuses updating a consent record', async () => {
      const template = await db.query<{ id: string }>(
        `insert into public.legal_templates (kind, version, title, body, published_at)
         values ('terms_of_use', 1, 'Terms', 'Body', now()) returning id`,
      );

      await actingAs(
        db,
        strangerId,
        `insert into public.consent_records
           (user_id, template_id, template_kind, template_version, jurisdiction_code)
         values ($1, $2, 'terms_of_use', 1, 'US-NY')`,
        [strangerId, template.rows[0]!.id],
      );

      // No update grant and no update policy. A consent record that can be
      // modified is not evidence of anything.
      const denial = await expectDenied(() =>
        actingAs(db, strangerId, `update public.consent_records set template_version = 2`),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses deleting a consent record', async () => {
      const denial = await expectDenied(() =>
        actingAs(db, strangerId, 'delete from public.consent_records'),
      );

      expect(denial.code).toBe('42501');
    });

    it('lets a user read their own consent history but not another’s', async () => {
      const own = await actingAs(db, strangerId, 'select id from public.consent_records');
      expect(own.rows.length).toBeGreaterThan(0);

      const other = await actingAs(db, rivalId, 'select id from public.consent_records');
      expect(other.rows).toHaveLength(0);
    });

    it('refuses a client writing to the audit log', async () => {
      // Clients must never forge history. Audit entries are written server-side
      // with the service role.
      const denial = await expectDenied(() =>
        actingAs(
          db,
          ownerId,
          `insert into public.audit_log (actor_user_id, action, entity_type)
           values ($1, 'listing.approved', 'listing')`,
          [ownerId],
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses deleting audit entries, even for a platform admin', async () => {
      await db.query(
        `insert into public.audit_log (actor_user_id, action, entity_type, firm_id)
         values ($1, 'firm.verified', 'firm', $2)`,
        [adminId, brokerageId],
      );

      const denial = await expectDenied(() =>
        actingAs(db, adminId, 'delete from public.audit_log'),
      );

      expect(denial.code).toBe('42501');
    });

    it('lets a firm administrator read their firm’s audit trail', async () => {
      const { rows } = await actingAs(
        db,
        ownerId,
        'select id from public.audit_log where firm_id = $1',
        [brokerageId],
      );

      expect(rows.length).toBeGreaterThan(0);
    });

    it('hides one firm’s audit trail from another firm', async () => {
      const { rows } = await actingAs(
        db,
        rivalId,
        'select id from public.audit_log where firm_id = $1',
        [brokerageId],
      );

      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('public reference data', () => {
    it('lets anonymous visitors read active jurisdictions', async () => {
      // The sign-up form needs these before there is a session.
      const { rows } = await actingAsAnon<{ code: string }>(
        db,
        'select code from public.jurisdictions',
      );

      expect(rows.map((r) => r.code)).toEqual(['US-NY']);
    });

    it('hides inactive jurisdictions from anonymous visitors', async () => {
      const { rows } = await actingAsAnon(
        db,
        'select code from public.jurisdictions where code = $1',
        ['US-WY'],
      );

      expect(rows).toHaveLength(0);
    });

    it('refuses an anonymous visitor writing reference data', async () => {
      const denial = await expectDenied(() =>
        actingAsAnon(
          db,
          `insert into public.jurisdictions (code, name, country_code) values ('US-XX','X','US')`,
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses a non-admin writing reference data', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          ownerId,
          `insert into public.jurisdictions (code, name, country_code) values ('US-ZZ','Z','US')`,
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('hides unpublished legal templates from anonymous visitors', async () => {
      await db.query(
        `insert into public.legal_templates (kind, version, title, body)
         values ('privacy_policy', 1, 'Draft policy', 'Not published')`,
      );

      const { rows } = await actingAsAnon<{ title: string }>(
        db,
        'select title from public.legal_templates',
      );

      expect(rows.map((r) => r.title)).not.toContain('Draft policy');
    });
  });
});
