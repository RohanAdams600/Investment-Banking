import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { signIn } from '@/features/auth/actions';
import { AuthForm } from '@/features/auth/auth-form';

/*
 * Dynamically rendered, so the Content Security Policy can be enforced.
 *
 * The CSP is nonce-based with `strict-dynamic`, and the nonce is minted per
 * request in `src/middleware.ts`. A statically prerendered page's HTML was
 * generated at build time, before any nonce existed, so Next never stamps one
 * onto its script tags — and under `strict-dynamic` a script without the nonce
 * is refused. Every script on this page was blocked and it rendered as dead
 * HTML.
 *
 * That is not hypothetical: it is what an enforcing CSP did to this route,
 * observed in a browser. A nonce CSP and a cached HTML document are mutually
 * exclusive, and between the two, the control that stops an injected script
 * running on a site handling confidential company information is worth more
 * than a prerender of static copy.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuthForm action={signIn} submitLabel="Sign in" mode="sign-in" />

        <p className="text-text-muted text-center text-sm">
          No account?{' '}
          <Link href="/sign-up" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
