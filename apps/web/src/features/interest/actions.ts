'use server';

import { z } from 'zod';
import { INDUSTRY_PROFILES } from '@ib/core';

import { checkAnonymousRateLimit } from '@/lib/rate-limit';
import { clientAddress } from '@/lib/security/client-address';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * Recording somebody who arrived before there was anything to buy.
 *
 * Written through the caller's own client rather than the service role, even
 * though most callers are anonymous. The insert policy on `market_interest` is
 * what permits this, and routing around it with the service role would mean the
 * one anonymous write in the product had no database-level check on it at all.
 *
 * ## Rate limited on client address
 *
 * The only unauthenticated write in the product, so there is no account to key
 * on. Unbounded, it is a form that fills a mailing list with addresses that did
 * not consent — and those addresses then get emailed, which turns somebody
 * else's spam problem into this platform's sender reputation.
 *
 * Address-keyed limiting is a blunt instrument and shares its usual flaw: a
 * shared NAT throttles everyone behind it. Five per hour is set high enough
 * that an office is unaffected and low enough that a script is not.
 */

export interface InterestState {
  ok: boolean;
  error: string | null;
}

export const emptyInterestState: InterestState = { ok: false, error: null };

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter an email address we can reach you at.'),
  side: z.enum(['selling', 'buying', 'advising']),
  industry: z
    .string()
    .trim()
    .refine((v) => v === '' || v in INDUSTRY_PROFILES, 'Pick an industry from the list.')
    .optional(),
  jurisdiction: z
    .string()
    .trim()
    .regex(/^$|^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'Pick a state from the list.')
    .optional(),
  note: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(100).optional(),
});

export async function registerInterest(
  _previous: InterestState,
  formData: FormData,
): Promise<InterestState> {
  const parsed = schema.safeParse({
    email: formData.get('email') ?? '',
    side: formData.get('side') ?? 'buying',
    industry: formData.get('industry') ?? '',
    jurisdiction: formData.get('jurisdiction') ?? '',
    note: formData.get('note') ?? '',
    source: formData.get('source') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Not configured to accept this yet. Try again shortly.' };
  }

  /*
   * After validation, before the database. Checking first would let a flood of
   * malformed submissions consume a real visitor's budget.
   */
  const budget = await checkAnonymousRateLimit('interestSubmission', await clientAddress());
  if (!budget.allowed) {
    return {
      ok: false,
      error: 'That has been submitted several times already. Try again a little later.',
    };
  }

  const input = parsed.data;
  const supabase = await createClient();

  // Attached when there is a session, absent when there is not. The policy
  // permits either and refuses somebody else's id.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('market_interest').insert({
    user_id: user?.id ?? null,
    email: input.email,
    side: input.side,
    industry: input.industry || null,
    jurisdiction_code: input.jurisdiction || null,
    note: input.note || null,
    source: input.source || null,
  });

  /*
   * A duplicate is a success.
   *
   * The unique constraint on (email, side) means a second submit collides, and
   * telling somebody "you are already on this list" would both be unhelpful and
   * turn the form into a way to test whether an address is registered. Same
   * answer either way.
   */
  if (error && error.code !== '23505') {
    console.error('[interest] could not record', error.message);
    return { ok: false, error: 'Something went wrong saving that. Try again in a moment.' };
  }

  return { ok: true, error: null };
}
