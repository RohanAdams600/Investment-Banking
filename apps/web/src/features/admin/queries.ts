import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Reads for the admin panel.
 *
 * Every one of these goes through the *user's* client, not the service role.
 * That is the whole design: an admin panel built on service-role reads is a
 * panel where the only thing standing between an operator and every seller's
 * financials is a `select` list somebody wrote correctly. Going through RLS
 * means the database refuses, and the refusal is tested in
 * supabase/tests/admin-rls.test.ts rather than assumed here.
 *
 * The consequence is that some of these functions return less than an operator
 * might expect — `listing_review_queue` has no revenue column, and no amount of
 * asking will produce one. That is the feature.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface PlatformStats {
  liveListings: number;
  pendingReview: number;
  totalUsers: number;
  unverifiedUsers: number;
  activeJurisdictions: number;
}

/**
 * Counts for the dashboard.
 *
 * "How many", never "which". A definer function guarded by an admin check in
 * its own body, so a non-admin calling it gets zero rows rather than an error —
 * which is also why the null return below is a legitimate state and not a bug.
 */
export async function loadPlatformStats(): Promise<PlatformStats | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('platform_stats');

  if (error || !data || (data as Row[]).length === 0) return null;
  const row = (data as Row[])[0]!;

  return {
    liveListings: Number(row.live_listings),
    pendingReview: Number(row.pending_review),
    totalUsers: Number(row.total_users),
    unverifiedUsers: Number(row.unverified_users),
    activeJurisdictions: Number(row.active_jurisdictions),
  };
}

export interface ReviewItem {
  id: string;
  headline: string;
  industry: string;
  jurisdictionCode: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Whether the confidential half exists — never what it contains. */
  hasProfile: boolean;
  financialYears: number;
}

/**
 * Listings waiting on a decision.
 *
 * The two completeness fields are the interesting part. A reviewer needs to
 * know a seller has actually filled the listing in before publishing it to the
 * market, and needs that without reading the numbers. So the queue answers
 * "is there a profile" and "how many years of figures" and stops there.
 */
export async function loadReviewQueue(): Promise<ReviewItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_review_queue')
    .select('*')
    .order('updated_at', { ascending: true })
    .limit(100);

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    id: row.id,
    headline: row.headline,
    industry: row.industry,
    jurisdictionCode: row.jurisdiction_code ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasProfile: row.has_profile === true,
    financialYears: Number(row.financial_years ?? 0),
  }));
}

export interface VerificationItem {
  userId: string;
  fullName: string | null;
  email: string | null;
  status: 'unverified' | 'pending' | 'verified' | 'rejected';
  roles: string[];
  createdAt: string;
}

/**
 * People awaiting verification, pending first.
 *
 * Joins `user_roles`, which an admin cannot read directly — that table is
 * restricted to the caller's own rows — so this is a definer function with the
 * admin check inside the body. The roles matter here: verifying a private
 * equity fund and verifying a first-time buyer are not the same job, and an
 * operator deciding without that context is guessing.
 */
export async function loadVerificationQueue(): Promise<VerificationItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('verification_queue');

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    userId: row.user_id,
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    status: row.verification_status,
    roles: (row.roles ?? []) as string[],
    createdAt: row.created_at,
  }));
}

export interface JurisdictionRow {
  code: string;
  name: string;
  countryCode: string;
  isActive: boolean;
  /**
   * State-specific requirements, read by the disclosure layer. Held as jsonb
   * because the shape genuinely varies by state — a rigid column set would be
   * wrong within a quarter.
   */
  requirements: Record<string, unknown>;
}

/**
 * The states Cairn operates in.
 *
 * A switch, not a claim. Turning a jurisdiction on records that the operator
 * has done their own licensing work for that state — it does not verify
 * anything, and nothing in this codebase should ever suggest it does.
 */
export async function loadJurisdictions(): Promise<JurisdictionRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('jurisdictions')
    .select('code, name, country_code, is_active, requirements')
    .order('country_code')
    .order('code');

  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    code: row.code,
    name: row.name,
    countryCode: row.country_code,
    isActive: row.is_active === true,
    requirements: (row.requirements ?? {}) as Record<string, unknown>,
  }));
}

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

/**
 * The audit log.
 *
 * Readable by admins, writable by nobody — there is no UPDATE or DELETE policy
 * on the table and no grant to back one, which a test asserts. An audit log
 * that an administrator can edit is worse than no audit log, because it still
 * looks like evidence.
 */
export async function loadAuditLog(
  options: { action?: string | null } = {},
): Promise<AuditEntry[]> {
  const supabase = await createClient();

  let query = supabase
    .from('audit_log')
    .select('id, actor_email, action, entity_type, entity_id, ip_address, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(200);

  if (options.action) {
    // Prefix match on the dotted action namespace — `listing.` covers
    // `listing.published`, `listing.rejected` and whatever gets added later.
    query = query.like('action', `${options.action}%`);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as Row[]).map((row) => ({
    id: row.id,
    actorEmail: row.actor_email ?? null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? null,
    ipAddress: row.ip_address ?? null,
    createdAt: row.created_at,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}
