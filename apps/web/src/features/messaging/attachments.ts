import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Attachments.
 *
 * The bucket is private (`public = false` in 0012), so no object in it has a
 * permanent URL. Every read is a signed URL minted here, after the membership
 * check, and it expires.
 *
 * The design rests on the object key:
 *
 *     <conversation_id>/<message_id>/<file_name>
 *
 * The storage policies read the conversation id from the first path segment,
 * which is what puts an attachment behind the same membership rule as the
 * messages it belongs to. That is also why `file_name` is validated to contain
 * no slashes — a name like `../other-conversation/x.pdf` would move the segment
 * boundary and, with it, which conversation the object claims to belong to.
 */

export const ATTACHMENTS_BUCKET = 'deal-attachments';

/**
 * Short by design. A signed URL is a bearer token for one file: anyone holding
 * it can read the object, with no further check. Long-lived ones end up in
 * browser history, chat logs, and forwarded email, outliving the access they
 * were issued against — including after the recipient has been removed from
 * the deal room.
 */
const DOWNLOAD_TTL_SECONDS = 60;
const UPLOAD_TTL_SECONDS = 120;

export function attachmentKey(conversationId: string, messageId: string, fileName: string): string {
  return `${conversationId}/${messageId}/${fileName}`;
}

/**
 * A one-shot upload URL.
 *
 * The client uploads straight to storage rather than streaming the file through
 * a route handler, which keeps large documents off the serverless function's
 * memory and its execution budget. The storage policy re-checks membership on
 * insert, so the URL alone does not authorise the write.
 */
export async function createUploadUrl(
  conversationId: string,
  messageId: string,
  fileName: string,
): Promise<{ url: string; path: string; token: string } | null> {
  const supabase = await createClient();
  const path = attachmentKey(conversationId, messageId, fileName);

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) return null;
  return { url: data.signedUrl, path: data.path, token: data.token };
}

export async function createDownloadUrl(path: string): Promise<string | null> {
  const supabase = await createClient();

  // Signed as the caller, so the storage policy applies: a member of another
  // deal room cannot obtain a URL for this object even knowing its exact path.
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) return null;
  return data.signedUrl;
}

export const ATTACHMENT_TTL = {
  download: DOWNLOAD_TTL_SECONDS,
  upload: UPLOAD_TTL_SECONDS,
} as const;
