import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Exchanges the emailed confirmation code for a session.
 *
 * Supabase redirects here after a user clicks the link in their confirmation
 * or password-reset email.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid_code`);
  }

  // `next` comes from the query string, so it is attacker-controlled. Only
  // same-origin relative paths are honoured — otherwise this route is an open
  // redirect that lends the platform's domain to a phishing link.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  return NextResponse.redirect(`${origin}${safeNext}`);
}
