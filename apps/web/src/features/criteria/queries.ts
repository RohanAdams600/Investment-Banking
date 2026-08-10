import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { emptyCriteriaState, type CriteriaFormState } from './types';

/** Cents in the database, dollars in the form. */
const toDollars = (cents: number | null): string =>
  cents === null || cents === undefined ? '' : String(cents / 100);

/** Fraction in the database, percent in the form. */
const toPercent = (fraction: number | null): string =>
  fraction === null || fraction === undefined ? '' : String(Math.round(fraction * 100));

/**
 * Loads the buyer's live criteria, if any.
 *
 * RLS restricts this to the caller's own rows, so no user id is passed — the
 * session is the filter.
 */
export async function loadCriteria(): Promise<CriteriaFormState | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('acquisition_criteria')
    .select('*')
    .is('superseded_at', null)
    .maybeSingle();

  if (error || !data) return null;

  return {
    ...emptyCriteriaState,
    industries: (data.industries as string[]) ?? [],
    jurisdictions: (data.jurisdictions as string[]) ?? [],
    revenueMin: toDollars(data.revenue_min_cents as number | null),
    revenueMax: toDollars(data.revenue_max_cents as number | null),
    earningsMin: toDollars(data.earnings_min_cents as number | null),
    earningsMax: toDollars(data.earnings_max_cents as number | null),
    dealSizeMax: toDollars(data.deal_size_max_cents as number | null),
    dealStructure: data.deal_structure as CriteriaFormState['dealStructure'],
    involvement: data.involvement as CriteriaFormState['involvement'],
    maxCustomerConcentration: toPercent(data.max_customer_concentration as number | null),
    minRecurringRevenueShare: toPercent(data.min_recurring_revenue_share as number | null),
    thesis: (data.thesis as string | null) ?? '',
  };
}
