import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { buildCsp, cspHeaderName, isCspEnforced } from './lib/security/csp';
import { isSupabaseConfigured } from './lib/supabase/env';

/**
 * Refreshes the Supabase session on every request.
 *
 * Access tokens are short-lived. Without a refresh here, a user working through
 * a long document review would be signed out mid-session — which on this
 * product means losing their place in a deal room.
 *
 * This middleware authenticates. It does **not** authorise: it does not decide
 * who may see what. Those checks live in the route handlers and layouts, backed
 * by Row Level Security. Middleware runs before the route is known and is the
 * wrong layer to encode "may this person open this deal room".
 *
 * It also mints the CSP nonce, because this is the only layer that runs before
 * Next renders and can therefore put the nonce where Next will find it. See
 * `lib/security/csp.ts` for why the policy is nonce-based rather than
 * `'unsafe-inline'`.
 */
export async function middleware(request: NextRequest) {
  /*
   * A nonce per request, and it must be per request.
   *
   * A nonce reused across responses is a nonce an attacker can read from one
   * page and paste into an injection on another, which is the same as having no
   * script policy at all. `crypto.randomUUID()` is available in the edge
   * runtime and is what the platform gives us here.
   */
  const nonce = crypto.randomUUID().replace(/-/g, '');

  // Read once and passed to both, so the policy and the header it is sent under
  // cannot disagree — `upgrade-insecure-requests` is only valid in an enforcing
  // policy, and a second call to `isCspEnforced()` is a second chance to drift.
  const enforced = isCspEnforced();

  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === 'development',
    enforced,
  });

  const headerName = cspHeaderName(enforced);

  // Set on the *request* as well as the response. Next reads the nonce out of
  // the request's CSP header to stamp its own inline scripts — without this the
  // policy is correct and the application does not load.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  // Lets the app run before a Supabase project exists — during early
  // development, and in CI where the build must not require secrets.
  if (!isSupabaseConfigured()) {
    const bare = NextResponse.next({ request: { headers: requestHeaders } });
    bare.headers.set(headerName, csp);
    return bare;
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not remove. Calling getUser() is what triggers the refresh; dropping it
  // because "the value is unused" silently reintroduces mid-session sign-outs.
  await supabase.auth.getUser();

  // Set last, because the cookie handler above rebuilds `response` and would
  // otherwise drop it.
  response.headers.set(headerName, csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Running on those wastes
     * a token refresh per asset request and slows every page.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
