import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { actingAs, applyMigrations, connect, createAuthUser, hasDatabase } from './helpers';

/**
 * The two views that are their own access check.
 *
 * `listing_status_timeline` and `market_listings` both run with their owner's
 * rights rather than the caller's, and in both cases that is deliberate — they
 * exist to show rows the caller's own policy withholds. Supabase's linter flags
 * the property; the property is correct and the *remedy* it implies is not.
 * Both facts are asserted here, because the tempting fix silently empties the
 * public market.
 *
 * What was actually wrong is that neither was a barrier view. Without that the
 * planner reorders: it costs `app.controls_listing()` as an expensive plpgsql
 * call and pushes a cheap-looking caller predicate underneath it, so the
 * caller's own function runs against rows the view is about to discard. The
 * rows never appear in the result — they leak through the side effects of
 * evaluating the qual.
 */
describe.skipIf(!hasDatabase)('views used as an access boundary', () => {
  let db: Client;

  let seller: string;
  let stranger: string;
  let hiddenRowId: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    seller = await createAuthUser(db, 'barrier-seller@example.com');
    stranger = await createAuthUser(db, 'barrier-stranger@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role) values ($1,'seller'), ($2,'buyer')`,
      [seller, stranger],
    );
    await db.query(`update public.jurisdictions set is_active = true where code = 'US-NY'`);

    // A draft nobody but its seller may see, and a live one anybody may.
    const { rows: draft } = await db.query<{ id: string }>(
      `insert into public.listings (seller_id, headline, industry, jurisdiction_code, status)
       values ($1, 'Confidential machine shop', 'home_services', 'US-NY', 'draft')
       returning id`,
      [seller],
    );
    const { rows: live } = await db.query<{ id: string }>(
      `insert into public.listings
         (seller_id, headline, industry, jurisdiction_code, status, published_at)
       values ($1, 'Public HVAC contractor', 'home_services', 'US-NY', 'live', now())
       returning id`,
      [seller],
    );

    const { rows: hidden } = await db.query<{ id: string }>(
      `insert into public.listing_status_history (listing_id, from_status, to_status, reason)
       values ($1, null, 'draft', 'internal reviewer note') returning id`,
      [draft[0]!.id],
    );
    hiddenRowId = hidden[0]!.id;

    await db.query(
      `insert into public.listing_status_history (listing_id, from_status, to_status, reason)
       values ($1, 'draft', 'live', 'approved')`,
      [live[0]!.id],
    );

    /*
     * A predicate that reports whatever it is handed. It stands in for any
     * non-leakproof function a caller can put in a WHERE clause — the real
     * versions leak through an error message or a timing difference rather than
     * a notice, which is why the leak is invisible in a result set.
     *
     * Created as the owner: on this project `authenticated` cannot create
     * functions, which is a good second line of defence and a bad first one.
     * The barrier makes the ordering a property of the view rather than a
     * consequence of who currently holds CREATE.
     */
    await db.query(`
      create table if not exists public.leak_log (seen bigint);
      -- Definer so it can record what it saw regardless of the caller's
      -- grants. A real leaky predicate reports through an error message or a
      -- timing difference and needs no write privilege at all; the log is
      -- simply the observable this test can assert on.
      create or replace function public.leaky_probe(v bigint) returns boolean
      language plpgsql volatile security definer set search_path = public, pg_catalog as $probe$
      begin
        insert into public.leak_log (seen) values (v);
        return true;
      end;
      $probe$;
    `);
  });

  afterAll(async () => {
    /*
     * Drop the scaffolding.
     *
     * `leak_log` has no RLS and `leaky_probe` is executable by PUBLIC, so
     * leaving them behind makes `supabase/verify.sql` fail two of its
     * whole-schema invariants on any database this suite has touched — a false
     * alarm that looks exactly like a real one. Every other test file here gets
     * away without cleanup because none of them create objects.
     */
    await db?.query(`
      drop function if exists public.leaky_probe(bigint);
      drop table if exists public.leak_log;
    `);
    await db?.end();
  });

  it('does not evaluate a caller predicate against rows it is hiding', async () => {
    /*
     * The regression. Before `security_barrier`, this test recorded the draft
     * listing's history row — a row the very same statement correctly returned
     * zero of.
     */
    await db.query('delete from public.leak_log');

    const visible = await actingAs<{ count: string }>(
      db,
      stranger,
      'select count(*)::text as count from public.listing_status_timeline',
    );
    expect(visible.rows[0]!.count).toBe('2');

    await actingAs(
      db,
      stranger,
      'select count(*) from public.listing_status_timeline where public.leaky_probe(id)',
    );

    const { rows } = await db.query<{ seen: string }>('select seen from public.leak_log');
    const touched = rows.map((row) => row.seen);

    expect(touched, 'the hidden draft row reached the caller’s predicate').not.toContain(
      hiddenRowId,
    );
  });

  it('keeps both boundary views as barrier views', async () => {
    // Asserted on the catalogue rather than on behaviour alone, because the
    // behavioural test above depends on a planner choice: a future release that
    // happened to order the quals safely would make it pass for the wrong
    // reason while the protection was gone.
    const { rows } = await db.query<{ relname: string; reloptions: string[] | null }>(
      `select c.relname, c.reloptions
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
        order by c.relname`,
    );

    const options = new Map(rows.map((row) => [row.relname, row.reloptions ?? []]));

    for (const view of ['listing_status_timeline', 'market_listings']) {
      expect(options.get(view), `${view} is not a barrier view`).toContain('security_barrier=true');
    }
  });

  it('keeps the timeline a definer view, because invoker empties it', async () => {
    /*
     * The linter's implied remedy, measured rather than argued about.
     *
     * 0022 narrowed `listing_status_history` to the seller and administrators so
     * the reviewer's `reason` could not leak. This view re-opens the columns
     * without a reason to anyone who can discover the listing — so running it as
     * the invoker applies the narrowed policy and the public timeline goes
     * blank. Two rows become none.
     */
    const options = await db.query<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'listing_status_timeline'`,
    );
    expect(options.rows[0]!.reloptions ?? []).not.toContain('security_invoker=true');

    await db.query('alter view public.listing_status_timeline set (security_invoker = true)');
    try {
      const asInvoker = await actingAs<{ count: string }>(
        db,
        stranger,
        'select count(*)::text as count from public.listing_status_timeline',
      );
      expect(asInvoker.rows[0]!.count).toBe('0');
    } finally {
      await db.query('alter view public.listing_status_timeline reset (security_invoker)');
    }
  });

  it('keeps the public market readable by anon, which invoker would also break', async () => {
    // `anon` holds no grant on `listings`, so an invoker view returns permission
    // denied to every unauthenticated visitor — the entire public market.
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'public.listings', 'select') as ok`,
    );
    expect(rows[0]!.ok).toBe(false);

    const { rows: viaView } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'public.market_listings', 'select') as ok`,
    );
    expect(viaView[0]!.ok).toBe(true);
  });
});
