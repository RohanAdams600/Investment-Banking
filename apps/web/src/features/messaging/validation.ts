import { z } from 'zod';

/**
 * Request validation for the messaging API.
 *
 * Every route parses its input through one of these before touching the
 * database. Zod is the outermost gate; the database constraints are the
 * innermost. They deliberately agree — `body` is 1–10,000 characters in both —
 * so a payload rejected here would also have been rejected there, and the API
 * returns a readable error instead of a constraint violation.
 */

export const uuidSchema = z.string().uuid('Not a valid identifier.');

export const CONVERSATION_ROLES = ['buyer', 'seller', 'banker', 'admin'] as const;
export const CONVERSATION_TYPES = ['buyer_seller', 'internal', 'diligence'] as const;

export type ConversationRole = (typeof CONVERSATION_ROLES)[number];
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/**
 * Message body.
 *
 * Trimmed, length-bounded, and rejected if it is only whitespace. No HTML
 * sanitisation, deliberately: the body is stored verbatim and rendered as text
 * by the client, never as markup. Sanitising here would imply the output is
 * trusted as HTML somewhere, which is exactly the assumption that turns one
 * careless `dangerouslySetInnerHTML` into stored XSS across a deal room.
 */
export const messageBodySchema = z
  .string()
  .trim()
  .min(1, 'Write a message before sending.')
  .max(10_000, 'Messages are limited to 10,000 characters.')
  // Null bytes are valid in JSON strings and rejected by Postgres `text`, so
  // they would surface as a 500 rather than a validation error.
  .refine((value) => !value.includes('\u0000'), 'That message contains an unsupported character.');

export const sendMessageSchema = z.object({
  body: messageBodySchema,
});

export const editMessageSchema = z.object({
  messageId: uuidSchema,
  body: messageBodySchema,
});

export const withdrawMessageSchema = z.object({
  messageId: uuidSchema,
});

export const listMessagesSchema = z.object({
  /** Cursor: return messages older than this timestamp. */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createConversationSchema = z.object({
  name: z.string().trim().min(1, 'Name the conversation.').max(200),
  type: z.enum(CONVERSATION_TYPES),
});

export const addMemberSchema = z.object({
  userId: uuidSchema,
  role: z.enum(CONVERSATION_ROLES),
});

export const removeMemberSchema = z.object({
  userId: uuidSchema,
});

export const attachmentSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    // Path traversal and separators. Object keys are built as
    // `<conversation_id>/<message_id>/<fileName>`, and the storage policies read
    // the conversation id from the first path segment — a filename containing a
    // slash could shift that boundary.
    .refine(
      (name) => !name.includes('/') && !name.includes('\\') && !name.includes('..'),
      'That file name is not allowed.',
    ),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(52_428_800, 'Attachments are limited to 50 MB.'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type AttachmentInput = z.infer<typeof attachmentSchema>;
