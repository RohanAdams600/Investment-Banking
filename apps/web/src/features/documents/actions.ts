'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  DocumentRejected,
  assertAcceptable,
  can,
  documentKey,
} from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { notify, notifyCollapsed } from '@/lib/notify/notify';
import { getActor } from '@/lib/auth/actor';
import {
  STEP_UP_ACTIONS,
  StepUpRequiredError,
  requireConfidentialAssurance,
} from '@/lib/auth/assurance';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

import { createDocumentDownloadUrl, createDocumentUploadUrl } from './storage';

/**
 * Writes for the vault.
 *
 * Capability first, then RLS. `document:upload` and `document:set_permissions`
 * have been in the catalog since step 2 with nothing enforcing them, and this
 * is where they start meaning something — but the check here is the courteous
 * half, not the load-bearing one. It gives somebody a sentence instead of a
 * silent no-op; the policy is what actually refuses.
 */

export interface VaultState {
  error: string | null;
  message?: string | null;
  /** Set on a successful upload start, so the client knows where to PUT. */
  upload?: { url: string; token: string; path: string; documentId: string } | null;
}

export const emptyVaultState: VaultState = { error: null, message: null, upload: null };

function fail(error: string): VaultState {
  return { error, message: null, upload: null };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

const uploadSchema = z.object({
  dealId: z.string().uuid('Not a valid deal.'),
  firmId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((value) => value || null),
  title: z.string().trim().min(1, 'Give it a title.').max(300),
  category: z.enum(DOCUMENT_CATEGORIES),
  visibility: z.enum(DOCUMENT_VISIBILITIES),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.coerce.number().int().nonnegative(),
  replacesDocumentId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((value) => value || null),
});

/**
 * Reserves a document and hands back a one-shot upload URL.
 *
 * Row first, object second. The id has to exist before the key can be built —
 * the key is `<deal>/<document>/<file>` and the middle segment is what the
 * storage policy checks — and the ordering is the safe one either way: a row
 * with no object is a broken entry the owner can see and delete, whereas an
 * object with no row would be a file in a bucket that no policy describes.
 *
 * The client uploads straight to storage rather than streaming through this
 * function, which keeps a 100 MB diligence pack off the serverless memory and
 * execution budget. The storage policy re-checks on insert, so the URL alone
 * does not authorise the write.
 */
export async function startDocumentUpload(
  _prev: VaultState,
  formData: FormData,
): Promise<VaultState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  if (!can(actor, 'document:upload')) {
    return fail('Your role does not include uploading documents to a deal room.');
  }

  const parsed = uploadSchema.safeParse({
    dealId: formData.get('dealId'),
    firmId: formData.get('firmId'),
    title: formData.get('title'),
    category: formData.get('category'),
    visibility: formData.get('visibility'),
    fileName: formData.get('fileName'),
    contentType: formData.get('contentType'),
    sizeBytes: formData.get('sizeBytes'),
    replacesDocumentId: formData.get('replacesDocumentId'),
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const input = parsed.data;

  try {
    // Re-checked here rather than trusted from the browser. The bucket enforces
    // both limits too; this is so the answer arrives before the upload starts
    // instead of after 90 MB has moved.
    assertAcceptable({ type: input.contentType, size: input.sizeBytes, name: input.fileName });
  } catch (thrown) {
    return fail(
      thrown instanceof DocumentRejected ? thrown.message : 'That file was not accepted.',
    );
  }

  const documentId = randomUUID();
  const path = documentKey(input.dealId, documentId, input.fileName);

  const supabase = await createClient();

  const { error } = await supabase.from('deal_documents').insert({
    id: documentId,
    deal_id: input.dealId,
    uploaded_by: actor.userId,
    firm_id: input.firmId,
    title: input.title,
    category: input.category,
    visibility: input.visibility,
    storage_path: path,
    file_name: input.fileName,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    replaces_document_id: input.replacesDocumentId,
  });

  if (error) {
    return fail(
      error.code === '42501'
        ? 'You are not a member of that deal room.'
        : 'Could not start that upload.',
    );
  }

  const upload = await createDocumentUploadUrl(path);
  if (!upload) {
    // The row exists and the object never will. Left in place rather than
    // cleaned up silently: the owner sees a document with no file and can
    // withdraw it, which is a state somebody can act on.
    return fail('Could not open an upload slot. The entry is there; try uploading again.');
  }

  if (input.replacesDocumentId) {
    await supabase
      .from('deal_documents')
      .update({ superseded_at: new Date().toISOString() })
      .eq('id', input.replacesDocumentId);
  }

  await recordAuditEvent({
    action: 'document.uploaded',
    entityType: 'deal_document',
    entityId: documentId,
    firmId: input.firmId,
    // Never the title. Audit entries are broadly readable by admins and get
    // exported, and "Q3 layoffs memo" is not metadata.
    metadata: { category: input.category, visibility: input.visibility },
  });

  revalidatePath(`/deals/${input.dealId}/documents`);
  return {
    error: null,
    message: 'Reserved. Uploading…',
    upload: { url: upload.url, token: upload.token, path, documentId },
  };
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

const releaseSchema = z.object({
  documentId: z.string().uuid('Not a valid document.'),
  granteeId: z.string().uuid('Choose somebody in the room.'),
  dealId: z.string().uuid(),
});

/** Releases a document to one named person. */
export async function releaseDocument(_prev: VaultState, formData: FormData): Promise<VaultState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  if (!can(actor, 'document:set_permissions')) {
    return fail('Your role does not include releasing documents.');
  }

  const parsed = releaseSchema.safeParse({
    documentId: formData.get('documentId'),
    granteeId: formData.get('granteeId'),
    dealId: formData.get('dealId'),
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const supabase = await createClient();

  // Upsert rather than insert: a re-release after a revocation is the same row,
  // and the trigger re-stamps it. Two rows for one person would make "is this
  // live" a question with two answers.
  const { error } = await supabase.from('document_grants').upsert(
    {
      document_id: parsed.data.documentId,
      grantee_id: parsed.data.granteeId,
      revoked_at: null,
    },
    { onConflict: 'document_id,grantee_id' },
  );

  if (error) {
    return fail(
      error.code === '42501'
        ? 'Only the side that uploaded a document can release it.'
        : 'Could not record that release.',
    );
  }

  await recordAuditEvent({
    action: 'document.released',
    entityType: 'deal_document',
    entityId: parsed.data.documentId,
    metadata: { granteeId: parsed.data.granteeId },
  });

  // A released document nobody is told about is a released document nobody
  // reads. The notification names neither the file nor the deal — it points at
  // the room, where both are already gated.
  await notify({
    recipientId: parsed.data.granteeId,
    kind: 'document_released',
    entityId: parsed.data.dealId,
    entityType: 'deal',
  });

  revalidatePath(`/deals/${parsed.data.dealId}/documents`);
  return { error: null, message: 'Released.', upload: null };
}

/** Withdraws one person's access. The grant stays on record. */
export async function revokeDocumentAccess(
  _prev: VaultState,
  formData: FormData,
): Promise<VaultState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  if (!can(actor, 'document:set_permissions')) {
    return fail('Your role does not include changing document access.');
  }

  const parsed = releaseSchema.safeParse({
    documentId: formData.get('documentId'),
    granteeId: formData.get('granteeId'),
    dealId: formData.get('dealId'),
  });

  if (!parsed.success) return fail('Not a valid release.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('document_grants')
    .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
    .eq('document_id', parsed.data.documentId)
    .eq('grantee_id', parsed.data.granteeId);

  if (error) return fail('Could not withdraw that access.');
  if (count === 0) return fail('That release is no longer there.');

  await recordAuditEvent({
    action: 'document.access_revoked',
    entityType: 'deal_document',
    entityId: parsed.data.documentId,
    metadata: { granteeId: parsed.data.granteeId },
  });

  revalidatePath(`/deals/${parsed.data.dealId}/documents`);
  return {
    error: null,
    // Said plainly, because the alternative is somebody believing a document
    // they already shared has been un-shared.
    message: 'Access withdrawn. Anything already downloaded stays downloaded.',
    upload: null,
  };
}

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

const withdrawSchema = z.object({
  documentId: z.string().uuid('Not a valid document.'),
  dealId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

/** Pulls a document from the room. One-way. */
export async function withdrawDocument(_prev: VaultState, formData: FormData): Promise<VaultState> {
  const actor = await getActor();
  if (!actor) return fail('Sign in first.');

  const parsed = withdrawSchema.safeParse({
    documentId: formData.get('documentId'),
    dealId: formData.get('dealId'),
    reason: formData.get('reason') ?? undefined,
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const supabase = await createClient();

  const { error, count } = await supabase
    .from('deal_documents')
    .update(
      {
        // The trigger stamps the real time; this only says "withdraw it".
        withdrawn_at: new Date().toISOString(),
        withdrawn_reason: parsed.data.reason || null,
      },
      { count: 'exact' },
    )
    .eq('id', parsed.data.documentId);

  if (error) {
    return fail(
      error.code === '42501'
        ? 'A withdrawn document cannot be restored, and only your side can withdraw one.'
        : 'Could not withdraw that document.',
    );
  }

  if (count === 0) return fail('That document is not yours to withdraw.');

  await recordAuditEvent({
    action: 'document.withdrawn',
    entityType: 'deal_document',
    entityId: parsed.data.documentId,
  });

  revalidatePath(`/deals/${parsed.data.dealId}/documents`);
  return { error: null, message: 'Withdrawn.', upload: null };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Hands back a sixty-second URL, and records that it did.
 *
 * `document:download` is checked here and the storage policy is checked by
 * Postgres; the URL is signed as the caller, so somebody who was never released
 * the document cannot obtain one even knowing the exact path.
 */
export async function requestDocumentUrl(
  documentId: string,
): Promise<{ url: string | null; error: string | null; needsStepUp?: boolean }> {
  const actor = await getActor();
  if (!actor) return { url: null, error: 'Sign in first.' };

  if (!can(actor, 'document:download')) {
    return { url: null, error: 'Your role does not include downloading deal documents.' };
  }

  /*
   * A confidential document is exactly the case step-up was written for: the
   * threat is a stolen session, not a stolen password, and a password check
   * happened hours ago.
   *
   * Now enforced at the confidential tier. This used to let an account with no
   * second factor through and record the gap, reasoning that blocking would put
   * a wall in front of somebody closing a deal — and noting that the gap count
   * was the argument for requiring MFA on the roles that touch a data room.
   * That argument has been accepted: an account with nothing to step up to is
   * sent to enrol rather than handed the file.
   */
  try {
    await requireConfidentialAssurance(STEP_UP_ACTIONS.documentDownload);
  } catch (thrown) {
    if (thrown instanceof StepUpRequiredError) {
      return { url: null, error: thrown.message, needsStepUp: true };
    }
    throw thrown;
  }

  const supabase = await createClient();

  const { data } = await supabase
    .from('deal_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle();

  if (!data) return { url: null, error: 'That document is not available to you.' };

  const url = await createDocumentDownloadUrl(
    documentId,
    (data as { storage_path: string }).storage_path,
  );

  if (!url) return { url: null, error: 'That document could not be opened.' };

  // Tell the side that released it. This is the half of the access log the
  // uploader would otherwise have to go looking for, and "who has opened my
  // financials" is a question sellers ask on the day, not on a page they
  // remember to visit. Collapsed, because a reviewer opens the same file four
  // times in an afternoon.
  await notifyDocumentOwner(documentId, actor.userId);

  /*
   * There used to be an audit branch here for a download that happened without
   * a second factor. It is gone because it can no longer happen: the guard
   * above refuses that session rather than serving it. The event existed to
   * count how often it occurred, as evidence for whether to require MFA on
   * these roles — and that decision has been made, so the counter has done its
   * job and a branch that can never run is worse than no branch.
   */
  return { url, error: null };
}

/**
 * Tell whoever put the document there that it was opened.
 *
 * Service role for one reason: the reader cannot see `uploaded_by`. 0023 gives
 * a grantee the document row, not the other side's identity, and it should stay
 * that way — so the id is fetched here, used to address a notification, and
 * never returned to the caller.
 *
 * Silent when the opener is the uploader, which is most opens.
 */
async function notifyDocumentOwner(documentId: string, readerId: string): Promise<void> {
  try {
    const service = createServiceRoleClient();

    const { data } = await service
      .from('deal_documents')
      .select('uploaded_by, deal_id')
      .eq('id', documentId)
      .maybeSingle();

    const row = data as { uploaded_by?: string | null; deal_id?: string } | null;
    const owner = row?.uploaded_by ?? null;

    if (!owner || !row?.deal_id || owner === readerId) return;

    await notifyCollapsed([owner], {
      kind: 'document_opened',
      entityId: row.deal_id,
      entityType: 'deal',
    });
  } catch (error) {
    console.error('[vault] could not notify the uploader', error);
  }
}
