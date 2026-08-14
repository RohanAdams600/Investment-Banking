/**
 * The document vault's rules, in the layer that has no database.
 *
 * The authoritative check is RLS — `app.can_read_document()` in migration 0023
 * is what actually decides, and it decides for a raw SQL query written during
 * an incident just as much as for a route handler. What lives here is the same
 * rule expressed where the UI can ask it: which button to show, what to warn
 * about before a release, whether a file is even accepted.
 *
 * The duplication is the point, as it is for `LISTING_TRANSITIONS`. A UI that
 * offers an action the database will refuse is a UI that produces errors nobody
 * can act on.
 */

export const DOCUMENT_VISIBILITIES = ['private', 'restricted', 'deal'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const DOCUMENT_CATEGORIES = [
  'financial_statement',
  'tax_return',
  'legal',
  'contract',
  'lease',
  'operational',
  'insurance',
  'employee',
  'customer',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  financial_statement: 'Financial statements',
  tax_return: 'Tax returns',
  legal: 'Legal',
  contract: 'Contracts',
  lease: 'Leases and property',
  operational: 'Operations',
  insurance: 'Insurance',
  employee: 'People',
  customer: 'Customers',
  other: 'Other',
};

/**
 * What each level means, written for the person choosing it.
 *
 * "Restricted" is meaningless as a word on a radio button. "Only the people you
 * name" is a sentence somebody can act on, and getting this wrong is how a tax
 * return reaches the wrong bidder.
 */
export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  private: 'Only my side',
  restricted: 'Only the people I name',
  deal: 'Everyone in this deal room',
};

export const DOCUMENT_VISIBILITY_HINTS: Record<DocumentVisibility, string> = {
  private: 'Staging. Nobody on the other side can see it, or see that it exists.',
  restricted: 'Nothing is shared until you name somebody. Access can be withdrawn later.',
  deal: 'Every current and future member of this room, without further approval.',
};

/**
 * Categories where opening a document to the whole room is worth a second look.
 *
 * Not a restriction — a seller may share anything they like with anybody in
 * their room — but somebody uploading twenty files at the end of a long day
 * should have to think about the tax returns and not about the marketing deck.
 */
export const SENSITIVE_CATEGORIES: readonly DocumentCategory[] = [
  'tax_return',
  'financial_statement',
  'employee',
  'customer',
];

/**
 * Whether choosing this visibility for this category deserves a second look.
 *
 * Returns a sentence or null, and never blocks. The seller owns the decision;
 * this is the part that makes sure they made it on purpose.
 */
export function visibilityWarning(
  category: DocumentCategory,
  visibility: DocumentVisibility,
): string | null {
  if (visibility !== 'deal') return null;
  if (!SENSITIVE_CATEGORIES.includes(category)) return null;

  const noun = DOCUMENT_CATEGORY_LABELS[category].toLowerCase();
  return `Everyone in the room will be able to open this, including anybody added later. ${
    noun.charAt(0).toUpperCase() + noun.slice(1)
  } are usually released to one buyer at a time.`;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Mirrors the bucket's `allowed_mime_types` in 0023. */
export const ALLOWED_DOCUMENT_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export class DocumentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRejected';
  }
}

/**
 * A file name that is safe to put in an object key.
 *
 * The key is `<deal_id>/<document_id>/<file_name>` and the storage policy reads
 * the **second** segment. A name containing a slash moves the segment boundary,
 * so `../../other-deal/x.pdf` would produce a key whose second segment names a
 * document the uploader has nothing to do with — and the policy would check
 * that one. Same defect the messaging attachments guard against, and it is
 * worth stating twice because the consequence here is a diligence file landing
 * against another deal's permissions.
 *
 * Null bytes and control characters are stripped for the same reason: what the
 * database stores and what the storage backend parses must be the same string.
 */
export function safeFileName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new DocumentRejected('That file has no name.');

  // Forward and back slashes first, then control characters and the null
  // byte — what the database stores and what the storage backend parses have
  // to be the same string.
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[/\\]/g, '_').replace(/[\x00-\x1f\x7f]/g, '');

  // A name that is only dots resolves to a path segment with no content, and
  // `..` is the whole traversal problem in two characters.
  if (/^\.+$/.test(cleaned) || cleaned === '') {
    throw new DocumentRejected('That file name cannot be used.');
  }

  return cleaned.slice(0, 255);
}

export function documentKey(dealId: string, documentId: string, fileName: string): string {
  return `${dealId}/${documentId}/${safeFileName(fileName)}`;
}

/** Rejects before an upload starts, so nobody watches a 90MB file fail at the end. */
export function assertAcceptable(file: { type: string; size: number; name: string }): void {
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    throw new DocumentRejected(
      'That file type is not accepted. PDFs, images, spreadsheets and Word documents are.',
    );
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentRejected('That file is over 100 MB. Split it, or compress it.');
  }
  if (file.size === 0) {
    throw new DocumentRejected('That file is empty.');
  }
  safeFileName(file.name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
