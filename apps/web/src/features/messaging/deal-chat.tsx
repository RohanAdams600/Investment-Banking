'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@ib/ui';

import { createClient } from '@/lib/supabase/client';
import { MessageComposer } from './message-composer';
import { MessageList } from './message-list';
import type { MessageDto, MessagePage } from './types';

interface DealChatProps {
  conversationId: string;
  initialMessages: MessageDto[];
  initialCursor: string | null;
  canPost: boolean;
}

export function DealChat({
  conversationId,
  initialMessages,
  initialCursor,
  canPost,
}: DealChatProps) {
  const [messages, setMessages] = useState<MessageDto[]>(initialMessages);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read inside the realtime callback, which would otherwise close over a stale
  // `messages` from the render that registered it.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!response.ok) throw new Error('Could not load this conversation.');
      const page = (await response.json()) as MessagePage;
      setMessages(page.messages);
      setCursor(page.nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Could not load this conversation.',
      );
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  /**
   * Realtime.
   *
   * The channel is private, so subscribing is authorised by RLS on
   * `realtime.messages` against the same membership rule as everything else. A
   * client that guesses another conversation's topic is refused at subscribe
   * time rather than quietly receiving nothing.
   *
   * The broadcast payload carries ids only — no message body. On an event, we
   * refetch through the API, which goes through RLS again. That costs a round
   * trip and buys something worth more: the realtime channel is not a second,
   * weaker path to message content.
   */
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`conversation:${conversationId}`, {
      config: { private: true },
    });

    channel
      .on('broadcast', { event: 'message' }, (payload) => {
        const messageId = (payload.payload as { message_id?: string })?.message_id;
        // Skip the echo of a message this client already rendered from its own
        // POST response.
        if (messageId && messagesRef.current.some((m) => m.id === messageId)) return;
        void refresh();
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Not fatal — the conversation still works, it just stops updating on
          // its own. Saying so is better than looking idle.
          setError('Live updates are unavailable. Reload to see new messages.');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refresh]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/messages?before=${encodeURIComponent(cursor)}`,
      );
      if (!response.ok) throw new Error('Could not load earlier messages.');
      const page = (await response.json()) as MessagePage;
      setMessages((current) => [...page.messages, ...current]);
      setCursor(page.nextCursor);
    } catch {
      setError('Could not load earlier messages.');
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, cursor, loadingMore]);

  const send = useCallback(
    async (body: string) => {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(problem?.error ?? 'Could not send that message.');
      }

      // Appended from the response rather than optimistically, so what is shown
      // is what the database stored — including the server's timestamp.
      const message = (await response.json()) as MessageDto;
      setMessages((current) => [...current, message]);
    },
    [conversationId],
  );

  return (
    <Card className="flex h-[70vh] flex-col overflow-hidden">
      <MessageList
        messages={messages}
        loading={loading}
        error={error}
        onRetry={refresh}
        hasMore={cursor !== null}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />

      <MessageComposer
        onSend={send}
        disabled={!canPost}
        disabledReason="You are no longer an active member of this conversation."
      />
    </Card>
  );
}
