import 'server-only';

import { cache } from 'react';
import type { Actor, FirmRole, PlatformRole } from '@ib/core';

import { createClient } from '../supabase/server';

/**
 * Bridges the session to the permission model.
 *
 * `packages/core` deliberately knows nothing about Supabase, HTTP, or React —
 * it takes an `Actor` and answers questions about it. This is the one place
 * that assembles an `Actor` from the database, so the permission model stays
 * usable from a scheduled job or a future partner API that has no request.
 *
 * Wrapped in React's `cache` so several components on one page share a single
 * pair of queries rather than each re-fetching roles and memberships.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createClient();

  // getUser() re-validates the token against the auth server. getSession()
  // reads the cookie and trusts it, which is fine for rendering but not for an
  // authorisation decision — and this value feeds authorisation decisions.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [rolesResult, membershipsResult] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('firm_members').select('firm_id, role').eq('user_id', user.id),
  ]);

  if (rolesResult.error) throw rolesResult.error;
  if (membershipsResult.error) throw membershipsResult.error;

  return {
    userId: user.id,
    platformRoles: (rolesResult.data ?? []).map((r) => r.role as PlatformRole),
    firmMemberships: (membershipsResult.data ?? []).map((m) => ({
      firmId: m.firm_id as string,
      role: m.role as FirmRole,
    })),
  };
});
