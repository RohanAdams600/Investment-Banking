import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { FIRM_ROLES, PLATFORM_ROLES } from '@ib/core';

import { applyMigrations, connect, hasDatabase } from './helpers';

/**
 * The role vocabulary exists twice: as a TypeScript union in
 * `packages/core/src/access/roles.ts`, and as a Postgres enum in
 * `0001_foundation.sql`.
 *
 * Duplication is unavoidable — the database cannot import TypeScript, and the
 * permission model must not require a database connection. What is avoidable is
 * the duplication drifting silently. Adding a role to one side and not the
 * other fails here rather than as a constraint violation in production, weeks
 * later, on the one insert that uses the new value.
 */
describe.skipIf(!hasDatabase)('schema parity', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
    await applyMigrations(db);
  });

  afterAll(async () => {
    await db?.end();
  });

  async function enumValues(typeName: string): Promise<string[]> {
    const { rows } = await db.query<{ value: string }>(
      `select e.enumlabel as value
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'app' and t.typname = $1
        order by e.enumsortorder`,
      [typeName],
    );
    return rows.map((r) => r.value);
  }

  it('keeps app.platform_role in step with PLATFORM_ROLES', async () => {
    expect(await enumValues('platform_role')).toEqual([...PLATFORM_ROLES]);
  });

  it('keeps app.firm_role in step with FIRM_ROLES', async () => {
    expect(await enumValues('firm_role')).toEqual([...FIRM_ROLES]);
  });

  it('grants every platform role at least one capability', async () => {
    // A role in the enum that no capability map mentions is dead weight at
    // best, and at worst a role users can hold that silently does nothing.
    const { capabilitiesForRole } = await import('@ib/core');

    for (const role of PLATFORM_ROLES) {
      expect(capabilitiesForRole(role).length, `${role} grants nothing`).toBeGreaterThan(0);
    }
  });
});
