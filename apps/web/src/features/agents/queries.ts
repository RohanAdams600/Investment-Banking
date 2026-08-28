import 'server-only';

import { createClient } from '@/lib/supabase/server';

/** What the page shows about a token. Never the token. */
export interface AgentToken {
  id: string;
  label: string;
  hint: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * The caller's own tokens.
 *
 * `token_sha256` is deliberately not selected. It is a digest and useless to an
 * attacker, but a column that never leaves the database cannot leak through a
 * logged response, a serialized prop, or a future component that spreads the
 * object into the DOM.
 */
export async function listAgentTokens(): Promise<AgentToken[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('id, label, token_hint, scopes, expires_at, last_used_at, revoked_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    hint: row.token_hint as string,
    scopes: (row.scopes as string[]) ?? [],
    expiresAt: row.expires_at as string,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
