import 'server-only';

import type { FeeBand, FeeStructure } from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Reads for the commission feature.
 *
 * Through the user's client, so RLS applies: a broker sees their own firm's
 * fees and nobody else's. What a brokerage charges is commercially sensitive to
 * that brokerage, and a rival reading it would be a disclosure the firm never
 * made.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface StoredAgreement {
  id: string;
  firmId: string;
  listingId: string | null;
  structure: FeeStructure;
  flatRate: number | null;
  minimumFeeCents: number | null;
  coBrokerShare: number | null;
  retainerCents: number | null;
  effectiveFrom: string;
}

export interface StoredCommission {
  id: string;
  listingId: string | null;
  status: 'projected' | 'earned' | 'settled' | 'waived';
  salePriceCents: number;
  calculatedFeeCents: number;
  totalFeeCents: number;
  coBrokerFeeCents: number;
  netFeeCents: number;
  bands: FeeBand[];
  closedAt: string | null;
  settledAt: string | null;
  waivedReason: string | null;
  createdAt: string;
}

/** The live fee agreement for a firm, if one has been set. */
export async function loadAgreement(firmId: string): Promise<StoredAgreement | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('fee_agreements')
    .select('*')
    .eq('firm_id', firmId)
    .is('superseded_at', null)
    .is('listing_id', null)
    .maybeSingle();

  if (!data) return null;
  const row = data as Row;

  return {
    id: row.id,
    firmId: row.firm_id,
    listingId: row.listing_id ?? null,
    structure: row.structure,
    flatRate: row.flat_rate === null ? null : Number(row.flat_rate),
    minimumFeeCents: row.minimum_fee_cents === null ? null : Number(row.minimum_fee_cents),
    coBrokerShare: row.co_broker_share === null ? null : Number(row.co_broker_share),
    retainerCents: row.retainer_cents === null ? null : Number(row.retainer_cents),
    effectiveFrom: row.effective_from,
  };
}

export async function listCommissions(firmId: string): Promise<StoredCommission[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('commission_records')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    id: row.id,
    listingId: row.listing_id ?? null,
    status: row.status,
    // bigint arrives as a string from Postgres. Coerced here rather than at
    // every call site, because a string that looks like a number silently
    // concatenates instead of adding.
    salePriceCents: Number(row.sale_price_cents),
    calculatedFeeCents: Number(row.calculated_fee_cents),
    totalFeeCents: Number(row.total_fee_cents),
    coBrokerFeeCents: Number(row.co_broker_fee_cents),
    netFeeCents: Number(row.net_fee_cents),
    bands: (row.bands ?? []) as FeeBand[],
    closedAt: row.closed_at ?? null,
    settledAt: row.settled_at ?? null,
    waivedReason: row.waived_reason ?? null,
    createdAt: row.created_at,
  }));
}

export interface CommissionTotals {
  projectedCents: number;
  earnedCents: number;
  settledCents: number;
  /** Earned but not yet marked settled — what the firm is waiting on. */
  outstandingCents: number;
  closedCount: number;
}

/**
 * Totals for a statement.
 *
 * Summed from `net_fee_cents`, which is what the firm actually keeps after a
 * co-broker split. Summing the gross would flatter every figure on the page.
 */
export function totalsFor(records: StoredCommission[]): CommissionTotals {
  const sum = (status: StoredCommission['status']) =>
    records.filter((r) => r.status === status).reduce((total, r) => total + r.netFeeCents, 0);

  const earnedCents = sum('earned');

  return {
    projectedCents: sum('projected'),
    earnedCents,
    settledCents: sum('settled'),
    outstandingCents: earnedCents,
    closedCount: records.filter((r) => r.status === 'earned' || r.status === 'settled').length,
  };
}
