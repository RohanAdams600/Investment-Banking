'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import type { AuthFormState } from './types';

/**
 * Credential errors are reported in one deliberately vague form.
 *
 * Distinguishing "no such account" from "wrong password" turns the sign-in form
 * into an account-existence oracle. On a platform where the users are business
 * owners exploring a confidential sale, confirming that a named person has an
 * account here is itself a disclosure.
 */
const CREDENTIAL_ERROR = 'Those credentials did not match an account.';

function readCredentials(formData: FormData): { email: string; password: string } | null {
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') return null;
  if (email.trim() === '' || password === '') return null;

  return { email: email.trim().toLowerCase(), password };
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const credentials = readCredentials(formData);
  if (!credentials) {
    return { error: 'Enter an email address and password.', notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    return { error: CREDENTIAL_ERROR, notice: null };
  }

  redirect('/dashboard');
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const credentials = readCredentials(formData);
  if (!credentials) {
    return { error: 'Enter an email address and password.', notice: null };
  }

  if (credentials.password.length < 12) {
    // Longer than the common eight. These accounts gate confidential financial
    // documents, and the cost of a stronger minimum is one line of friction.
    return { error: 'Choose a password of at least 12 characters.', notice: null };
  }

  const fullName = formData.get('fullName');
  const origin = (await headers()).get('origin');

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...credentials,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data:
        typeof fullName === 'string' && fullName.trim() !== ''
          ? { full_name: fullName.trim() }
          : {},
    },
  });

  if (error) {
    // Supabase distinguishes an already-registered address. Surfacing that
    // would be the same account-existence disclosure as above, so the success
    // path is reported either way and the email tells the real story.
    if (error.status === 429) {
      return { error: 'Too many attempts. Try again in a few minutes.', notice: null };
    }
    return { error: 'Could not complete sign-up. Check the details and try again.', notice: null };
  }

  return {
    error: null,
    notice: 'Check your email for a confirmation link to finish creating your account.',
  };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
