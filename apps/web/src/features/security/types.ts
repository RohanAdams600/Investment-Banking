/**
 * Shapes shared between the security server actions and their forms.
 *
 * Separate from the action modules because a `'use server'` file may only
 * export async functions.
 */

export interface MfaActionState {
  error: string | null;
  notice: string | null;
}

export const emptyMfaState: MfaActionState = { error: null, notice: null };

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** Null when the platform did not record one. */
  userAgent: string | null;
  ipAddress: string | null;
  /** `aal2` means the session was established with a second factor. */
  assuranceLevel: string | null;
  /** True for the session making the current request. */
  isCurrent: boolean;
}

export interface MfaFactorSummary {
  id: string;
  friendlyName: string | null;
  status: string;
  createdAt: string;
}
