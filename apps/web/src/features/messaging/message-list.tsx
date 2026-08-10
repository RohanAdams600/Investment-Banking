'use client';

import { useEffect, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import { EmptyState, Skeleton, cn } from '@ib/ui';

import type { MessageDto } from './types';

interface MessageListProps {
  messages: MessageDto[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}

export function MessageList({
  messages,
  loading,
  error,
  onRetry,
  hasMore,
  onLoadMore,
  loadingMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;

  // Follow the conversation as it grows. Keyed on the last id rather than on
  // length so a load-more prepending older messages does not yank the reader to
  // the bottom mid-scroll.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lastMessageId]);

  if (loading) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading messages">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="space-y-3 p-6 text-center">
        <p className="text-danger text-sm">{error}</p>
        <button onClick={onRetry} className="text-primary text-sm underline underline-offset-4">
          Try again
        </button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No messages yet"
        description="Messages in this room are visible only to its members."
        className="m-4 border-0"
      />
    );
  }

  return (
    <div
      className="flex-1 space-y-4 overflow-y-auto p-4"
      // A live region so a screen-reader user hears new messages arriving
      // instead of having to poll the list. `polite` rather than `assertive` —
      // an incoming message should not interrupt what is being read.
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Messages"
    >
      {hasMore ? (
        <div className="text-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-text-muted hover:text-text-primary text-xs underline underline-offset-4 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        </div>
      ) : null}

      <ol className="space-y-4">
        {messages.map((message) => (
          <li key={message.id} className={cn('flex flex-col gap-1')}>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">
                {message.isOwn ? 'You' : (message.senderName ?? 'Unknown sender')}
              </span>
              <time
                dateTime={message.createdAt}
                className="text-text-muted text-xs"
                title={new Date(message.createdAt).toLocaleString()}
              >
                {new Date(message.createdAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              {message.editedAt ? (
                <span className="text-text-muted text-2xs" title={`Edited ${message.editedAt}`}>
                  edited
                </span>
              ) : null}
            </div>

            {/*
              Plain text, deliberately.

              `{message.body}` in JSX is escaped by React, and `whitespace-pre-wrap`
              is what preserves the line breaks a person typed. Nothing here
              parses markup. Rendering message bodies as HTML would make one
              careless `dangerouslySetInnerHTML` into stored XSS reaching every
              member of a deal room — which on this product means the buyer, the
              seller, and their bankers.
            */}
            <p
              className={cn(
                'text-text-secondary max-w-prose whitespace-pre-wrap break-words text-sm',
                message.isOwn && 'text-text-primary',
              )}
            >
              {message.body}
            </p>
          </li>
        ))}
      </ol>

      <div ref={bottomRef} />
    </div>
  );
}
