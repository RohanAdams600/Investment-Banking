'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { generateToken } from '@/lib/mcp/auth';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * Issuing and revoking the credentials an external AI agent connects with.
 *
 * ## The plaintext is returned once and never stored
 *
 * `generateToken()` produces the secret, its digest and a short non-secret hint.
 * The digest is what goes in the database; the plaintext comes back through this
 * action's return value, is rendered once, and then exists nowhere. There is
 * deliberately no "show token again" — a credential that can be re-read is a
 * credential a leaked session hands over, and re-issuing is free.
 *
 * ## Written through the caller's own client
 *
 * The policies on `mcp_tokens` scope everything to `user_id = auth.uid()`, and
 * routing around them with the service role would mean the table that holds
 * agent credentials had no database-level check on it.
 */

export interface AgentTokenState {
  error: string | null;
  /** Present exactly once, immediately after creation. Never re-fetched. */
  plaintext: string | null;
  label: string | null;
}

export const emptyAgentTokenState: AgentTokenState = {
  error: null,
  plaintext: null,
  label: null,
};

const SCOPES = [
  'read:listings',
  'read:matches',
  'read:pipeline',
  'run:valuation',
  'draft:outreach',
] as const;

const createSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Give it a name so you know which agent to revoke later.')
    .max(100),
  scopes: z.array(z.enum(SCOPES)).min(1, 'Choose at least one thing the agent may do.'),
  /*
   * Capped at a year, and there is no "never expires".
   *
   * A credential handed to a third-party service and never reviewed again is the
   * one still live when that service is breached. The column refuses a null
   * expiry; this refuses a decade.
   */
  days: z.coerce.number().int().min(1).max(365),
});

export async function createAgentToken(
  _previous: AgentTokenState,
  formData: FormData,
): Promise<AgentTokenState> {
  const parsed = createSchema.safeParse({
    label: formData.get('label') ?? '',
    scopes: formData.getAll('scopes'),
    days: formData.get('days') ?? '90',
  });

  if (!parsed.success) {
    return {
      ...emptyAgentTokenState,
      error: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    };
  }

  if (!isSupabaseConfigured()) {
    return { ...emptyAgentTokenState, error: 'Not configured yet.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ...emptyAgentTokenState, error: 'Sign in first.' };

  const { plaintext, digest, hint } = generateToken();
  const expiresAt = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString();

  const { error } = await supabase.from('mcp_tokens').insert({
    user_id: user.id,
    label: parsed.data.label,
    token_sha256: digest,
    token_hint: hint,
    scopes: parsed.data.scopes,
    expires_at: expiresAt,
  });

  if (error) {
    // Never log the plaintext, here or anywhere.
    console.error('[agents] could not issue token', error.message);
    return { ...emptyAgentTokenState, error: 'Could not issue that token. Try again.' };
  }

  revalidatePath('/settings/agents');
  return { error: null, plaintext, label: parsed.data.label };
}

export async function revokeAgentToken(
  _previous: AgentTokenState,
  formData: FormData,
): Promise<AgentTokenState> {
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { ...emptyAgentTokenState, error: 'Unknown token.' };

  if (!isSupabaseConfigured()) return { ...emptyAgentTokenState, error: 'Not configured yet.' };

  const supabase = await createClient();

  /*
   * Revoked rather than deleted by default. The row is the record that an agent
   * held access and what it was permitted to do while it did — deleting that
   * loses the answer to "what could this thing reach" at exactly the moment
   * somebody is asking. Deleting outright is a separate, explicit choice.
   */
  const { error } = await supabase
    .from('mcp_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id.data);

  if (error) {
    console.error('[agents] could not revoke', error.message);
    return { ...emptyAgentTokenState, error: 'Could not revoke that token.' };
  }

  revalidatePath('/settings/agents');
  return emptyAgentTokenState;
}
