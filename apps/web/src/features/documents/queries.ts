import 'server-only';

import {
  capped,
  overFetch,
  type Capped,
  type DocumentCategory,
  type DocumentVisibility,
} from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Reads for the vault.
 *
 * Through the user's client, so RLS decides. That is not a formality here — the
 * whole product question this feature answers is "which of the two bidders in
 * this room may open this file", and the answer lives in
 * `app.can_read_document()`. A query that filtered in TypeScript would be a
 * second, drifting copy of it.
 *
 * The consequence: a buyer calling `listDocuments` gets the documents released
 * to them, and the ones released to the other bidder simply are not in the
 * result. There is no "hidden" flag to leak a count from.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface VaultDocument {
  id: string;
  dealId: string;
  uploadedBy: string | null;
  uploaderName: string | null;
  firmId: string | null;
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  replacesDocumentId: string | null;
  supersededAt: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  createdAt: string;
  /** Filled in for documents the caller controls; empty otherwise. */
  releasedTo: DocumentRelease[];
  /**
   * Who has opened it, for documents the caller controls.
   *
   * On the row rather than fetched per card, because the panel promises the
   * uploader can see this and a promise behind a second click is one most
   * people never collect on.
   */
  openedBy: AccessEntry[];
  /**
   * Whether `openedBy` is the whole story for this document.
   *
   * False when the access log came back capped. It matters because the panel's
   * empty state says "nobody has opened it yet" — and on a truncated log that
   * is a false negative on a confidentiality question. A seller reading it
   * concludes the buyer never looked at the financials.
   */
  accessLogComplete: boolean;
}

export interface DocumentRelease {
  granteeId: string;
  granteeName: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

/**
 * How many documents a data room shows before it says there are more.
 *
 * The one list in this product where a silent truncation is genuinely
 * dangerous: a buyer who cannot see a document does not know to ask for it, and
 * "it was in the data room" is a sentence that gets said in a dispute.
 */
export const VAULT_PAGE_SIZE = 500;

export async function listDocuments(dealId: string): Promise<Capped<VaultDocument>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('deal_documents')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .limit(overFetch(VAULT_PAGE_SIZE));

  if (error || !data) return capped<VaultDocument>([], VAULT_PAGE_SIZE);

  const page = capped(data as Row[], VAULT_PAGE_SIZE);
  const rows = page.rows;
  const uploaderIds = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))];

  // Names, not ids. A vault that says "uploaded by 8f3c…" is a vault nobody can
  // audit, and the people in a deal room are not confidential to each other —
  // the business is. Same distinction migration 0018 exists to make.
  const names = await loadNames(uploaderIds as string[]);
  const ids = rows.map((r) => r.id as string);
  const [releases, access] = await Promise.all([loadReleases(ids), loadAccessEntries(ids)]);

  return {
    ...page,
    rows: rows.map((row) => ({
      id: row.id,
      dealId: row.deal_id,
      uploadedBy: row.uploaded_by ?? null,
      uploaderName: row.uploaded_by ? (names.get(row.uploaded_by) ?? null) : null,
      firmId: row.firm_id ?? null,
      title: row.title,
      category: row.category,
      visibility: row.visibility,
      storagePath: row.storage_path,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      replacesDocumentId: row.replaces_document_id ?? null,
      supersededAt: row.superseded_at ?? null,
      withdrawnAt: row.withdrawn_at ?? null,
      withdrawnReason: row.withdrawn_reason ?? null,
      createdAt: row.created_at,
      releasedTo: releases.get(row.id as string) ?? [],
      openedBy: access.rows.get(row.id as string) ?? [],
      accessLogComplete: access.complete,
    })),
  };
}

/**
 * Who a document has been released to.
 *
 * The policy admits the controller to every grant on their document and a
 * grantee to their own, so a buyer calling this gets one row rather than an
 * error — and one bidder never learns what the other was shown. The page that
 * uses it is uploader-facing, but the query does not need to be, because the
 * database already decided.
 */
const GRANTS_LIMIT = 5000;

async function loadReleases(documentIds: string[]): Promise<Map<string, DocumentRelease[]>> {
  const map = new Map<string, DocumentRelease[]>();
  if (documentIds.length === 0) return map;

  const supabase = await createClient();

  /*
   * An explicit bound, because there was none — and "no limit" is not the same
   * as "everything". PostgREST applies its own `max-rows` ceiling (1000 on
   * Supabase by default), so an unbounded query was already being capped,
   * silently, by a number nothing in this repository mentions.
   *
   * A grant list is the record of who was shown a document. An incomplete one
   * is not a display problem, so this asks for a bound it will not hit and
   * shouts if it ever does, rather than quietly dropping rows.
   */
  const { data } = await supabase
    .from('document_grants')
    .select('document_id, grantee_id, granted_at, revoked_at')
    .in('document_id', documentIds)
    .limit(overFetch(GRANTS_LIMIT));

  if (!data) return map;

  const page = capped(data as Row[], GRANTS_LIMIT);

  if (page.truncated) {
    // Deliberately loud and deliberately not swallowed into the UI. If this
    // ever fires, the release lists on that page are wrong and the fix is a
    // per-document query, not a bigger constant.
    console.error('[vault] grant list hit its ceiling; release lists on this page are incomplete', {
      documents: documentIds.length,
      limit: GRANTS_LIMIT,
    });
  }

  const rows = page.rows;
  const names = await loadNames([...new Set(rows.map((r) => r.grantee_id as string))]);

  for (const row of rows) {
    const list = map.get(row.document_id) ?? [];
    list.push({
      granteeId: row.grantee_id,
      granteeName: names.get(row.grantee_id) ?? null,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at ?? null,
    });
    map.set(row.document_id, list);
  }

  return map;
}

/**
 * Who opened each document, grouped.
 *
 * One query for the page rather than one per card. The policy admits the
 * document's controller to every entry and a reader to their own, so a buyer
 * calling this gets their own reads back — which is the correct answer, not a
 * leak: you are entitled to see what the platform logged about you.
 */
const ACCESS_LOG_LIMIT = 500;

interface AccessEntries {
  rows: Map<string, AccessEntry[]>;
  /** False when the log was capped, so an empty list means "not in the window". */
  complete: boolean;
}

async function loadAccessEntries(documentIds: string[]): Promise<AccessEntries> {
  const map = new Map<string, AccessEntry[]>();
  if (documentIds.length === 0) return { rows: map, complete: true };

  const supabase = await createClient();

  const { data } = await supabase
    .from('document_access_log')
    .select('id, document_id, actor_id, action, created_at')
    .in('document_id', documentIds)
    .order('created_at', { ascending: false })
    .limit(overFetch(ACCESS_LOG_LIMIT));

  if (!data) return { rows: map, complete: true };

  // Newest-first across *every* document in the room, so the cap does not fall
  // evenly: a document whose reads are all older than the newest 500 events
  // gets none of them. Hence the flag — the card must not claim nobody opened
  // it when the answer is "not in this window".
  const page = capped(data as Row[], ACCESS_LOG_LIMIT);
  const rows = page.rows;
  const names = await loadNames([
    ...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[]),
  ]);

  for (const row of rows) {
    const list = map.get(row.document_id) ?? [];
    list.push({
      id: String(row.id),
      actorId: row.actor_id ?? null,
      actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      action: row.action,
      createdAt: row.created_at,
    });
    map.set(row.document_id, list);
  }

  return { rows: map, complete: !page.truncated };
}

async function loadNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', userIds);

  for (const row of (data ?? []) as Row[]) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}

export interface AccessEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: 'download' | 'view' | 'denied';
  createdAt: string;
}

export interface RoomMember {
  userId: string;
  name: string | null;
  role: string;
}

/**
 * Who is in the room, so a release names people rather than asking for a uuid.
 *
 * A permission model somebody has to paste identifiers into is a permission
 * model they will get wrong, and getting it wrong here means a tax return going
 * to the wrong bidder.
 */
export async function listRoomMembers(dealId: string): Promise<RoomMember[]> {
  const supabase = await createClient();

  const { data: conversations } = await supabase
    .from('deal_conversations')
    .select('id')
    .eq('deal_id', dealId);

  const ids = ((conversations ?? []) as Row[]).map((c) => c.id as string);
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from('conversation_members')
    .select('user_id, role')
    .in('conversation_id', ids)
    .is('removed_at', null);

  const rows = (data ?? []) as Row[];
  const unique = new Map<string, string>();
  for (const row of rows) if (!unique.has(row.user_id)) unique.set(row.user_id, row.role);

  const names = await loadNames([...unique.keys()]);

  return [...unique.entries()].map(([userId, role]) => ({
    userId,
    name: names.get(userId) ?? null,
    role,
  }));
}
