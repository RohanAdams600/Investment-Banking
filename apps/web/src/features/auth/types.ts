/**
 * Shared shapes for the auth forms.
 *
 * Kept out of `actions.ts` because a `'use server'` module may only export
 * async functions — everything else it exports would otherwise be treated as a
 * server action and rejected at build time.
 */

export interface AuthFormState {
  error: string | null;
  notice: string | null;
}

export const emptyAuthState: AuthFormState = { error: null, notice: null };
