'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { LEGAL_DOCUMENT_KINDS, reviewDocument, type LegalDocumentKind } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';

/**
 * Saving a revision.
 *
 * The current text lives on the draft; every text it has ever had lives in
 * `legal_document_versions`. Both are written here, in that order, so a failure
 * between them leaves a version recorded that the draft has not yet adopted —
 * which is recoverable and legible. The reverse would silently lose a revision.
 *
 * The version number is not sent. The trigger assigns it, because two people
 * revising the same draft in the same minute would otherwise both claim v4 and
 * one of them would get a constraint violation they cannot act on.
 */

export interface RevisionState {
  error: string | null;
  message?: string | null;
}

export const emptyRevisionState: RevisionState = { error: null, message: null };

const reviseSchema = z.object({
  draftId: z.string().uuid('Not a valid document.'),
  body: z
    .string()
    .min(1, 'The document cannot be empty.')
    .max(200_000, 'That document is too long to store.'),
  note: z.string().trim().max(1000).optional(),
});

export async function saveRevision(
  _prev: RevisionState,
  formData: FormData,
): Promise<RevisionState> {
  const parsed = reviseSchema.safeParse({
    draftId: formData.get('draftId'),
    body: formData.get('body'),
    note: formData.get('note') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the document.', message: null };
  }

  const supabase = await createClient();

  // Read the kind so the review runs against the right checklist, and so a
  // draft the caller cannot see yields nothing rather than a confusing error.
  const { data: draft } = await supabase
    .from('legal_document_drafts')
    .select('id, kind, body')
    .eq('id', parsed.data.draftId)
    .maybeSingle();

  if (!draft) return { error: 'That document is not available.', message: null };

  const kind = (draft as { kind: LegalDocumentKind }).kind;
  if (!LEGAL_DOCUMENT_KINDS.includes(kind)) {
    return { error: 'That document has an unrecognised type.', message: null };
  }

  if ((draft as { body: string }).body === parsed.data.body) {
    return { error: null, message: 'No changes to save.' };
  }

  // Re-reviewed against this version. A review run against version three says
  // nothing about version four, and storing the findings beside the version
  // they describe is what stops somebody reading a stale one.
  const review = reviewDocument(kind, parsed.data.body);

  const { error: versionError } = await supabase.from('legal_document_versions').insert({
    draft_id: parsed.data.draftId,
    body: parsed.data.body,
    note: parsed.data.note ?? null,
    review_findings: review.findings,
  });

  if (versionError) {
    return { error: 'Could not save that revision.', message: null };
  }

  const { error: draftError } = await supabase
    .from('legal_document_drafts')
    .update({
      body: parsed.data.body,
      review_findings: review.findings,
      unresolved_placeholders: review.unresolvedPlaceholders,
    })
    .eq('id', parsed.data.draftId);

  if (draftError) {
    // The version is on record. Saying so is more useful than a bare failure,
    // because nothing was lost and retrying is safe.
    return {
      error: 'The revision was recorded but the document did not update. Try again.',
      message: null,
    };
  }

  await recordAuditEvent({
    action: 'legal_document.revised',
    entityType: 'legal_document_draft',
    entityId: parsed.data.draftId,
    // No body, no excerpt. The audit log is broadly readable by admins and is
    // exported; contract text does not belong in it.
    metadata: { kind, findingCount: review.findings.length },
  });

  revalidatePath('/tools/legal-documents');
  return { error: null, message: 'Revision saved.' };
}
