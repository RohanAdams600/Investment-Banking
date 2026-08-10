import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireConversationMember } from '@/features/messaging/authorization';
import { createDownloadUrl, createUploadUrl } from '@/features/messaging/attachments';
import {
  enforceRateLimit,
  parseBody,
  requireUser,
  toErrorResponse,
} from '@/features/messaging/route-helpers';
import { attachmentSchema, uuidSchema } from '@/features/messaging/validation';
import { recordAuditEvent } from '@/lib/audit';

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

const uploadRequestSchema = attachmentSchema.extend({
  messageId: uuidSchema,
});

/** Mint a short-lived upload URL for one file. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    const user = await requireUser();
    await requireConversationMember(conversationId);
    await enforceRateLimit('attachmentUrl', user.id, conversationId);

    const input = await parseBody(request, uploadRequestSchema);

    const upload = await createUploadUrl(conversationId, input.messageId, input.fileName);
    if (!upload) {
      return NextResponse.json({ error: 'Could not prepare that upload.' }, { status: 400 });
    }

    await recordAuditEvent({
      action: 'attachment.upload_requested',
      entityType: 'deal_conversation',
      entityId: conversationId,
      // File name and size, never contents.
      metadata: { file_name: input.fileName, size_bytes: input.sizeBytes },
    });

    return NextResponse.json({ uploadUrl: upload.url, path: upload.path, token: upload.token });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const downloadRequestSchema = z.object({
  path: z.string().min(1).max(1024),
});

/**
 * Mint a short-lived download URL.
 *
 * A GET would be the more natural verb, but the object path would then sit in
 * the query string and be written to access logs and browser history. It is
 * POSTed in a body instead.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const conversationId = uuidSchema.parse((await params).conversationId);
    const user = await requireUser();
    await requireConversationMember(conversationId);
    await enforceRateLimit('attachmentUrl', user.id, conversationId);

    const { path } = await parseBody(request, downloadRequestSchema);

    // The storage policy would refuse a path in another conversation anyway.
    // Checking the prefix here too means the request is rejected before a URL
    // is minted, rather than producing one that fails on use.
    if (!path.startsWith(`${conversationId}/`)) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    const url = await createDownloadUrl(path);
    if (!url) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    await recordAuditEvent({
      action: 'attachment.download_url_issued',
      entityType: 'deal_conversation',
      entityId: conversationId,
      metadata: { path },
    });

    return NextResponse.json({ url });
  } catch (error) {
    return toErrorResponse(error);
  }
}
