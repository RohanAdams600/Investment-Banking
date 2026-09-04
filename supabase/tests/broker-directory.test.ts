import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  actingAs,
  actingAsAnon,
  applyMigrations,
  connect,
  createAuthUser,
  hasDatabase,
} from './helpers';

/**
 * The broker directory, and the one thing that must never happen.
 *
 * A profile is somebody's professional name. Publishing it is a decision they
 * make, and the platform's job is to make the unpublished state genuinely
 * unreachable rather than merely unlinked — a draft that a stranger can read by
 * guessing a firm id has not been kept private, it has been hidden.
 *
 * That is why the public surface is a view over `is_published` rather than a
 * policy on the table: RLS is row-level, so any policy letting anonymous
 * visitors read the table would expose every column of every row, drafts
 * included.
 */
describe.skipIf(!hasDatabase)('broker directory', () => {
  let db: Client;

  let ownerA: string;
  let ownerB: string;
  let stranger: string;
  let firmA: string;
  let firmB: string;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);

    ownerA = await createAuthUser(db, 'dir-owner-a@example.com');
    ownerB = await createAuthUser(db, 'dir-owner-b@example.com');
    stranger = await createAuthUser(db, 'dir-stranger@example.com');

    await db.query(
      `insert into public.user_roles (user_id, role)
       values ($1,'broker'), ($2,'broker'), ($3,'buyer')`,
      [ownerA, ownerB, stranger],
    );

    const a = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values ('Keystone Advisors','brokerage') returning id`,
    );
    const b = await db.query<{ id: string }>(
      `insert into public.firms (name, kind) values ('Quarry Partners','brokerage') returning id`,
    );
    firmA = a.rows[0]!.id;
    firmB = b.rows[0]!.id;

    await db.query(
      `insert into public.firm_members (firm_id, user_id, role)
       values ($1,$2,'owner'), ($3,$4,'owner')`,
      [firmA, ownerA, firmB, ownerB],
    );

    // A published profile, and a draft that must stay invisible.
    await actingAs(
      db,
      ownerA,
      `insert into public.firm_profiles (firm_id, is_published, headline, about, industries, jurisdictions, website)
       values ($1, true, 'Lower-middle-market brokerage in Ohio', 'Twenty years of trades businesses.',
               array['home_services','manufacturing'], array['US-OH'], 'https://keystone.example')`,
      [firmA],
    );
    await actingAs(
      db,
      ownerB,
      `insert into public.firm_profiles (firm_id, is_published, headline)
       values ($1, false, 'Not ready to be seen yet')`,
      [firmB],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  describe('what the public can see', () => {
    it('shows a published profile to a stranger who is not signed in', async () => {
      const { rows } = await actingAsAnon<{ name: string }>(
        db,
        `select name from public.broker_directory`,
      );
      expect(rows.map((r) => r.name)).toEqual(['Keystone Advisors']);
    });

    it('never shows an unpublished profile, to anyone', async () => {
      /*
       * The assertion the table shape exists for. Checked from all three
       * vantage points, because "not linked from anywhere" is not the same
       * claim as "not readable".
       */
      for (const [who, run] of [
        ['anonymous', () => actingAsAnon(db, `select slug from public.broker_directory`)],
        ['a stranger', () => actingAs(db, stranger, `select slug from public.broker_directory`)],
        ['another firm', () => actingAs(db, ownerA, `select slug from public.broker_directory`)],
      ] as const) {
        const { rows } = (await run()) as { rows: { slug: string }[] };
        expect(rows.map((r) => r.slug), who).not.toContain('quarry-partners');
      }
    });

    it('withholds the firm id and the contact address from the view', async () => {
      /*
       * Asserted against the view's whole column list rather than by checking
       * today's two omissions are absent — that way adding a column fails here
       * rather than in production. The id would correlate this with every other
       * table keyed on it; the address belongs behind a contact action rather
       * than in a page a scraper can read at leisure.
       */
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'broker_directory'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        'about',
        'created_at',
        'established_year',
        'headline',
        'industries',
        'jurisdictions',
        'kind',
        'name',
        'slug',
        'verification_status',
        'website',
      ]);
    });

    it('keeps the underlying table unreachable anonymously', async () => {
      await expect(
        actingAsAnon(db, `select headline from public.firm_profiles`),
      ).rejects.toThrow();
    });
  });

  describe('who may edit one', () => {
    it('lets a firm administrator publish their own', async () => {
      const { rowCount } = await actingAs(
        db,
        ownerB,
        `update public.firm_profiles set headline = 'Now ready' where firm_id = $1`,
        [firmB],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses an edit to another firm profile', async () => {
      const { rowCount } = await actingAs(
        db,
        ownerA,
        `update public.firm_profiles set is_published = true where firm_id = $1`,
        [firmB],
      );
      // Zero rows rather than an error: the row is invisible to this caller, so
      // the update matches nothing. Silent is correct here — telling them the
      // row exists would itself leak that the firm has a profile.
      expect(rowCount).toBe(0);
    });

    it('refuses a profile created for a firm the caller does not administer', async () => {
      const orphan = await db.query<{ id: string }>(
        `insert into public.firms (name, kind) values ('Someone Else LLC','brokerage') returning id`,
      );
      await expect(
        actingAs(
          db,
          stranger,
          `insert into public.firm_profiles (firm_id, headline) values ($1,'Planted')`,
          [orphan.rows[0]!.id],
        ),
      ).rejects.toThrow();
    });
  });

  describe('the slug', () => {
    it('is derived from the firm name', async () => {
      const { rows } = await actingAsAnon<{ slug: string }>(
        db,
        `select slug from public.broker_directory`,
      );
      expect(rows[0]?.slug).toBe('keystone-advisors');
    });

    it('is frozen once assigned, so shared links never break', async () => {
      await actingAs(db, ownerA, `update public.firm_profiles set slug = 'something-else' where firm_id = $1`, [
        firmA,
      ]);
      const { rows } = await actingAsAnon<{ slug: string }>(
        db,
        `select slug from public.broker_directory`,
      );
      expect(rows[0]?.slug).toBe('keystone-advisors');
    });
  });

  describe('what a profile may contain', () => {
    it('refuses a website that is not https', async () => {
      /*
       * A directory that renders a third party's `javascript:` or `data:` URL
       * is a directory that publishes an attack. Constrained in the schema
       * rather than sanitised at each render, because there is only one column
       * and there will be many renders.
       */
      for (const bad of ['javascript:alert(1)', 'http://insecure.example', 'data:text/html,x']) {
        await expect(
          actingAs(db, ownerB, `update public.firm_profiles set website = $2 where firm_id = $1`, [
            firmB,
            bad,
          ]),
          bad,
        ).rejects.toThrow();
      }
    });

    it('bounds the tag lists so a profile cannot become a keyword dump', async () => {
      await expect(
        actingAs(
          db,
          ownerB,
          `update public.firm_profiles set industries = $2 where firm_id = $1`,
          [firmB, Array.from({ length: 9 }, (_, i) => `sector_${i}`)],
        ),
      ).rejects.toThrow();
    });
  });
});
