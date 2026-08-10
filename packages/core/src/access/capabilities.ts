import type { PlatformRole } from './roles';

/**
 * The capability catalog.
 *
 * Permissions are expressed as capabilities rather than as role checks scattered
 * through the codebase. `can(actor, 'listing:publish_request')` survives a
 * reorganisation of the role model; `actor.role === 'seller'` does not.
 *
 * Capabilities answer "is this kind of action available to this person at all".
 * They do **not** answer "on this particular record" — that requires the record,
 * and lives in the resource-aware checks in `can.ts`. Both have to pass.
 */
export const CAPABILITIES = [
  // --- listings -----------------------------------------------------------
  'listing:create',
  'listing:update_own',
  'listing:publish_request',
  'listing:view_teaser',
  /** Gated additionally on an executed NDA — see `canViewFullListing`. */
  'listing:view_full',
  /** Brokers acting for a seller client. */
  'listing:manage_for_client',
  /** Admin review queue. */
  'listing:review',

  // --- deals ---------------------------------------------------------------
  /**
   * Opening a deal. Sell-side only: a buyer is invited into a deal, they do not
   * start one. Mirrored in SQL by `app.can_create_deal()`, which the
   * `create_deal()` function checks — the two are duplicated because the
   * database cannot import TypeScript, and a test asserts they agree.
   */
  'deal:create',

  // --- deal room ----------------------------------------------------------
  'deal_room:access',
  'document:upload',
  'document:download',
  'document:set_permissions',
  'nda:send',
  'nda:sign',

  // --- crm and messaging --------------------------------------------------
  'crm:manage',
  'message:send',

  // --- commissions --------------------------------------------------------
  'commission:configure',
  'commission:view_own',
  'commission:view_all',

  // --- firm ---------------------------------------------------------------
  'firm:manage_members',
  'firm:configure',

  // --- admin --------------------------------------------------------------
  'admin:verify_users',
  'admin:view_audit_log',
  'admin:manage_templates',
  'admin:manage_jurisdictions',
  'admin:view_platform_analytics',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities shared by every role that acquires rather than sells. */
const BUY_SIDE_CAPABILITIES: readonly Capability[] = [
  'listing:view_teaser',
  'listing:view_full',
  'deal_room:access',
  'document:download',
  'nda:sign',
  'crm:manage',
  'message:send',
];

/** Capabilities shared by anyone bringing a business to market. */
const SELL_SIDE_CAPABILITIES: readonly Capability[] = [
  'deal:create',
  'listing:create',
  'listing:update_own',
  'listing:publish_request',
  'listing:view_teaser',
  'deal_room:access',
  'document:upload',
  'document:set_permissions',
  'nda:send',
  'crm:manage',
  'message:send',
  'commission:view_own',
];

/**
 * Role → capability grants. Deny by default: a capability absent from every
 * role a user holds is denied, and there is no wildcard.
 *
 * **`admin` is not a superuser.** It carries platform operations — verification,
 * listing review, templates, audit — and deliberately *not* `deal_room:access`
 * or `document:download`. An internal operator should not be able to read the
 * confidential financials of a business they are not party to as a side effect
 * of moderating listings. Where admins genuinely need document access (a fraud
 * investigation), that should be a separate, individually-audited elevation
 * rather than an ambient permission — see docs/data-model.md on the audit log.
 */
const ROLE_CAPABILITIES: Record<PlatformRole, readonly Capability[]> = {
  buyer: BUY_SIDE_CAPABILITIES,
  investor: BUY_SIDE_CAPABILITIES,
  search_fund: BUY_SIDE_CAPABILITIES,
  private_equity: BUY_SIDE_CAPABILITIES,
  family_office: BUY_SIDE_CAPABILITIES,

  seller: SELL_SIDE_CAPABILITIES,

  broker: [
    ...SELL_SIDE_CAPABILITIES,
    'listing:manage_for_client',
    'commission:configure',
    'firm:manage_members',
    'firm:configure',
  ],

  admin: [
    'deal:create',
    'listing:review',
    'listing:view_teaser',
    'admin:verify_users',
    'admin:view_audit_log',
    'admin:manage_templates',
    'admin:manage_jurisdictions',
    'admin:view_platform_analytics',
    'commission:view_all',
  ],
};

export function capabilitiesForRole(role: PlatformRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/** The union of capabilities across every role the actor holds. */
export function capabilitiesForRoles(roles: readonly PlatformRole[]): ReadonlySet<Capability> {
  const granted = new Set<Capability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role]) {
      granted.add(capability);
    }
  }
  return granted;
}

export { ROLE_CAPABILITIES };
