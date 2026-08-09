'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Input } from '@ib/ui';

import { emptyAuthState, type AuthFormState } from './types';

interface AuthFormProps {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  /** Sign-up collects a name and enforces a longer password. */
  mode: 'sign-in' | 'sign-up';
}

export function AuthForm({ action, submitLabel, mode }: AuthFormProps) {
  const [state, formAction] = useActionState(action, emptyAuthState);

  return (
    <form action={formAction} className="space-y-4">
      {mode === 'sign-up' ? <Input label="Full name" name="fullName" autoComplete="name" /> : null}

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        // Sign-in is frequently the first field a returning user touches.
        autoFocus={mode === 'sign-in'}
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
        required
        hint={mode === 'sign-up' ? 'At least 12 characters.' : undefined}
      />

      {state.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p role="status" className="text-success text-sm">
          {state.notice}
        </p>
      ) : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  // `useFormStatus` has to be read from a child of the form, not the component
  // that renders it — hence the separate component rather than an inline button.
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" loading={pending}>
      {label}
    </Button>
  );
}
