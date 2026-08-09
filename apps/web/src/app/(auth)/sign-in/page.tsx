import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { signIn } from '@/features/auth/actions';
import { AuthForm } from '@/features/auth/auth-form';

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
