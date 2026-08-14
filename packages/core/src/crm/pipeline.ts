/**
 * The CRM's vocabulary and its one piece of arithmetic.
 *
 * Deliberately thin. A CRM is mostly storage and screens, and the temptation is
 * to invent scoring — lead heat, engagement indices, a number that says who to
 * call. Everything of that kind here would be a guess dressed as a metric, and
 * this codebase has a rule about that: a recommendation has to show its inputs.
 *
 * So what lives here is what can be stated plainly — labels a person can read,
 * and counts that are literally counts.
 */

export const CONTACT_KINDS = ['buyer', 'seller', 'advisor', 'lender', 'referral', 'other'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  advisor: 'Advisor',
  lender: 'Lender',
  referral: 'Referral source',
  other: 'Other',
};

export const LEAD_SOURCES = [
  'listing_inquiry',
  'contact_form',
  'referral',
  'outbound',
  'event',
  'manual',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  listing_inquiry: 'Listing inquiry',
  contact_form: 'Contact form',
  referral: 'Referral',
  outbound: 'Outbound',
  event: 'Event',
  manual: 'Added by hand',
};

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Not a fit',
  converted: 'Became a deal',
};

/** Statuses that are still live work. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'qualified'];

export function isOpen(status: LeadStatus): boolean {
  return OPEN_LEAD_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Email, and what "the same person" means
// ---------------------------------------------------------------------------

/**
 * The key the unique index is built on, in TypeScript.
 *
 * Mirrors `lower(email)` in migration 0024 so the client can warn about a
 * duplicate before the insert rather than surfacing a constraint violation. The
 * database is what actually refuses; this exists so the refusal is not the
 * first the user hears of it.
 *
 * Only case is normalised. Gmail's dots-and-plus rules are real and specific to
 * Gmail, and a CRM that quietly decided `sam.smith@` and `samsmith@` were one
 * person would be wrong for every other provider — and wrong in the direction
 * that merges two different people's records.
 */
export function contactKey(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

export function findDuplicate<T extends { email?: string | null }>(
  candidates: readonly T[],
  email: string | null | undefined,
): T | null {
  const key = contactKey(email);
  if (key === null) return null;
  return candidates.find((candidate) => contactKey(candidate.email) === key) ?? null;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface StageLike {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
  isWon: boolean;
}

export interface LeadLike {
  id: string;
  stageId: string | null;
  status: LeadStatus;
  nextActionAt: string | null;
}

export interface StageColumn<L extends LeadLike> {
  stage: StageLike;
  leads: L[];
}

/**
 * Leads grouped into their columns, in board order.
 *
 * Leads with no stage go into the first column rather than into a hidden
 * bucket. A lead nobody can see is a lead nobody calls, and "it is in the
 * system" is exactly the failure a pipeline board exists to prevent.
 */
export function buildBoard<L extends LeadLike>(
  stages: readonly StageLike[],
  leads: readonly L[],
): StageColumn<L>[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return [];

  const columns = ordered.map((stage) => ({ stage, leads: [] as L[] }));
  const byId = new Map(columns.map((column) => [column.stage.id, column]));

  for (const lead of leads) {
    const column = (lead.stageId ? byId.get(lead.stageId) : undefined) ?? columns[0]!;
    column.leads.push(lead);
  }

  return columns;
}

export interface PipelineCounts {
  open: number;
  won: number;
  lost: number;
  overdue: number;
}

/**
 * Counts, and only counts.
 *
 * No conversion rate, because a rate computed over a pipeline that has been
 * running three weeks is a number that will be quoted in a board meeting and
 * means nothing. When there is a year of data it can be computed from these.
 *
 * `overdue` is the one worth surfacing: a lead with a next action in the past
 * is somebody who was promised a call that did not happen.
 */
export function countPipeline(
  stages: readonly StageLike[],
  leads: readonly LeadLike[],
  now: Date = new Date(),
): PipelineCounts {
  const terminal = new Map(stages.map((stage) => [stage.id, stage]));

  let open = 0;
  let won = 0;
  let lost = 0;
  let overdue = 0;

  for (const lead of leads) {
    const stage = lead.stageId ? terminal.get(lead.stageId) : undefined;

    if (stage?.isWon || lead.status === 'converted') {
      won += 1;
    } else if (stage?.isTerminal || lead.status === 'unqualified') {
      lost += 1;
    } else {
      open += 1;
      if (lead.nextActionAt && new Date(lead.nextActionAt) < now) overdue += 1;
    }
  }

  return { open, won, lost, overdue };
}
