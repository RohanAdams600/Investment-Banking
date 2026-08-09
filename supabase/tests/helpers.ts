import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../migrations');
const SHIM = resolve(HERE, 'local_auth_shim.sql');

/**
 * These tests need a real Postgres. Policies are close to unreviewable by eye —
 * a `using` clause that should have been `with check`, a missing `force`, a
 * recursive helper — and every one of those is obvious the instant a wrong role
 * runs a query. So we run the queries.
 *
 * Without DATABASE_URL the suite skips rather than fails, so `pnpm test` still
 * works on a laptop with no database. CI provides one.
 */
export const DATABASE_URL = process.env.DATABASE_URL;
export const hasDatabase = Boolean(DATABASE_URL);

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Drops and rebuilds the schema from the migration files.
 *
 * Reapplying every migration from scratch on each run is what makes this a test
 * of the migrations rather than a test of whatever state the database drifted
 * into.
 */
export async function applyMigrations(client: Client): Promise<void> {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists app cascade;
    drop schema if exists auth cascade;
    create schema public;
  `);

  await client.query(readFileSync(SHIM, 'utf8'));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    try {
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

/** Creates an auth user directly, as the platform's auth service would. */
export async function createAuthUser(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return rows[0]!.id;
}

export interface ActingResult<T> {
  rows: T[];
  rowCount: number;
}

/**
 * Runs a query as `authenticated` with the given user id, exactly as PostgREST
 * would: the role is switched and the JWT subject is set as a GUC, which is
 * what `auth.uid()` reads.
 *
 * Wrapped in a transaction so `set local` reverts cleanly even when the query
 * throws — otherwise one failing test leaks its role into the next.
 */
export async function actingAs<T extends Record<string, unknown>>(
  client: Client,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<ActingResult<T>> {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId ?? '']);
    const result = await client.query<T>(sql, params);
    await client.query('commit');
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** Same, as the unauthenticated `anon` role. */
export async function actingAsAnon<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<ActingResult<T>> {
  await client.query('begin');
  try {
    await client.query('set local role anon');
    const result = await client.query<T>(sql, params);
    await client.query('commit');
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/**
 * Asserts a statement is refused, and returns the SQLSTATE so the caller can
 * distinguish *how* it was refused — 42501 is a privilege or policy denial,
 * which is what we want, rather than a syntax error that would also "fail".
 */
export async function expectDenied(
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (error) {
    const pgError = error as { code?: string; message: string };
    return { code: pgError.code ?? 'unknown', message: pgError.message };
  }
  throw new Error('Expected the statement to be denied, but it succeeded.');
}
