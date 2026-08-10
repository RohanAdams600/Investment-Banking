'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Button } from '@ib/ui';

const MAX_LENGTH = 10_000;

interface MessageComposerProps {
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

export function MessageComposer({ onSend, disabled, disabledReason }: MessageComposerProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = body.trim();
  const tooLong = body.length > MAX_LENGTH;
  const canSend = trimmed.length > 0 && !tooLong && !sending && !disabled;

  async function submit() {
    if (!canSend) return;

    setSending(true);
    setError(null);

    // Cleared optimistically so the box is ready for the next line, and
    // restored on failure — losing what someone typed into a live negotiation
    // is worse than a moment of duplicated text.
    const pending = trimmed;
    setBody('');

    try {
      await onSend(pending);
      textareaRef.current?.focus();
    } catch (sendError) {
      setBody(pending);
      setError(sendError instanceof Error ? sendError.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. The convention people already
    // have from every other chat tool.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  if (disabled) {
    return (
      <div className="border-border-subtle text-text-muted border-t p-4 text-sm" role="status">
        {disabledReason ?? 'You cannot post in this conversation.'}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-border-subtle space-y-2 border-t p-4">
      <label htmlFor="message-body" className="sr-only">
        Message
      </label>

      <textarea
        id="message-body"
        ref={textareaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        maxLength={MAX_LENGTH + 100}
        placeholder="Write a message…"
        aria-describedby="message-hint"
        aria-invalid={tooLong || Boolean(error)}
        className="border-border-default bg-surface text-text-primary placeholder:text-text-muted focus-visible:ring-ring focus-visible:border-primary w-full resize-y rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
      />

      <div className="flex items-center justify-between gap-3">
        <p id="message-hint" className="text-text-muted text-xs">
          Enter to send, Shift+Enter for a new line.
          {body.length > MAX_LENGTH * 0.9 ? (
            <span className={tooLong ? 'text-danger ml-2' : 'ml-2'}>
              {body.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
            </span>
          ) : null}
        </p>

        <Button type="submit" size="sm" loading={sending} disabled={!canSend}>
          <SendHorizontal aria-hidden />
          Send
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
