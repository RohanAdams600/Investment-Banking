import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { signUp } from '@/features/auth/actions';
import { AuthForm } from '@/features/auth/auth-form';

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
