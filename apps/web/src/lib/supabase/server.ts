import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from './env';

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 *
 * Uses the anon key and the caller's session cookie, so every query runs as the
 * signed-in user and Row Level Security applies. This is the client to reach
 * for by default.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session on every request, so the write here is redundant rather
          // than load-bearing, and swallowing it is safe.
        }
      },
    },
  });
}

/**
 * Client that bypasses Row Level Security.
 *
 * Legitimate uses are narrow: writing audit entries, granting the `admin` role
 * during operator provisioning, and scheduled jobs with no user context.
 *
 * Everything else should use `createClient()`. Reaching for this to "make a
 * query work" removes the database's independent check on a query the
 * application layer may already have got wrong — and those are exactly the
 * queries where the second check earns its keep.
 *
 * `server-only` at the top of this module means importing it from a Client
 * Component is a build error, not a runtime leak.
 */
export function createServiceRoleClient() {
  return createServerClient(supabaseUrl(), supabaseServiceRoleKey(), {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
    auth: {
      // No session to persist or refresh — this client is never a user.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
