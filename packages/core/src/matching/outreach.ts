import type { FitReason } from '../criteria/model';

/**
 * Composing outreach to a matched buyer.
 *
 * Personalised automatically, sent by a person. The specification draws that
 * line and this module sits on the safe side of it: it returns text. It has no
 * network access, no send function, and nothing downstream of it can deliver
 * anything without a row moving to `approved` first — which the database
 * enforces, not this file.
 *
 * ## What it may say
 *
 * Only what the buyer could already read: the anonymised teaser, plus their own
 * redacted match reasons. It never receives the confidential profile, so it
 * cannot leak it. That is enforced by the shape of `OutreachInput` — there is
 * no field for a legal name or an exact figure, so a future edit that wants to
 * mention revenue has to change the type first, and that is a conversation.
 *
 * ## What it must say
 *
 * A commercial message needs a real sender, a physical postal address and a way
 * to stop receiving them. Those come from brand configuration rather than being
 * hard-coded, and `outreachIsSendable()` reports when they are missing so the UI
 * can refuse to offer approval rather than producing something unsendable.
 *
 * ## Deterministic, not generated
 *
 * Same inputs, same words. An LLM would write nicer sentences and would also
 * make this untestable, unreviewable at scale, and capable of inventing a claim
 * about somebody's business. When a model is added it should draft *variations*
 * that a person reads — not replace the guarantee that the words are known in
 * advance.
 */

export interface OutreachInput {
  /** The listing's anonymised headline. Never the company name. */
  headline: string;
  industryLabel: string;
  /** State name, e.g. "New York". The teaser stops at the state line. */
  location?: string;
  /** Published range, already formatted — "$1.5M – $2.5M". Never an exact figure. */
  earningsBand?: string;

  /** Who it is to. Null when the platform has no name for them. */
  recipientName?: string | null;
  /** The person sending, not the platform. */
  senderName: string;

  /** 0–100. Included only when it helps explain why they were contacted. */
  score?: number;
  /** Already redacted. Never pass raw `scoreFit` output here. */
  reasons?: FitReason[];

  brandName: string;
  /** Required for a commercial message. Missing means not sendable. */
  senderPostalAddress?: string;
  unsubscribeUrl?: string;
}

export interface ComposedOutreach {
  subject: string;
  body: string;
}

/** How many match reasons to name. Three is enough to feel specific. */
const MAX_REASONS = 3;

export function composeOutreach(input: OutreachInput): ComposedOutreach {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : 'Hello,';

  const where = input.location ? ` in ${input.location}` : '';
  const size = input.earningsBand ? ` Earnings are in the ${input.earningsBand} range.` : '';

  const positives = (input.reasons ?? [])
    .filter((reason) => reason.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, MAX_REASONS);

  const why =
    positives.length > 0
      ? `\n\nWhy I thought of you:\n${positives.map((r) => `- ${r.label}: ${r.detail}`).join('\n')}`
      : '';

  const scoreLine =
    input.score !== undefined
      ? `\n\nOur system scores it as a ${input.score}% fit against the criteria you saved. ` +
        'That is an estimate to start a conversation, not a valuation or a recommendation.'
      : '';

  const body =
    `${greeting}\n\n` +
    `I am representing the sale of a ${input.industryLabel.toLowerCase()} business${where}: ` +
    `${input.headline}.${size}` +
    why +
    scoreLine +
    '\n\nThe business is listed anonymously. If you would like the full profile — company ' +
    'name, exact financials and customer detail — reply or request access on the listing and ' +
    'I will send you a confidentiality agreement to sign first.\n\n' +
    `${input.senderName}\n` +
    `Sent through ${input.brandName}` +
    footer(input);

  return {
    subject: `${input.industryLabel}${where} — may fit your acquisition criteria`,
    body,
  };
}

function footer(input: OutreachInput): string {
  const lines: string[] = [];

  if (input.senderPostalAddress) lines.push(input.senderPostalAddress);
  if (input.unsubscribeUrl) lines.push(`Stop receiving these: ${input.unsubscribeUrl}`);

  return lines.length > 0 ? `\n\n---\n${lines.join('\n')}` : '';
}

/**
 * Whether this message may lawfully be sent as a commercial email.
 *
 * Returns the reasons it may not, so the UI can say what is missing rather than
 * disabling a button with no explanation. Deliberately not a boolean.
 *
 * This checks the two things a sender always needs — a postal address and a way
 * to opt out. It is **not** a compliance guarantee: rules vary by jurisdiction
 * and by channel, SMS in particular carries consent requirements this does not
 * model, and the sender remains responsible for their own compliance. It is a
 * tool that supports that process, not a substitute for it.
 */
export function outreachBlockers(input: OutreachInput): string[] {
  const blockers: string[] = [];

  if (!input.senderPostalAddress) {
    blockers.push('A physical postal address is required on commercial messages.');
  }
  if (!input.unsubscribeUrl) {
    blockers.push('A working way to opt out is required on commercial messages.');
  }
  if (!input.senderName.trim()) {
    blockers.push('Messages must identify who is sending them.');
  }

  return blockers;
}
