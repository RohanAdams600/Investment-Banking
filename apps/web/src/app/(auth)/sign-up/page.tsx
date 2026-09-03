import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { signUp } from '@/features/auth/actions';
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
  title: 'Create an account',
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuthForm action={signUp} submitLabel="Create account" mode="sign-up" />

        {/*
          Role selection and consent capture are deliberately not on this form.
          A new account holds no platform role until onboarding, and consent has
          to reference a published legal template version — which does not exist
          until counsel has approved the text. See supabase/seed.sql.
        */}

        <p className="text-text-muted text-center text-sm">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
