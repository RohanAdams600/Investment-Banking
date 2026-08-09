import { describe, expect, it } from 'vitest';

import {
  assertCan,
  can,
  canAccessFirm,
  canEditListing,
  canManageFirmMembers,
  canViewFullListing,
  canViewListingTeaser,
  controlsListing,
  PermissionError,
  type ListingRef,
  type NdaRef,
} from './can';
import { CAPABILITIES, capabilitiesForRoles } from './capabilities';
import { PLATFORM_ROLES, type Actor, type PlatformRole } from './roles';

const SELLER_ID = 'user-seller';
const BUYER_ID = 'user-buyer';
const BROKERAGE_ID = 'firm-brokerage';

function actor(roles: PlatformRole[], overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'user-test',
    platformRoles: roles,
    firmMemberships: [],
    ...overrides,
  };
}

const liveListing: ListingRef = {
  id: 'listing-1',
  ownerUserId: SELLER_ID,
  firmId: null,
  status: 'live',
};

const signedNda = (userId: string): NdaRef => ({
  listingId: liveListing.id,
  userId,
  status: 'signed',
  expiresAt: null,
});

describe('capability grants', () => {
  it('denies by default — an unknown capability is not granted by any role', () => {
    const everyCapability = capabilitiesForRoles(PLATFORM_ROLES);
    // Every granted capability must be one we declared. A typo'd string in the
    // role map would otherwise silently grant nothing and be very hard to spot.
    for (const capability of everyCapability) {
      expect(CAPABILITIES).toContain(capability);
    }
  });

  it('grants a user the union of every role they hold', () => {
    const brokerAndBuyer = actor(['broker', 'buyer']);

    expect(can(brokerAndBuyer, 'listing:manage_for_client')).toBe(true); // broker
    expect(can(brokerAndBuyer, 'nda:sign')).toBe(true); // buyer
  });

  it('does not treat admin as a superuser', () => {
    const admin = actor(['admin']);

    expect(can(admin, 'admin:view_audit_log')).toBe(true);
    expect(can(admin, 'listing:review')).toBe(true);

    // The point of the model: moderating listings must not carry ambient access
    // to the confidential documents of deals the admin is not party to.
    expect(can(admin, 'deal_room:access')).toBe(false);
    expect(can(admin, 'document:download')).toBe(false);
    expect(can(admin, 'listing:view_full')).toBe(false);
  });

  it('gives a plain buyer no sell-side or admin capability', () => {
    const buyer = actor(['buyer']);

    expect(can(buyer, 'listing:create')).toBe(false);
    expect(can(buyer, 'commission:configure')).toBe(false);
    expect(can(buyer, 'admin:verify_users')).toBe(false);
    expect(can(buyer, 'listing:review')).toBe(false);
  });

  it('assertCan throws a PermissionError naming the capability but not the record', () => {
    const buyer = actor(['buyer']);

    expect(() => assertCan(buyer, 'admin:verify_users')).toThrow(PermissionError);
    try {
      assertCan(buyer, 'admin:verify_users');
    } catch (error) {
      // Error text reaches logs and sometimes clients — it must not disclose
      // which record was probed.
      expect((error as PermissionError).message).toBe('Permission denied: admin:verify_users');
      expect((error as PermissionError).capability).toBe('admin:verify_users');
    }
  });
});

describe('listing control', () => {
  it('recognises the owning seller', () => {
    const seller = actor(['seller'], { userId: SELLER_ID });
    expect(controlsListing(seller, liveListing)).toBe(true);
  });

  it('recognises a broker at the firm managing the listing', () => {
    const managed: ListingRef = { ...liveListing, firmId: BROKERAGE_ID };
    const broker = actor(['broker'], {
      userId: 'user-broker',
      firmMemberships: [{ firmId: BROKERAGE_ID, role: 'member' }],
    });

    expect(controlsListing(broker, managed)).toBe(true);
  });

  it('does not let a firm member without the broker capability act on firm listings', () => {
    const managed: ListingRef = { ...liveListing, firmId: BROKERAGE_ID };
    // Membership alone is not authority — an analyst at the brokerage who only
    // holds a buyer role should not be able to edit client listings.
    const analyst = actor(['buyer'], {
      userId: 'user-analyst',
      firmMemberships: [{ firmId: BROKERAGE_ID, role: 'member' }],
    });

    expect(controlsListing(analyst, managed)).toBe(false);
  });

  it('does not let a broker at a different firm act on the listing', () => {
    const managed: ListingRef = { ...liveListing, firmId: BROKERAGE_ID };
    const rival = actor(['broker'], {
      userId: 'user-rival',
      firmMemberships: [{ firmId: 'firm-other', role: 'owner' }],
    });

    expect(controlsListing(rival, managed)).toBe(false);
  });
});

describe('canEditListing', () => {
  it('allows the owning seller to edit a live listing', () => {
    const seller = actor(['seller'], { userId: SELLER_ID });
    expect(canEditListing(seller, liveListing)).toBe(true);
  });

  it('refuses another seller', () => {
    const other = actor(['seller'], { userId: 'user-other-seller' });
    expect(canEditListing(other, liveListing)).toBe(false);
  });

  it('freezes closed and withdrawn listings even for the owner', () => {
    const seller = actor(['seller'], { userId: SELLER_ID });

    // Commission records and the audit log point at these. Editing after the
    // fact would rewrite what the parties actually agreed to.
    expect(canEditListing(seller, { ...liveListing, status: 'closed' })).toBe(false);
    expect(canEditListing(seller, { ...liveListing, status: 'withdrawn' })).toBe(false);
  });
});

describe('canViewListingTeaser', () => {
  it('shows live listings to buy-side roles', () => {
    expect(canViewListingTeaser(actor(['buyer'], { userId: BUYER_ID }), liveListing)).toBe(true);
    expect(canViewListingTeaser(actor(['private_equity']), liveListing)).toBe(true);
    expect(canViewListingTeaser(actor(['family_office']), liveListing)).toBe(true);
  });

  it('hides drafts and pending listings from everyone but the owner', () => {
    const buyer = actor(['buyer'], { userId: BUYER_ID });
    const seller = actor(['seller'], { userId: SELLER_ID });

    for (const status of ['draft', 'pending_review'] as const) {
      expect(canViewListingTeaser(buyer, { ...liveListing, status })).toBe(false);
      expect(canViewListingTeaser(seller, { ...liveListing, status })).toBe(true);
    }
  });

  it('keeps teasers visible once a deal is under LOI but hides withdrawn ones', () => {
    const buyer = actor(['buyer'], { userId: BUYER_ID });

    expect(canViewListingTeaser(buyer, { ...liveListing, status: 'under_loi' })).toBe(true);
    expect(canViewListingTeaser(buyer, { ...liveListing, status: 'withdrawn' })).toBe(false);
  });
});

describe('canViewFullListing', () => {
  const buyer = actor(['buyer'], { userId: BUYER_ID });

  it('refuses a buyer with no NDA', () => {
    expect(canViewFullListing(buyer, liveListing, null)).toBe(false);
  });

  it('allows a buyer with a signed, unexpired NDA', () => {
    expect(canViewFullListing(buyer, liveListing, signedNda(BUYER_ID))).toBe(true);
  });

  it('refuses every NDA state short of signed', () => {
    for (const status of ['none', 'sent', 'revoked', 'expired'] as const) {
      const nda: NdaRef = { ...signedNda(BUYER_ID), status };
      expect(canViewFullListing(buyer, liveListing, nda), status).toBe(false);
    }
  });

  it('refuses an NDA that has passed its expiry', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const expired: NdaRef = {
      ...signedNda(BUYER_ID),
      expiresAt: new Date('2026-05-31T23:59:59Z'),
    };

    expect(canViewFullListing(buyer, liveListing, expired, now)).toBe(false);
  });

  it('treats expiry as exclusive — an NDA expiring exactly now is closed', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const expiringNow: NdaRef = { ...signedNda(BUYER_ID), expiresAt: new Date(now) };

    expect(canViewFullListing(buyer, liveListing, expiringNow, now)).toBe(false);
  });

  it('refuses an NDA belonging to a different user', () => {
    // The obvious attack: present someone else's executed NDA.
    const someoneElses = signedNda('user-someone-else');
    expect(canViewFullListing(buyer, liveListing, someoneElses)).toBe(false);
  });

  it('refuses an NDA executed against a different listing', () => {
    const wrongListing: NdaRef = { ...signedNda(BUYER_ID), listingId: 'listing-other' };
    expect(canViewFullListing(buyer, liveListing, wrongListing)).toBe(false);
  });

  it('refuses a signed NDA when the listing is not yet public', () => {
    const draft: ListingRef = { ...liveListing, status: 'draft' };
    expect(canViewFullListing(buyer, draft, signedNda(BUYER_ID))).toBe(false);
  });

  it('lets the seller see their own full profile with no NDA', () => {
    const seller = actor(['seller'], { userId: SELLER_ID });
    expect(canViewFullListing(seller, liveListing, null)).toBe(true);
  });

  it('refuses a platform admin holding a signed NDA-shaped record', () => {
    // Admins lack `listing:view_full` entirely, so even a well-formed NDA row
    // does not open the confidential profile to them.
    const admin = actor(['admin'], { userId: 'user-admin' });
    const nda = signedNda('user-admin');

    expect(canViewFullListing(admin, liveListing, nda)).toBe(false);
  });
});

describe('firm access', () => {
  const firmAdmin = actor(['broker'], {
    userId: 'user-firm-admin',
    firmMemberships: [{ firmId: BROKERAGE_ID, role: 'admin' }],
  });

  it('scopes firm access to members', () => {
    expect(canAccessFirm(firmAdmin, BROKERAGE_ID)).toBe(true);
    expect(canAccessFirm(firmAdmin, 'firm-other')).toBe(false);
  });

  it('lets platform admins read firm metadata for verification', () => {
    expect(canAccessFirm(actor(['admin']), BROKERAGE_ID)).toBe(true);
  });

  it('lets firm owners and admins manage members, but not plain members', () => {
    const member = actor(['broker'], {
      userId: 'user-member',
      firmMemberships: [{ firmId: BROKERAGE_ID, role: 'member' }],
    });

    expect(canManageFirmMembers(firmAdmin, BROKERAGE_ID)).toBe(true);
    expect(canManageFirmMembers(member, BROKERAGE_ID)).toBe(false);
  });

  it('does not let a firm admin manage a firm they do not belong to', () => {
    expect(canManageFirmMembers(firmAdmin, 'firm-other')).toBe(false);
  });

  it('does not let a platform admin manage firm membership', () => {
    // Reading firm metadata for verification is not the same as being able to
    // add themselves to a brokerage.
    expect(canManageFirmMembers(actor(['admin']), BROKERAGE_ID)).toBe(false);
  });

  it('respects per-firm roles for a user belonging to several firms', () => {
    const dualRole = actor(['broker'], {
      userId: 'user-dual',
      firmMemberships: [
        { firmId: BROKERAGE_ID, role: 'owner' },
        { firmId: 'firm-search-fund', role: 'member' },
      ],
    });

    expect(canManageFirmMembers(dualRole, BROKERAGE_ID)).toBe(true);
    expect(canManageFirmMembers(dualRole, 'firm-search-fund')).toBe(false);
  });
});
