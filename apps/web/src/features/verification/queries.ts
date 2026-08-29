import 'server-only';

import type { CapacityBand, FundingEvidenceKind, FundingVerificationStatus, VerificationBadge } from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Reading funding verification.
 *
 * Two shapes, and the difference between them is the whole design:
 *
 *   - `myVerification()` returns the buyer's own record, evidence note and all.
 *     The policy scopes it to `auth.uid()`.
 *   - `verificationBadge()` returns a status and a band about somebody else, and
 *     goes through a definer function because the table itself is closed to
 *     everyone but the buyer and an operator.
 *
 * Nothing here uses the service role. The database decides who may read what,
 * and routing around it would leave the table holding people's finances with no
 * check on it beyond this file being correct.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface OwnVerification {
  status: FundingVerificationStatus;
  evidenceKind: FundingEvidenceKind;
  capacityBand: CapacityBand;
  evidenceNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  /** The operator's reasoning. Shown to the buyer — a rejection they cannot
   *  understand is a support ticket, and eventually a complaint. */
  reviewNote: string | null;
  expiresAt: string | null;
}

export async function myVerification(): Promise<OwnVerification | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('buyer_verifications')
    .select(
      'status, evidence_kind, capacity_band, evidence_note, submitted_at, reviewed_at, review_note, expires_at',
    )
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Row;
  return {
    status: row.status,
    evidenceKind: row.evidence_kind,
    capacityBand: row.capacity_band,
    evidenceNote: row.evidence_note ?? null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

/**
 * A badge for one buyer.
 *
 * Returns null both when the buyer has never submitted and when the caller is
 * not entitled to ask — the function returns no rows in either case, and the
 * caller cannot tell them apart. That is deliberate: a seller who could
 * distinguish "no submission" from "not your buyer" could probe for whether
 * other sellers' buyers are verified.
 */
export async function verificationBadge(buyerId: string): Promise<VerificationBadge | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('buyer_verification_badge', {
    target_buyer: buyerId,
  });

  if (error || !Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as Row;
  return {
    status: row.status,
    capacityBand: row.capacity_band,
    verifiedAt: row.verified_at ?? null,
    expiresAt: row.expires_at ?? null,
    isCurrent: Boolean(row.is_current),
  };
}

/** Badges for several buyers at once, for the seller's access-request queue. */
export async function verificationBadges(
  buyerIds: string[],
): Promise<Map<string, VerificationBadge>> {
  const unique = [...new Set(buyerIds)];
  const badges = new Map<string, VerificationBadge>();

  /*
   * One call per buyer. The function takes a single id, and a seller's queue is
   * a handful of rows rather than a page of them — a set-returning variant
   * would be a second entry point into the same guard, which is one more place
   * for the guard to be wrong.
   */
  const results = await Promise.all(
    unique.map(async (id) => [id, await verificationBadge(id)] as const),
  );

  for (const [id, badge] of results) {
    if (badge) badges.set(id, badge);
  }

  return badges;
}

export interface VerificationQueueItem extends OwnVerification {
  id: string;
  buyerId: string;
  buyerName: string | null;
  buyerEmail: string | null;
}

/**
 * The operator's review queue. Pending first, oldest first within that.
 *
 * Reads the table directly, which works only for an admin — the select policy
 * admits `buyer_id = auth.uid() or app.is_platform_admin()`, so a non-admin
 * calling this gets their own row and nothing else rather than an error.
 */
export async function verificationQueue(): Promise<VerificationQueueItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('buyer_verifications')
    .select('*')
    .order('status', { ascending: true })
    .order('submitted_at', { ascending: true })
    .limit(200);

  if (error || !data) return [];

  const rows = data as Row[];
  const buyerIds = [...new Set(rows.map((row) => row.buyer_id as string))];

  const names = new Map<string, string>();
  if (buyerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', buyerIds);

    for (const profile of (profiles ?? []) as Row[]) {
      if (profile.full_name) names.set(profile.id as string, profile.full_name as string);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    buyerId: row.buyer_id,
    buyerName: names.get(row.buyer_id as string) ?? null,
    buyerEmail: null,
    status: row.status,
    evidenceKind: row.evidence_kind,
    capacityBand: row.capacity_band,
    evidenceNote: row.evidence_note ?? null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    expiresAt: row.expires_at ?? null,
  }));
}
