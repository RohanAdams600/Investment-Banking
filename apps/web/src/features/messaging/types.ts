import type { ConversationRole, ConversationType } from './validation';

/**
 * Wire shapes for the messaging API.
 *
 * Deliberately narrower than the database rows. A message row carries
 * `deleted_at`, which never reaches a client — deleted messages are filtered by
 * the SELECT policy, so a client that received the column would only ever see
 * null and might come to rely on it.
 */

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  /** Plain text. Rendered as text, never as markup. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** True when the signed-in user sent it. */
  isOwn: boolean;
}

export interface ConversationDto {
  id: string;
  dealId: string;
  name: string;
  type: ConversationType;
  createdAt: string;
}

export interface ConversationMemberDto {
  userId: string;
  name: string | null;
  role: ConversationRole;
  addedAt: string;
}

export interface MessagePage {
  messages: MessageDto[];
  /** Cursor for the next older page; null when the start has been reached. */
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: string;
  /** Field-level messages, keyed by field name, when validation failed. */
  fields?: Record<string, string>;
}
