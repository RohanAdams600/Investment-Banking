/**
 * Shapes shared between the valuation server action and the form. Separate
 * because a `'use server'` module may only export async functions.
 */

export interface SaveValuationState {
  error: string | null;
  notice: string | null;
}

export const emptySaveState: SaveValuationState = { error: null, notice: null };
