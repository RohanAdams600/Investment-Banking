import 'server-only';

import {
  capped,
  overFetch,
  type Capped,
  type ContactKind,
  type LeadSource,
  type LeadStatus,
} from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Reads for the CRM.
 *
 * Through the user's client, so the firm boundary is the database's to enforce.
 * That boundary is not a nicety here: a brokerage's pipeline is the most
 * commercially sensitive thing it owns, and two brokers at rival firms share
 * this platform. A query that filtered by firm in TypeScript would be one
 * forgotten `.eq()` away from handing one of them the other's book.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Which owner columns to write, and to filter on.
 *
 * The schema's check constraint says exactly one of `firm_id` / `owner_id` is
 * set, so this is the one place that decides which — a broker's rows belong to
 * their firm, an unaffiliated seller's belong to them. Returned as an object so
 * a call site cannot get the two the wrong way round.
 */
export function crmScope(
  firmId: string | null,
  userId: string,
): {
  firm_id: string | null;
  owner_id: string | null;
} {
  return firmId ? { firm_id: firmId, owner_id: null } : { firm_id: null, owner_id: userId };
}

export interface CrmContact {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  kind: ContactKind;
  tags: string[];
  notes: string | null;
  userId: string | null;
  createdAt: string;
}

/**
 * How many of each list a page shows before it says so.
 *
 * Named rather than inline, because the page has to quote the same number the
 * query used — "showing the first 500" is only true if 500 is what was asked
 * for, and two constants drift.
 */
export const CRM_LIMITS = { contacts: 500, leads: 500, tasks: 200, notes: 500 } as const;

export async function listContacts(): Promise<Capped<CrmContact>> {
  const supabase = await createClient();

  // No firm filter. RLS already scopes this to the caller's world, and adding a
  // filter here would be a second copy of the rule that could disagree with it.
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(overFetch(CRM_LIMITS.contacts));

  if (error || !data) return capped<CrmContact>([], CRM_LIMITS.contacts);

  const page = capped(data as Row[], CRM_LIMITS.contacts);

  return {
    ...page,
    rows: page.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email ?? null,
      phone: row.phone ?? null,
      company: row.company ?? null,
      title: row.title ?? null,
      kind: row.kind,
      tags: (row.tags ?? []) as string[],
      notes: row.notes ?? null,
      userId: row.user_id ?? null,
      createdAt: row.created_at,
    })),
  };
}

export interface CrmStage {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
  isWon: boolean;
}

export async function listStages(): Promise<CrmStage[]> {
  const supabase = await createClient();

  const { data } = await supabase.from('pipeline_stages').select('*').order('position');

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    isTerminal: row.is_terminal === true,
    isWon: row.is_won === true,
  }));
}

export interface CrmLead {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  listingId: string | null;
  source: LeadSource;
  status: LeadStatus;
  stageId: string | null;
  assignedTo: string | null;
  message: string | null;
  lastContactedAt: string | null;
  nextActionAt: string | null;
  createdAt: string;
}

export async function listLeads(): Promise<Capped<CrmLead>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(overFetch(CRM_LIMITS.leads));

  if (error || !data) return capped<CrmLead>([], CRM_LIMITS.leads);

  const page = capped(data as Row[], CRM_LIMITS.leads);
  const rows = page.rows;
  const contacts = await contactsById(rows.map((r) => r.contact_id as string));

  return {
    ...page,
    rows: rows.map((row) => {
      const contact = contacts.get(row.contact_id);
      return {
        id: row.id,
        contactId: row.contact_id,
        // A board of uuids is a board nobody uses. The join is here rather than
        // in SQL because PostgREST embeds go through the same RLS anyway, and one
        // extra query is cheaper than a resource-embedding string to get wrong.
        contactName: contact?.fullName ?? 'Unknown',
        contactEmail: contact?.email ?? null,
        listingId: row.listing_id ?? null,
        source: row.source,
        status: row.status,
        stageId: row.stage_id ?? null,
        assignedTo: row.assigned_to ?? null,
        message: row.message ?? null,
        lastContactedAt: row.last_contacted_at ?? null,
        nextActionAt: row.next_action_at ?? null,
        createdAt: row.created_at,
      };
    }),
  };
}

async function contactsById(ids: string[]): Promise<Map<string, CrmContact>> {
  const map = new Map<string, CrmContact>();
  if (ids.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase
    .from('contacts')
    .select('id, full_name, email')
    .in('id', [...new Set(ids)]);

  for (const row of (data ?? []) as Row[]) {
    map.set(row.id, { fullName: row.full_name, email: row.email ?? null } as CrmContact);
  }
  return map;
}

export interface CrmTask {
  id: string;
  title: string;
  detail: string | null;
  contactId: string | null;
  leadId: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'cancelled';
  completedAt: string | null;
}

/**
 * The tasks somebody is actually going to do.
 *
 * Open first and soonest first, with undated tasks last — a due date is a
 * promise and an undated task is an intention, and mixing them puts the
 * intentions at the top where they push the promises off the screen.
 */
export async function listTasks(): Promise<Capped<CrmTask>> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('crm_tasks')
    .select('*')
    .order('status')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(overFetch(CRM_LIMITS.tasks));

  const page = capped((data ?? []) as Row[], CRM_LIMITS.tasks);

  return {
    ...page,
    rows: page.rows.map((row) => ({
      id: row.id,
      title: row.title,
      detail: row.detail ?? null,
      contactId: row.contact_id ?? null,
      leadId: row.lead_id ?? null,
      assignedTo: row.assigned_to ?? null,
      dueAt: row.due_at ?? null,
      status: row.status,
      completedAt: row.completed_at ?? null,
    })),
  };
}

export interface CrmNote {
  id: string;
  contactId: string | null;
  leadId: string | null;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

/**
 * Every note in the caller's world, grouped by what it is about.
 *
 * One query for the page rather than one per contact. A note somebody can write
 * and never read back is not a note, and per-card fetching is how "and never
 * read back" happens in practice — the second click is one most people do not
 * make.
 */
export async function listNotes(): Promise<Map<string, CrmNote[]>> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('crm_notes')
    .select('id, contact_id, lead_id, body, author_id, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  const rows = (data ?? []) as Row[];
  const names = await loadAuthorNames([
    ...new Set(rows.map((r) => r.author_id).filter(Boolean) as string[]),
  ]);

  const map = new Map<string, CrmNote[]>();

  for (const row of rows) {
    const key = (row.contact_id ?? row.lead_id) as string | null;
    if (!key) continue;

    const note: CrmNote = {
      id: row.id,
      contactId: row.contact_id ?? null,
      leadId: row.lead_id ?? null,
      body: row.body,
      authorId: row.author_id ?? null,
      authorName: row.author_id ? (names.get(row.author_id) ?? null) : null,
      createdAt: row.created_at,
    };

    map.set(key, [...(map.get(key) ?? []), note]);
  }

  return map;
}

async function loadAuthorNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', userIds);

  for (const row of (data ?? []) as Row[]) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}
