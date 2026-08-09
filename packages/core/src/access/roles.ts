/**
 * Roles.
 *
 * Two independent axes, deliberately kept separate:
 *
 *   - **Platform roles** describe what a person does on the platform. A user
 *     holds *many* of these. A broker who also buys businesses is one account
 *     with two roles, not two accounts — which is why this is a set and why the
 *     database stores it as a join table rather than a column on `users`.
 *
 *   - **Firm roles** describe a person's standing inside one firm. A user holds
 *     one per firm, and may belong to several firms with a different role in
 *     each — a broker at their own brokerage who is also an associate at a
 *     search fund.
 *
 * Neither axis implies the other. Being a firm owner grants authority over that
 * firm's data; it grants nothing on the platform at large.
 */

export const PLATFORM_ROLES = [
  'buyer',
  'seller',
  'investor',
  'search_fund',
  'private_equity',
  'family_office',
  'broker',
  'admin',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Roles that acquire rather than sell. They share an acquisition-criteria object
 * and the same baseline capabilities; they differ in the fields their portal
 * collects and in privacy defaults, not in what they are permitted to do.
 */
export const BUY_SIDE_ROLES = [
  'buyer',
  'investor',
  'search_fund',
  'private_equity',
  'family_office',
] as const satisfies readonly PlatformRole[];

export type BuySideRole = (typeof BUY_SIDE_ROLES)[number];

export function isBuySideRole(role: PlatformRole): role is BuySideRole {
  return (BUY_SIDE_ROLES as readonly PlatformRole[]).includes(role);
}

export const FIRM_ROLES = ['owner', 'admin', 'member'] as const;

export type FirmRole = (typeof FIRM_ROLES)[number];

export interface FirmMembership {
  firmId: string;
  role: FirmRole;
}

/**
 * Everything a permission decision is allowed to depend on.
 *
 * Assembled once per request from the session and passed down. A permission
 * check never reaches back into the database or the network — that is what makes
 * `can()` a pure function, testable without a server, and reusable from a
 * scheduled job or a future partner API.
 */
export interface Actor {
  userId: string;
  platformRoles: readonly PlatformRole[];
  firmMemberships: readonly FirmMembership[];
}

export function hasPlatformRole(actor: Actor, role: PlatformRole): boolean {
  return actor.platformRoles.includes(role);
}

export function isPlatformAdmin(actor: Actor): boolean {
  return hasPlatformRole(actor, 'admin');
}

export function firmRoleOf(actor: Actor, firmId: string): FirmRole | null {
  return actor.firmMemberships.find((m) => m.firmId === firmId)?.role ?? null;
}

export function isMemberOfFirm(actor: Actor, firmId: string): boolean {
  return firmRoleOf(actor, firmId) !== null;
}

/** Owners and firm admins can administer the firm; plain members cannot. */
export function canAdministerFirm(actor: Actor, firmId: string): boolean {
  const role = firmRoleOf(actor, firmId);
  return role === 'owner' || role === 'admin';
}
