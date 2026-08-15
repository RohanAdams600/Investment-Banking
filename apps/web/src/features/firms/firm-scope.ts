import 'server-only';

import { listMyFirms } from '@/features/deals/queries';
import type { FirmOption } from '@/features/deals/types';

/**
 * Which firm a page is acting for.
 *
 * Three call sites used to write `actor.firmMemberships[0]?.firmId` and hope.
 * For the overwhelming majority of users that is right — most brokers belong to
 * one firm — and for the rest it silently files a document, a contact or a fee
 * against whichever firm the database happened to return first.
 *
 * Silently is the problem. A broker who works at two brokerages and uploads a
 * seller's tax return to the wrong one has done something they cannot see and
 * cannot undo, because the vault is append-only by design.
 *
 * So this returns the selection *and* whether there was a choice to make, and
 * pages that get `mustChoose` show a picker rather than guessing.
 */
export interface FirmScope {
  /** The firm to act as, or null for somebody with no firm at all. */
  firm: FirmOption | null;
  /** Every firm the caller belongs to, for the picker. */
  options: FirmOption[];
  /**
   * True when the caller belongs to more than one and has not said which.
   * A page seeing this must not write anything until they have.
   */
  mustChoose: boolean;
}

/**
 * @param requested the `?firm=` from the URL, if any.
 */
export async function resolveFirmScope(requested?: string | null): Promise<FirmScope> {
  const options = await listMyFirms();

  if (options.length === 0) {
    // An unaffiliated seller. Legitimate and common — the CRM and the vault both
    // work for one person selling one business.
    return { firm: null, options, mustChoose: false };
  }

  if (options.length === 1) {
    return { firm: options[0]!, options, mustChoose: false };
  }

  // A requested firm is honoured only if it is genuinely theirs. `listMyFirms`
  // now answers membership rather than visibility, so this is a real check
  // rather than a formality.
  const chosen = requested ? (options.find((option) => option.id === requested) ?? null) : null;

  return { firm: chosen, options, mustChoose: chosen === null };
}
