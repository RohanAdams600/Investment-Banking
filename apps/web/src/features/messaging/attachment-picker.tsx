'use client';

import { useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '@ib/ui';

/**
 * Attaches a file to a message.
 *
 * The upload goes straight from the browser to storage using a short-lived
 * signed URL minted server-side, so a large document never streams through a
 * serverless function. The storage policy re-checks conversation membership on
 * write, so holding the URL is not on its own permission to use it.
 *
 * Nothing here produces a shareable link. Reads are separately signed, expire
 * in a minute, and are issued only after the same membership check.
 */

const MAX_BYTES = 52_428_800; // 50 MB, matching the bucket limit

const ACCEPTED = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

interface AttachmentPickerProps {
  conversationId: string;
  /** The message the file belongs to; part of the object key. */
  messageId: string;
  onUploaded: (path: string, fileName: string) => void;
}

export function AttachmentPicker({ conversationId, messageId, onUploaded }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    // Checked here for a fast, readable message. The bucket enforces both
    // limits again server-side, which is the check that counts.
    if (file.size > MAX_BYTES) {
      setError('Attachments are limited to 50 MB.');
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      setError('That file type is not accepted.');
      return;
    }
    if (file.name.includes('/') || file.name.includes('\\') || file.name.includes('..')) {
      // The object key is `<conversation>/<message>/<name>`, and the storage
      // policy reads the conversation from the first segment. A name with a
      // separator would move that boundary.
      setError('That file name is not allowed.');
      return;
    }

    setUploading(true);
    try {
      const prepare = await fetch(`/api/conversations/${conversationId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });

      if (!prepare.ok) {
        const problem = (await prepare.json().catch(() => null)) as { error?: string } | null;
        throw new Error(problem?.error ?? 'Could not prepare that upload.');
      }

      const { uploadUrl } = (await prepare.json()) as { uploadUrl: string; path: string };

      const upload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!upload.ok) throw new Error('The upload did not complete.');

      const { path } = (await prepare
        .clone()
        .json()
        .catch(() => ({ path: '' }))) as {
        path: string;
      };
      onUploaded(path, file.name);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not attach that file.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="sr-only"
        id={`attachment-${messageId}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
        aria-describedby={error ? `attachment-error-${messageId}` : undefined}
      >
        <Paperclip aria-hidden />
        Attach file
      </Button>

      {error ? (
        <p id={`attachment-error-${messageId}`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
