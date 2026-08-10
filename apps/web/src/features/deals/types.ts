/**
 * Form shapes for the deals feature. Separate from `actions.ts` because a
 * `'use server'` module may only export async functions.
 */

export interface DealActionState {
  error: string | null;
}

export const emptyDealState: DealActionState = { error: null };

export interface DealSummary {
  id: string;
  name: string;
  createdAt: string;
  conversationCount: number;
}

export interface FirmOption {
  id: string;
  name: string;
}
