import { NextResponse } from 'next/server';
import { can } from '@ib/core';

import { recordDocumentAccess } from '@/features/documents/storage';
import { getActor } from '@/lib/auth/actor';
import {
  requireConfidentialAssurance,
  StepUpRequiredError,
  STEP_UP_ACTIONS,
} from '@/lib/auth/assurance';
import { isWatermarkable, watermarkPdf } from '@/lib/documents/watermark';
import { checkRateLimit } from '@/lib/rate-limit';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reading a document without ever receiving the file.
 *
 * ## Why the bytes come through here
 *
 * The download path hands the browser a signed URL, which is a bearer token for
 * the object: whoever holds it gets the original file. That is the right shape
 * for a download and the wrong one for view-only, because the moment the client
 * holds a URL to the raw object there is nothing left to enforce.
 *
 * So a view streams through the server. The object is fetched with the service
 * role — *after* this route has established the caller may read it — stamped
 * with their identity, and returned inline. No URL to the original ever reaches
 * the browser.
 *
 * ## Authorisation happens three times, deliberately
 *
 * 1. `document:download` as a capability check on the actor.
 * 2. A second factor, at the confidential tier.
 * 3. The row is read through the **caller's own client**, so Row Level Security
 *    decides whether this document exists for them at all. Only then does the
 *    service role touch storage.
 *
 * Step three is the one that matters: the privileged client is used solely to
 * fetch an object whose row the caller has already been shown by the database.
 * Reversing that order — fetching first and checking after — is how these
 * routes usually leak.
 *
 * ## What it does not do
 *
 * It cannot stop a screenshot, and it does not claim to. It removes the
 * accidents — the forwarded attachment, the file left in a downloads folder —
 * and the watermark makes the deliberate case attributable.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;

  const actor = await getActor();
  if (!actor) return refuse(401, 'Sign in to view this document.');

  if (!can(actor, 'document:download')) {
    return refuse(403, 'Your role does not include reading deal documents.');
  }

  /*
   * Rate limited per document. A client looping this route is either broken or
   * harvesting a data room page by page, and the second is exactly the pattern
   * the vault exists to make expensive.
   */
  const budget = await checkRateLimit('documentView', actor.userId, documentId);
  if (!budget.allowed) return refuse(429, 'Too many requests. Slow down.');

  try {
    await requireConfidentialAssurance(STEP_UP_ACTIONS.documentDownload);
  } catch (error) {
    if (error instanceof StepUpRequiredError) return refuse(403, error.message);
    throw error;
  }

  // The caller's own client: RLS answers whether this row exists for them.
  const supabase = await createClient();

  /*
   * The identity that goes on the page, read from the session rather than from
   * anything the request supplied. A watermark a caller can influence is a
   * watermark that names somebody else.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return refuse(401, 'Sign in to view this document.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  const { data: row, error } = await supabase
    .from('deal_documents')
    .select('storage_path, file_name, content_type, withdrawn_at')
    .eq('id', documentId)
    .maybeSingle();

  if (error || !row || row.withdrawn_at) {
    await recordDocumentAccess(documentId, 'denied');
    return refuse(404, 'That document is not available.');
  }

  const service = createServiceRoleClient();
  const { data: file, error: downloadError } = await service.storage
    .from('deal-documents')
    .download(row.storage_path as string);

  if (downloadError || !file) {
    return refuse(502, 'That document could not be read.');
  }

  const original = new Uint8Array(await file.arrayBuffer());
  const contentType = (row.content_type as string) ?? 'application/octet-stream';

  const bytes = isWatermarkable(contentType)
    ? await watermarkPdf(original, {
        name: (profile?.full_name as string | null) ?? null,
        email: user.email ?? user.id,
        at: new Date(),
      })
    : original;

  await recordDocumentAccess(documentId, 'view');

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': contentType,
      /*
       * `inline` renders it; a filename is still supplied because a browser
       * that ignores the disposition should at least name the file sensibly.
       * This is not what blocks saving — nothing in a header can — the block is
       * that this response is the only copy the client is ever given, and the
       * download route refuses unless the uploader released it.
       */
      'content-disposition': `inline; filename="${sanitise(row.file_name as string)}"`,
      'content-length': String(bytes.byteLength),
      // Never cached anywhere. A confidential document sitting in a shared
      // proxy cache is a disclosure with no record of who read it.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      'x-content-type-options': 'nosniff',
      // This response is framed by our own viewer and nothing else.
      'content-security-policy': "default-src 'none'; frame-ancestors 'self'; sandbox",
      'referrer-policy': 'no-referrer',
    },
  });
}

/** One shape for every refusal, so a caller learns nothing from the difference. */
function refuse(status: number, message: string): Response {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * A filename safe to put in a header.
 *
 * A quote or a newline here is header injection, and the name came from an
 * uploader. `safeFileName` in `@ib/core` already constrains what can be stored;
 * this is the second check at the point the value leaves the system.
 */
function sanitise(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
}
