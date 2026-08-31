import 'server-only';

import type { AccountState, PlatformRole } from '@ib/core';

import { getAssuranceState } from '@/lib/auth/assurance';
import { createClient } from '@/lib/supabase/server';

/**
 * The facts the next-step engine decides on.
 *
 * Every count comes through the caller's own client, so Row Level Security
 * scopes it: a seller's listing count is their listings, a buyer's NDA count is
 * their agreements. There is no privileged read here and there must not be —
 * a checklist is not worth a query that can see other people's rows.
 *
 * Counts rather than rows throughout. The dashboard needs to know *whether*
 * something is outstanding, not what it is, and `head: true` asks Postgres for
 * the number without shipping the data.
 */
export async function accountState(roles: PlatformRole[]): Promise<AccountState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return emptyState(roles);
  }

  const count = async (
    table: string,
    build: (q: ReturnType<typeof supabase.from>) => unknown,
  ): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = build(supabase.from(table) as any) as any;
    const { count: n } = await query;
    return typeof n === 'number' ? n : 0;
  };

  const [
    profile,
    assurance,
    listingCount,
    liveListingCount,
    draftListingCount,
    pendingNdaRequests,
    criteria,
    verification,
    signedNdaCount,
  ] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    getAssuranceState(),
    count('listings', (q) => q.select('id', { count: 'exact', head: true })),
    count('listings', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('seller_id', user.id).eq('status', 'live'),
    ),
    count('listings', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('seller_id', user.id).eq('status', 'draft'),
    ),
    count('listing_ndas', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('status', 'requested'),
    ),
    supabase.from('acquisition_criteria').select('id').eq('user_id', user.id).maybeSingle(),
    supabase.from('buyer_verifications').select('status').eq('buyer_id', user.id).maybeSingle(),
    count('listing_ndas', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('buyer_id', user.id).eq('status', 'signed'),
    ),
  ]);

  /*
   * Listings on the market with nothing behind the gate.
   *
   * Counted by comparing the seller's live listings against the detail rows
   * they own, rather than with a join: PostgREST cannot express "rows in A with
   * no row in B" without an embedded filter, and the numbers here are small
   * enough that two counts is clearer than a clever query.
   */
  const ownedListings = await supabase
    .from('listings')
    .select('id')
    .eq('seller_id', user.id)
    .in('status', ['live', 'under_loi', 'under_contract'])
    .limit(200);

  const liveIds = (ownedListings.data ?? []).map((row) => (row as { id: string }).id);

  let listingsMissingConfidential = 0;
  if (liveIds.length > 0) {
    const details = await supabase
      .from('listing_details')
      .select('listing_id')
      .in('listing_id', liveIds);

    const withDetails = new Set(
      (details.data ?? []).map((row) => (row as { listing_id: string }).listing_id),
    );
    listingsMissingConfidential = liveIds.filter((id) => !withDetails.has(id)).length;
  }

  const verificationStatus = (verification.data as { status?: string } | null)?.status;

  return {
    roles,
    hasDisplayName: Boolean((profile.data as { full_name?: string } | null)?.full_name?.trim()),
    hasSecondFactor: assurance.hasEnrolledFactor,
    listingCount,
    draftListingCount,
    liveListingCount,
    listingsMissingConfidential,
    pendingNdaRequests,
    hasAcquisitionCriteria: Boolean(criteria.data),
    fundingVerification:
      verificationStatus === 'verified'
        ? 'verified'
        : verificationStatus === 'pending'
          ? 'pending'
          : verificationStatus === 'rejected'
            ? 'rejected'
            : 'none',
    savedListingCount: 0,
    signedNdaCount,
  };
}

/**
 * What to assume when there is no session.
 *
 * Everything false and zero, which makes every step outstanding. The page above
 * redirects an unauthenticated caller long before this matters; returning a
 * shape rather than throwing means a transient auth hiccup renders a checklist
 * instead of an error page.
 */
function emptyState(roles: PlatformRole[]): AccountState {
  return {
    roles,
    hasDisplayName: false,
    hasSecondFactor: false,
    listingCount: 0,
    draftListingCount: 0,
    liveListingCount: 0,
    listingsMissingConfidential: 0,
    pendingNdaRequests: 0,
    hasAcquisitionCriteria: false,
    fundingVerification: 'none',
    savedListingCount: 0,
    signedNdaCount: 0,
  };
}
