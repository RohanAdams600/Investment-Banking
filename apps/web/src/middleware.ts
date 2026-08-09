import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
 */
export async function middleware(request: NextRequest) {
  // Lets the app run before a Supabase project exists — during early
  // development, and in CI where the build must not require secrets.
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
