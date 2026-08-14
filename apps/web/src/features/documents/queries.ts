import 'server-only';

import type { DocumentCategory, DocumentVisibility } from '@ib/core';

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
}

export interface DocumentRelease {
  granteeId: string;
  granteeName: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export async function listDocuments(dealId: string): Promise<VaultDocument[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('deal_documents')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !data) return [];

  const rows = data as Row[];
  const uploaderIds = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))];

  // Names, not ids. A vault that says "uploaded by 8f3c…" is a vault nobody can
  // audit, and the people in a deal room are not confidential to each other —
  // the business is. Same distinction migration 0018 exists to make.
  const names = await loadNames(uploaderIds as string[]);
  const ids = rows.map((r) => r.id as string);
  const [releases, access] = await Promise.all([loadReleases(ids), loadAccessEntries(ids)]);

  return rows.map((row) => ({
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
    openedBy: access.get(row.id as string) ?? [],
  }));
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
async function loadReleases(documentIds: string[]): Promise<Map<string, DocumentRelease[]>> {
  const map = new Map<string, DocumentRelease[]>();
  if (documentIds.length === 0) return map;

  const supabase = await createClient();

  const { data } = await supabase
    .from('document_grants')
    .select('document_id, grantee_id, granted_at, revoked_at')
    .in('document_id', documentIds);

  if (!data) return map;

  const rows = data as Row[];
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
async function loadAccessEntries(documentIds: string[]): Promise<Map<string, AccessEntry[]>> {
  const map = new Map<string, AccessEntry[]>();
  if (documentIds.length === 0) return map;

  const supabase = await createClient();

  const { data } = await supabase
    .from('document_access_log')
    .select('id, document_id, actor_id, action, created_at')
    .in('document_id', documentIds)
    .order('created_at', { ascending: false })
    .limit(500);

  if (!data) return map;

  const rows = data as Row[];
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

  return map;
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
