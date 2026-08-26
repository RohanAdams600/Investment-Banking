import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';

/**
 * Turning a bearer token into a database session.
 *
 * ## The problem this solves
 *
 * Every other entry point to this application arrives with a Supabase session
 * cookie, so `createClient()` produces a client that runs as that user and Row
 * Level Security does the rest. An external agent has no cookie. It has a token
 * this platform issued.
 *
 * The tempting shortcut is to resolve the token, then query with the service
 * role and filter by `user_id` in TypeScript. That throws away the database's
 * independent check on exactly the queries where a second opinion is worth most
 * — an agent reaching for a listing's confidential half is the case RLS exists
 * for. So instead the token is exchanged for a short-lived JWT carrying the
 * owner's id, and every query runs under it. The policies never learn that the
 * caller was a robot, which is the point.
 *
 * ## What this deliberately cannot do
 *
 * Nothing here can mint a session for a user other than the one the token
 * resolves to, and the JWT is signed for five minutes. A token is not a
 * password-equivalent that can be replayed into the web application: it is only
 * accepted by the MCP route, which refuses any tool outside its allowlist.
 */

/** Prefix on every issued token, so a leaked string is identifiable on sight. */
const TOKEN_PREFIX = 'ash_mcp_';

/**
 * Lifetime of the minted database JWT.
 *
 * Long enough for one MCP request including a slow tool, short enough that a
 * copy captured in a log is worthless by the time anybody reads it.
 */
const SESSION_TTL_SECONDS = 300;

export type McpScope =
  'read:listings' | 'read:matches' | 'read:pipeline' | 'run:valuation' | 'draft:outreach';

export interface McpSession {
  tokenId: string;
  userId: string;
  scopes: McpScope[];
  /** A Supabase client running as the token's owner, with RLS applied. */
  db: SupabaseClient;
}

/** Present only when MCP is configured. Absent means the route refuses everyone. */
function jwtSecret(): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  return secret && secret.trim() !== '' ? secret : null;
}

export function isMcpConfigured(): boolean {
  return jwtSecret() !== null;
}

/**
 * A new token, returned in plaintext exactly once.
 *
 * 32 bytes from the platform CSPRNG. The caller stores the digest and shows the
 * plaintext to the user; nothing in this codebase should ever write the
 * plaintext to a log, a database column, or an error message.
 */
export function generateToken(): { plaintext: string; digest: string; hint: string } {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    plaintext,
    digest: sha256(plaintext),
    // Enough to tell two tokens apart in a list, far too little to guess one.
    hint: plaintext.slice(0, TOKEN_PREFIX.length + 4),
  };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Reads the bearer token off a request.
 *
 * Returns null rather than throwing on anything malformed, because the caller
 * turns every failure into the same 401 — telling an unauthenticated client
 * *why* it failed is telling an attacker which half of their guess was right.
 */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  if (token === '' || !token.startsWith(TOKEN_PREFIX)) return null;

  return token;
}

/**
 * Resolves a bearer token into a session that queries as its owner.
 *
 * Returns null for anything that is not a live token — unknown, revoked,
 * expired, or malformed all look identical from outside.
 */
export async function authenticate(token: string): Promise<McpSession | null> {
  const secret = jwtSecret();
  if (!secret) return null;

  const service = createServiceRoleClient();

  const { data, error } = await service.rpc('resolve_mcp_token', { digest: sha256(token) });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;

  const row = (Array.isArray(data) ? data[0] : data) as {
    token_id: string;
    owner: string;
    scopes: McpScope[];
  };

  const accessToken = await mintAccessToken(row.owner, secret);

  /*
   * The anon key with an Authorization header, which is precisely the shape a
   * browser request takes. PostgREST reads the JWT, sets the role and claims,
   * and every policy applies exactly as it would for a signed-in person.
   */
  const db = createSupabaseClient(supabaseUrl(), supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return { tokenId: row.token_id, userId: row.owner, scopes: row.scopes, db };
}

async function mintAccessToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    sub: userId,
    // `authenticated` is the role every policy in this schema is written against.
    // Anything else here would silently bypass or break them.
    role: 'authenticated',
    aud: 'authenticated',
    /*
     * Marks the session as machine-issued. Nothing reads it today; it is here so
     * that a future policy which wants to refuse agents — a step-up on document
     * downloads, say — has something to key on without a schema change.
     */
    app_metadata: { provider: 'mcp' },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

/**
 * Whether a session holds a scope.
 *
 * Constant-time on the string compare — overkill for a value the caller already
 * knows, and cheap enough that the habit is worth more than the microseconds.
 */
export function hasScope(session: McpSession, scope: McpScope): boolean {
  return session.scopes.some((held) => {
    const a = Buffer.from(held);
    const b = Buffer.from(scope);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
