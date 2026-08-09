import { capabilitiesForRoles, type Capability } from './capabilities';
import { canAdministerFirm, isMemberOfFirm, isPlatformAdmin, type Actor } from './roles';

/**
 * Permission decisions.
 *
 * Two layers, and both must pass:
 *
 *   1. **Capability** — does any role this actor holds grant this kind of action?
 *   2. **Resource** — does this actor stand in the right relationship to *this*
 *      record?
 *
 * Capability alone is not authorisation. A seller has `listing:update_own`, but
 * that does not let them edit somebody else's listing. Every resource-aware
 * helper below checks both.
 *
 * These functions are pure and take everything they need as arguments. They do
 * not read a session, hit a database, or call the network — which is what lets
 * the API layer, a scheduled job, and a future partner API share one
 * implementation, and what makes the tests fast enough to be exhaustive.
 *
 * **This is not the only line of defence.** Row Level Security in Postgres
 * enforces tenant isolation independently, for the case where a route handler
 * forgets to call one of these. Neither is sufficient alone: RLS cannot express
 * every business rule, and application checks cannot protect against a query
 * that bypasses them.
 */

export type ListingStatus =
  'draft' | 'pending_review' | 'live' | 'under_loi' | 'under_contract' | 'closed' | 'withdrawn';

/** Statuses at which a listing's anonymised teaser is publicly discoverable. */
const PUBLICLY_VISIBLE_STATUSES: readonly ListingStatus[] = ['live', 'under_loi', 'under_contract'];

export interface ListingRef {
  id: string;
  /** The seller who owns the listing. */
  ownerUserId: string;
  /** The brokerage or firm managing it, if any. */
  firmId: string | null;
  status: ListingStatus;
}

export type NdaStatus = 'none' | 'sent' | 'signed' | 'revoked' | 'expired';

export interface NdaRef {
  listingId: string;
  userId: string;
  status: NdaStatus;
  /** Null means no expiry. */
  expiresAt: Date | null;
}

/** Layer 1: does any role this actor holds grant this capability at all? */
export function can(actor: Actor, capability: Capability): boolean {
  return capabilitiesForRoles(actor.platformRoles).has(capability);
}

/** True when the actor owns the listing outright or manages it through its firm. */
export function controlsListing(actor: Actor, listing: ListingRef): boolean {
  if (listing.ownerUserId === actor.userId) return true;
  if (listing.firmId === null) return false;

  // A brokerage colleague can act on the firm's listings, but only with the
  // capability that says brokers may act for clients.
  return isMemberOfFirm(actor, listing.firmId) && can(actor, 'listing:manage_for_client');
}

export function canEditListing(actor: Actor, listing: ListingRef): boolean {
  if (!can(actor, 'listing:update_own')) return false;
  if (!controlsListing(actor, listing)) return false;

  // Once a deal is closed or withdrawn the record is history. Editing it would
  // rewrite what the parties actually agreed to, and the commission and audit
  // records point at it.
  return listing.status !== 'closed' && listing.status !== 'withdrawn';
}

/**
 * The anonymised teaser — industry, size band, geography. No company name, no
 * address, no financial detail.
 */
export function canViewListingTeaser(actor: Actor, listing: ListingRef): boolean {
  if (controlsListing(actor, listing)) return true;
  if (!can(actor, 'listing:view_teaser')) return false;
  return PUBLICLY_VISIBLE_STATUSES.includes(listing.status);
}

/**
 * The full profile — company identity, financials, customer concentration.
 *
 * This is the single most consequential check in the product. A seller's
 * business being identifiable before they chose to disclose it can cost them
 * staff, customers, and the deal itself. It is gated on an NDA that is
 * **executed and currently in force**, and the expiry is checked rather than
 * assumed.
 *
 * `now` is injected rather than read from the clock so expiry behaviour is
 * testable at a boundary instead of approximately.
 */
export function canViewFullListing(
  actor: Actor,
  listing: ListingRef,
  nda: NdaRef | null,
  now: Date = new Date(),
): boolean {
  // The seller and their broker always see their own full profile.
  if (controlsListing(actor, listing)) return true;

  if (!can(actor, 'listing:view_full')) return false;
  if (!canViewListingTeaser(actor, listing)) return false;

  if (nda === null) return false;
  if (nda.listingId !== listing.id || nda.userId !== actor.userId) return false;
  if (nda.status !== 'signed') return false;
  if (nda.expiresAt !== null && nda.expiresAt.getTime() <= now.getTime()) return false;

  return true;
}

/**
 * Whether the actor may read a firm's data at all.
 *
 * Platform admins are included here — firm records carry verification status and
 * are part of what admins moderate. Note this is firm *metadata*, not the deal
 * documents belonging to that firm, which admins do not get by default.
 */
export function canAccessFirm(actor: Actor, firmId: string): boolean {
  return isMemberOfFirm(actor, firmId) || isPlatformAdmin(actor);
}

export function canManageFirmMembers(actor: Actor, firmId: string): boolean {
  return can(actor, 'firm:manage_members') && canAdministerFirm(actor, firmId);
}

export function canConfigureFirm(actor: Actor, firmId: string): boolean {
  return can(actor, 'firm:configure') && canAdministerFirm(actor, firmId);
}

/**
 * Throws instead of returning false. For call sites where forgetting to check
 * the boolean would fail open — a route handler that computes a result and then
 * returns it regardless.
 */
export function assertCan(actor: Actor, capability: Capability): void {
  if (!can(actor, capability)) {
    throw new PermissionError(capability, actor.userId);
  }
}

export class PermissionError extends Error {
  readonly capability: Capability;
  readonly userId: string;

  constructor(capability: Capability, userId: string) {
    // The message names the capability, not the record. Error text reaches logs
    // and sometimes clients; it should not disclose which listing was probed.
    super(`Permission denied: ${capability}`);
    this.name = 'PermissionError';
    this.capability = capability;
    this.userId = userId;
  }
}
