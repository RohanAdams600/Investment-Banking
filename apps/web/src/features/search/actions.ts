'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  MAX_LABEL_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_SAVED_SEARCHES,
  validateSavedSearch,
} from '@ib/core';

import { checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';

/**
 * Creating, retuning and deleting a saved search.
 *
 * Nothing here passes a user id. The policy on `saved_searches` derives the
 * owner from the caller's own JWT, and the insert sets it from `auth.uid()` — so
 * there is no argument an attacker could substitute to write a row onto
 * somebody else's account, because there is no such argument.
 */

export interface SavedSearchState {
  error: string | null;
  message: string | null;
}

const ok = (message: string): SavedSearchState => ({ error: null, message });
const fail = (error: string): SavedSearchState => ({ error, message: null });

/*
 * Money arrives from the form as dollars and is stored as cents.
 *
 * Coerced through `Math.round` rather than `* 100` alone: 19999.99 * 100 is
 * 1999998.9999999998 in IEEE754, which the database's integer column refuses
 * with an error no buyer could act on.
 */
const dollarsToCents = (value: string | null): number | null => {
  if (value === null || value.trim() === '') return null;
  const parsed = Number.parseFloat(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
};

const filtersSchema = z.object({
  q: z.string().trim().max(MAX_QUERY_LENGTH).nullish(),
  industry: z.string().trim().max(64).nullish(),
  jurisdiction: z.string().trim().max(16).nullish(),
});

export async function saveSearch(
  _previous: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail('Sign in to save a search.');

  const limited = await checkRateLimit('saveSearch', user.id);
  if (!limited.allowed) return fail('Too many saved searches just now. Try again shortly.');

  const raw = (key: string): string | null => {
    const value = formData.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  const parsed = filtersSchema.safeParse({
    q: raw('q'),
    industry: raw('industry'),
    jurisdiction: raw('jurisdiction'),
  });
  if (!parsed.success) return fail('Those filters could not be read.');

  const minEarningsCents = dollarsToCents(raw('minEarnings'));
  const maxAskingCents = dollarsToCents(raw('maxAsking'));

  const filters = {
    q: parsed.data.q ?? null,
    industry: parsed.data.industry ?? null,
    jurisdictionCode: parsed.data.jurisdiction ?? null,
    minEarningsCents: Number.isNaN(minEarningsCents) ? null : minEarningsCents,
    maxAskingCents: Number.isNaN(maxAskingCents) ? null : maxAskingCents,
  };

  if (Number.isNaN(minEarningsCents) || Number.isNaN(maxAskingCents)) {
    return fail('Enter amounts as numbers, or leave them blank.');
  }

  /*
   * The count and the existing labels come from the caller's own client, so a
   * buyer cannot learn anything about anybody else's searches by racing this.
   * The database's unique constraint is still the authority — this exists to
   * produce a sentence rather than a constraint violation.
   */
  const { data: existing } = await supabase.from('saved_searches').select('label');
  const labels = (existing ?? []).map((row) => (row as { label: string }).label);

  const problems = validateSavedSearch(
    { label: formData.get('label')?.toString() ?? '', filters },
    { existingCount: labels.length, existingLabels: labels },
  );
  if (problems.length > 0) return fail(problems[0]!.message);

  const { error } = await supabase.from('saved_searches').insert({
    user_id: user.id,
    label: (formData.get('label')?.toString() ?? '').trim().slice(0, MAX_LABEL_LENGTH),
    q: filters.q,
    industry: filters.industry,
    jurisdiction_code: filters.jurisdictionCode,
    min_earnings_cents: filters.minEarningsCents,
    max_asking_cents: filters.maxAskingCents,
    frequency: formData.get('frequency') === 'weekly' ? 'weekly' : 'daily',
  });

  if (error) {
    return fail(
      error.code === '23505'
        ? 'You already have a search with that name.'
        : `That could not be saved. You can keep ${MAX_SAVED_SEARCHES}.`,
    );
  }

  revalidatePath('/saved-searches');
  revalidatePath('/listings');
  return ok('Saved. You will hear when something matches.');
}

export async function setSearchFrequency(
  _previous: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('id')?.toString());
  if (!id.success) return fail('That search could not be found.');

  const requested = formData.get('frequency')?.toString();
  const frequency = requested === 'weekly' || requested === 'off' ? requested : 'daily';

  const { error } = await supabase.from('saved_searches').update({ frequency }).eq('id', id.data);

  if (error) return fail('That could not be changed.');

  revalidatePath('/saved-searches');
  return ok(
    frequency === 'off' ? 'Alerts paused. The search is still here.' : `Now alerting ${frequency}.`,
  );
}

export async function deleteSearch(
  _previous: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('id')?.toString());
  if (!id.success) return fail('That search could not be found.');

  const { error } = await supabase.from('saved_searches').delete().eq('id', id.data);
  if (error) return fail('That could not be deleted.');

  revalidatePath('/saved-searches');
  return ok('Deleted.');
}
