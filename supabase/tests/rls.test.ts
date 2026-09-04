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
         ('Ridge Brokerage', 'brokerage'),
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
         ('US-WY', 'Wyoming', 'US', false)
       on conflict (code) do update set is_active = excluded.is_active, name = excluded.name`,
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
        /*
         * A view, like `market_listings`, and in this inventory for the same
         * reason: it grants SELECT, so it is part of what `authenticated` can
         * reach. `anon` holds the same SELECT and is checked separately below.
         *
         * The view is the access control for the directory — it exposes
         * published profiles only, and `firm_profiles` itself is unreachable to
         * anyone but the firm's own administrators.
         */
        broker_directory: ['SELECT'],
        consent_records: ['INSERT', 'SELECT'],
        firm_members: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        /*
         * DELETE is granted, unlike most of this schema.
         *
         * The rest withholds it because the record of a business coming to
         * market is not disposable. A directory profile is the opposite: it is
         * a firm's own public page, carrying their name, and a firm that wants
         * to stop appearing is entitled to remove it rather than have it
         * retained unpublished for the platform's convenience.
         */
        firm_profiles: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        firms: ['SELECT', 'UPDATE'],
        jurisdictions: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        legal_templates: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        profiles: ['INSERT', 'SELECT', 'UPDATE'],
        /*
         * DELETE is granted here where most tables are denied it.
         *
         * The reason the rest of this schema withholds DELETE is that the record
         * of a business coming to market, and the agreements around it, is not
         * disposable. A saved search is the opposite: it is a person's own
         * standing request to be emailed, and somebody who wants to stop being
         * emailed is entitled to remove the thing that does it rather than
         * having it retained for the platform's convenience.
         */
        saved_searches: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
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

        // Listings. No DELETE anywhere except financials and the watchlist: a
        // business that came to market, the confidentiality agreements around
        // it, and the record of when it moved are not disposable. A listing
        // leaves the market by being withdrawn, which is a status, not a
        // deletion. Status history has SELECT only — the rows come from a
        // trigger.
        listings: ['INSERT', 'SELECT', 'UPDATE'],
        listing_details: ['INSERT', 'SELECT', 'UPDATE'],
        listing_financials: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        listing_ndas: ['INSERT', 'SELECT', 'UPDATE'],
        listing_status_history: ['SELECT'],
        listing_saves: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],

        /*
         * Paid placement. INSERT and UPDATE are granted at the table level and
         * then narrowed by policy to a platform administrator — a seller with
         * the privilege still cannot promote themselves. No DELETE: what was
         * sold and for how much is a record, and cancellation is a column.
         */
        listing_promotions: ['INSERT', 'SELECT', 'UPDATE'],

        // Matching and outreach. `match_scores` is SELECT only for everyone:
        // scores are written by the matcher with the service role, because
        // scoring reads every buyer's criteria against a listing's confidential
        // figures. A client that could write here would promote itself to the
        // top of every seller's list.
        //
        // No DELETE on outreach either — a message that was approved and sent is
        // a record of something that happened.
        match_scores: ['SELECT'],
        outreach_drafts: ['INSERT', 'SELECT', 'UPDATE'],
        buyer_profiles: ['INSERT', 'SELECT', 'UPDATE'],

        // Questionnaire answers in progress are scratch, and DELETE is granted
        // because starting over should actually clear them. `seller_preferences`
        // has no DELETE: it is the record of what a seller said they wanted, and
        // a buyer's fit score was computed against it.
        questionnaire_responses: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        seller_preferences: ['INSERT', 'SELECT', 'UPDATE'],

        // Append-only. No UPDATE, no DELETE — the value of a revision history
        // is entirely in the guarantee that nobody edited it afterwards.
        legal_document_versions: ['INSERT', 'SELECT'],

        // Commission. No DELETE on either: a fee that was agreed and a fee that
        // was earned are both records of something that happened. A mistaken
        // one is waived with a reason, which leaves a trail.
        fee_agreements: ['INSERT', 'SELECT', 'UPDATE'],
        commission_records: ['INSERT', 'SELECT', 'UPDATE'],

        // A view, and it appears here because `role_table_grants` does not
        // distinguish. SELECT only, and it runs `security_invoker` so the grant
        // widens nothing — it is a shape over rows the caller could already
        // read. If this ever gains a privilege beyond SELECT, something has gone
        // badly wrong.
        /*
         * The CRM, and the one place DELETE is granted broadly.
         *
         * Everything else in this schema withholds it because the rows are
         * records of what happened to *other people* — an NDA somebody signed,
         * a fee that was earned, an entry in an audit trail. A contact typed in
         * wrong is the firm's own working data, and a CRM you cannot tidy is a
         * CRM people stop using, which costs more than the deletion does.
         *
         * The safety net is not the missing grant, it is
         * `leads.contact_id on delete restrict`: tidying a contact that has
         * pipeline history attached is refused rather than cascaded.
         */
        contacts: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        pipeline_stages: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        leads: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        crm_notes: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        crm_tasks: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],

        // The vault. No DELETE on documents or grants: a document in a data
        // room is part of the record of what was disclosed, and a grant is the
        // record of a release — "was this person ever shown the customer list"
        // gets asked after a deal falls apart, and a deleted row answers it
        // wrongly. Withdrawal and revocation are statuses.
        //
        // `document_access_log` is SELECT only for the same reason the platform
        // audit log is: entries are written server-side when a URL is issued,
        // and a client that could write here could fabricate a read — or omit
        // their own, which is the only one they would want to omit.
        deal_documents: ['INSERT', 'SELECT', 'UPDATE'],
        document_grants: ['INSERT', 'SELECT', 'UPDATE'],
        document_access_log: ['SELECT'],

        /*
         * The orchestrator's record. SELECT only for everyone: runs are written
         * with the service role because scoring reads every buyer's criteria
         * against a listing's confidential figures, and a client that could
         * write here could fabricate an approval trail for outreach nobody
         * reviewed.
         */
        agent_runs: ['SELECT'],

        /*
         * The inbox. SELECT and UPDATE, no INSERT and no DELETE, and each
         * absence is load-bearing.
         *
         * No INSERT, because a client that could write here could put a
         * sentence in somebody else's inbox — which is the shape of every
         * phishing message ever sent. Notifications are written with the
         * service role from the action that caused them.
         *
         * No DELETE, because "mark read" and "make it never have happened" are
         * different things, and only the first is the reader's to decide. The
         * UPDATE is narrowed further by a trigger to `read_at` alone.
         */
        notifications: ['SELECT', 'UPDATE'],

        // The preferences are entirely the account holder's, so all three.
        notification_preferences: ['INSERT', 'SELECT', 'UPDATE'],

        /*
         * Credentials for external AI agents. DELETE is granted here and
         * nowhere else in this file for a reason: a user removing an agent
         * should be able to leave no digest behind at all, and a soft-deleted
         * credential is a credential somebody has to reason about later.
         */
        mcp_tokens: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],

        // What was emailed, and whether it arrived. SELECT only: it is a record
        // of what the platform did, not something a client asserts. Written
        // with the service role by the sender, exactly as notifications are.
        email_deliveries: ['SELECT'],

        /*
         * People who arrived before there was inventory. INSERT is granted to
         * `anon` as well — the only table in this schema where that is true,
         * because the whole point is to catch somebody at the moment they are
         * curious, which is before they will make a password. It is safe
         * because there is no read path: see market-interest.test.ts.
         */
        market_interest: ['INSERT', 'SELECT', 'UPDATE'],

        /*
         * The public, crawlable market. A view rather than a table, and the
         * reason it is a view: RLS is row-level, so admitting anon to a live
         * listing row would have admitted them to `seller_id` as well, and
         * PostgREST would happily let anybody group the market by owner. The
         * view has neither that column nor `id`.
         *
         * `anon` holds the same SELECT and is checked separately below.
         */
        market_listings: ['SELECT'],

        /*
         * A listing's daily page-view tally. SELECT only, and the policy narrows
         * it to whoever controls the listing — the seller asks "how many people
         * looked", and a buyer who could read it would negotiate with it.
         *
         * No INSERT or UPDATE for anybody: the definer function is the only way
         * a row moves, otherwise a seller inflates their own numbers.
         */
        listing_view_days: ['SELECT'],

        /*
         * Buyer funding evidence. No DELETE, deliberately: a rejected buyer who
         * could delete the row would resubmit until somebody said yes, and the
         * operator's decision history would vanish with it. Withdrawal is a
         * status, not a deletion.
         *
         * Sellers hold nothing here at all. They read
         * `buyer_verification_badge()`, which returns a status and a band —
         * admitting them to the row would admit them to the evidence note in
         * it, because RLS cannot hide a column.
         */
        buyer_verifications: ['INSERT', 'SELECT', 'UPDATE'],

        listing_review_queue: ['SELECT'],

        // Also a view, and the reason it exists is the grant above it:
        // `listing_status_history` carries a reviewer's explanation, RLS cannot
        // hide a single column, so the market gets a view with no such column
        // rather than the table.
        listing_status_timeline: ['SELECT'],
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

    it('never calls auth.uid() bare in a policy', async () => {
      /*
       * A performance invariant, enforced like a security one, because it fails
       * the same way: invisibly, until there is enough data to matter.
       *
       * `auth.uid()` written bare in a policy is a per-row expression —
       * Postgres calls it once for every row it examines. Wrapped in a scalar
       * subquery it becomes an InitPlan: evaluated once, compared as a
       * constant. Same answer, and the difference between a browse page that
       * loads and one that times out.
       *
       * The natural thing to write is the bare call, so this exists to catch
       * the next policy somebody adds rather than to congratulate 0027.
       */
      const { rows } = await db.query<{ tablename: string; policyname: string }>(
        `select tablename, policyname
           from pg_policies
          where schemaname = 'public'
            and (
              -- Strip the wrapped form, then see what is left. Postgres regex
              -- is POSIX and has no lookbehind, so "not preceded by SELECT"
              -- cannot be written directly — the first version of this test
              -- tried and silently matched all 38 policies including the
              -- correct ones.
              regexp_replace(
                coalesce(qual, ''), '\\( SELECT auth\\.(uid|jwt)\\(\\)( AS \\w+)?\\)', '', 'g'
              ) ~ 'auth\\.(uid|jwt)\\(\\)'
              or regexp_replace(
                coalesce(with_check, ''), '\\( SELECT auth\\.(uid|jwt)\\(\\)( AS \\w+)?\\)', '', 'g'
              ) ~ 'auth\\.(uid|jwt)\\(\\)'
            )
          order by tablename, policyname`,
      );

      expect(rows).toEqual([]);
    });

    it('indexes every foreign key whose parent delete would scan the child', async () => {
      /*
       * `on delete cascade` and `on delete restrict` both make the *parent's*
       * delete look through the child table. With no index on the referencing
       * column that is a sequential scan, so deleting one contact reads every
       * task on the platform.
       *
       * Deliberately not "index every foreign key". The linter asks for 39;
       * most of those are `created_by` and `actor_id` audit columns that
       * nothing filters on, and an index there is pure write cost. The rule is
       * the delete behaviour, and `set null` is excluded because those columns
       * are the audit trail rather than a query path.
       */
      const { rows } = await db.query<{ tbl: string; col: string; ondelete: string }>(
        `select c.conrelid::regclass::text as tbl, a.attname as col,
                case c.confdeltype when 'c' then 'cascade' else 'restrict' end as ondelete
           from pg_constraint c
           join lateral unnest(c.conkey) k(attnum) on true
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where c.contype = 'f'
            and c.connamespace = 'public'::regnamespace
            and c.confdeltype in ('c', 'r')
            and array_length(c.conkey, 1) = 1
            and not exists (
              select 1 from pg_index i
               where i.indrelid = c.conrelid and i.indkey[0] = k.attnum
            )
          order by tbl, col`,
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
      /*
       * Exactly one exception, and it is a legal requirement rather than a
       * convenience.
       *
       * CAN-SPAM requires a working opt-out in every commercial message, and one
       * that demands a password first is not working — the person who most wants
       * out is the one who no longer remembers having an account. So the
       * unsubscribe function is reachable without a session.
       *
       * It is safe to be: it takes an opaque per-user token, touches one row,
       * returns the same answer for an unknown token as for a successful opt-out
       * so it cannot be used to confirm a guess, and reads nothing back. Every
       * one of those properties is asserted in email-delivery.test.ts.
       *
       * A second name appearing here still fails, which is the point.
       */
      const ANON_EXECUTABLE_BY_DESIGN = [
        'unsubscribe_by_token',
        /*
         * Answers one boolean: is there anything on the board yet. A visitor
         * learns the same thing by loading the browse page and seeing rows or
         * not, so this reveals nothing they could not already see. It is
         * deliberately a boolean rather than a count — how many listings exist
         * is a fact about the operator's business, and a count here would
         * eventually be rendered as a marketing claim.
         */
        'market_is_open',
        /*
         * Ranked full-text search over live listings, returning public slugs.
         * It searches the same teaser columns the public market already
         * displays and cannot reach the confidential half — asserted directly
         * in search-and-views.test.ts, because a searchable legal_name would
         * let anybody confirm which company is for sale by watching which
         * queries return a row.
         */
        'search_market',
        /*
         * Increments a listing's view tally. Most viewers of a public listing
         * page are anonymous, which is the whole reason it is reachable here.
         * It writes nothing about who called it — the table has three columns
         * and none of them is a person.
         */
        'record_listing_view',
      ];

      const { rows } = await db.query<{ proname: string }>(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );

      const unexpected = rows
        .map((r) => r.proname)
        .filter((name) => !ANON_EXECUTABLE_BY_DESIGN.includes(name));

      expect(
        unexpected,
        `A public function is reachable by an unauthenticated caller. If that is deliberate, add it to ANON_EXECUTABLE_BY_DESIGN with the reason:\n${unexpected.join('\n')}`,
      ).toEqual([]);

      // And the reverse: an exception that no longer exists means the list is
      // stale and quietly excusing nothing.
      const stale = ANON_EXECUTABLE_BY_DESIGN.filter(
        (name) => !rows.some((r) => r.proname === name),
      );
      expect(stale, `Stale exception:\n${stale.join('\n')}`).toEqual([]);
    });

    it('keeps anon out of every app helper that is not a trigger', async () => {
      /*
       * The `app` schema is not published by PostgREST, so this is a second
       * line rather than the first. It is here because 0006 granted `anon`
       * EXECUTE across the whole schema, that grant is still in force, and it
       * applies to helpers written years later unless somebody remembers to
       * revoke — which four migrations have now had to do by hand.
       *
       * Pinning the list is what turns remembering into a build failure. Two
       * categories are legitimately here:
       *
       *   - trigger functions, which Postgres refuses to call directly
       *     ("trigger functions can only be called as triggers"), so the grant
       *     buys nothing;
       *   - the handful of predicates that policies evaluate before there is a
       *     session at all — the jurisdiction and legal-template policies, which
       *     an anonymous visitor legitimately reaches.
       *
       * Anything else appearing here is a new helper that inherited the blanket
       * grant, and the fix is a `revoke ... from public, anon` in its migration.
       */
      const expected = [
        'can_access_deal',
        'can_administer_conversation',
        'can_create_deal',
        'conversation_role',
        'has_platform_role',
        'is_active_conversation_member',
        'is_firm_administrator',
        'is_firm_member',
        'is_platform_admin',
        'topic_conversation_id',
        'user_firm_ids',
      ];

      const { rows } = await db.query<{ proname: string }>(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and has_function_privilege('anon', p.oid, 'EXECUTE')
            -- Trigger functions are unreachable by a direct call whatever the
            -- grant says, so they are not what this test is watching for.
            and p.prorettype <> 'trigger'::regtype
          order by p.proname`,
      );

      expect(rows.map((r) => r.proname)).toEqual(expected);
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
          `insert into public.jurisdictions (code, name, country_code) values ('US-XX','X','US')
       on conflict (code) do update set is_active = excluded.is_active, name = excluded.name`,
        ),
      );

      expect(denial.code).toBe('42501');
    });

    it('refuses a non-admin writing reference data', async () => {
      const denial = await expectDenied(() =>
        actingAs(
          db,
          ownerId,
          `insert into public.jurisdictions (code, name, country_code) values ('US-ZZ','Z','US')
       on conflict (code) do update set is_active = excluded.is_active, name = excluded.name`,
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
