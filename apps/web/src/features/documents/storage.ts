import 'server-only';

import { headers } from 'next/headers';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The vault's storage layer.
 *
 * Same shape as message attachments, and separate for the same reason the
 * bucket is separate: the two have different access rules, and a shared module
 * would end up with a parameter that decides which rule applies — which is the
 * kind of parameter somebody eventually passes wrong.
 *
 * The design rests on the object key:
 *
 *     <deal_id>/<document_id>/<file_name>
 *
 * The storage policy reads the **second** segment and checks it against
 * `deal_documents`, so per-document releases reach the object and not only the
 * row. `safeFileName` in `@ib/core` is what keeps that segment where it is —
 * a name containing a slash would move the boundary.
 */

export const DOCUMENTS_BUCKET = 'deal-documents';

/**
 * A signed URL is a bearer token for one file: whoever holds it reads the
 * object, with no further check. Sixty seconds is enough to start a download
 * and short enough that a URL in browser history, a forwarded email, or a
 * screenshot is worthless by the time anybody tries it — including after the
 * holder has been removed from the room.
 */
const DOWNLOAD_TTL_SECONDS = 60;
const UPLOAD_TTL_SECONDS = 300;

export async function createDocumentUploadUrl(
  path: string,
): Promise<{ url: string; token: string } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) return null;
  return { url: data.signedUrl, token: data.token };
}

/**
 * A short-lived read URL, and the log entry that goes with it.
 *
 * The two are deliberately one function. A download route that mints the URL
 * and forgets the log entry produces a vault whose access history has holes in
 * exactly the cases somebody will later care about, and there is no way to
 * reconstruct it afterwards.
 *
 * The URL is signed **as the caller**, so the storage policy applies: somebody
 * who was never released this document cannot obtain a URL for it even knowing
 * its exact path. The log is written with the service role, because
 * `authenticated` has no INSERT grant on it and must not have one.
 */
export async function createDocumentDownloadUrl(
  documentId: string,
  path: string,
): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  const issued = !error && Boolean(data?.signedUrl);

  // Refusals are logged too, and they are the interesting rows: a run of
  // `denied` against one document is somebody probing.
  await recordDocumentAccess(documentId, issued ? 'download' : 'denied');

  return issued ? data!.signedUrl : null;
}

/**
 * Records that a URL was issued.
 *
 * Worth being precise about the claim: this says a signed URL was handed to
 * this person for this document at this time. Whether the bytes arrived, and
 * whether they were then forwarded, is outside what any server can observe —
 * and the vault UI says so rather than implying a chain of custody it does not
 * have.
 */
export async function recordDocumentAccess(
  documentId: string,
  action: 'download' | 'view' | 'denied',
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for');

  const service = createServiceRoleClient();

  const { error } = await service.from('document_access_log').insert({
    document_id: documentId,
    actor_id: user?.id ?? null,
    action,
    // Attacker-influenced on a self-hosted deployment, so this is recorded as a
    // hint and never trusted as an access-control input.
    ip_address: forwardedFor?.split(',')[0]?.trim() || null,
    user_agent: requestHeaders.get('user-agent'),
  });

  if (error) {
    // Not rethrown, for the same reason `recordAuditEvent` does not: losing the
    // entry is bad, and failing somebody's download because the log was briefly
    // unavailable is worse — it trains people to retry until it works.
    //
    // This is the line to wire to alerting. A gap here is exactly what a
    // dispute over "who saw the customer list" will need and not find.
    console.error('[vault] failed to record document access', {
      documentId,
      action,
      error: error.message,
    });
  }
}

export const DOCUMENT_TTL = {
  download: DOWNLOAD_TTL_SECONDS,
  upload: UPLOAD_TTL_SECONDS,
} as const;
