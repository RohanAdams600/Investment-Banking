import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { Badge, Card, CardContent, EmptyState, cn } from '@ib/ui';

import { getConversationMembership } from '@/features/messaging/authorization';
import { DealChat } from '@/features/messaging/deal-chat';
import {
  getDeal,
  listConversations,
  listMembers,
  listMessages,
} from '@/features/messaging/queries';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Deal messages',
  // Deal rooms are confidential by definition.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ conversation?: string }>;
}

export default async function DealMessagesPage({ params, searchParams }: PageProps) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const { dealId } = await params;
  const { conversation: requestedConversation } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // RLS decides this. A deal the user has no room in reads as absent, which is
  // the same answer a deal that does not exist gives — deliberately, so a URL
  // cannot be used to confirm a deal exists.
  const deal = await getDeal(dealId);
  if (!deal) notFound();

  const conversations = await listConversations(dealId);

  if (conversations.length === 0) {
    return (
      <main className="py-18 mx-auto max-w-3xl px-6">
        <EmptyState
          icon={MessagesSquare}
          title="No conversations in this deal"
          description="A banker or admin on the deal can open the first room."
        />
      </main>
    );
  }

  const active = conversations.find((c) => c.id === requestedConversation) ?? conversations[0]!;

  const [membership, page, members] = await Promise.all([
    getConversationMembership(active.id),
    listMessages(active.id, { limit: 50 }),
    listMembers(active.id),
  ]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{deal.name}</h1>
          <p className="text-text-muted text-sm">
            Messages are visible only to members of each conversation.
          </p>
        </div>

        {/*
          Where files go, now that the chat does not take them.
          The composer used to carry a paperclip that uploaded to storage and
          recorded the object nowhere — so the file was unreachable as soon as
          the page closed. The vault is the same job done properly: released to
          named people, versioned, and logged when opened.
        */}
        <Link
          href={`/deals/${dealId}/documents`}
          className="border-border-subtle hover:border-border-default rounded-md border px-3 py-2 text-sm transition-colors"
        >
          Documents
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Conversations" className="space-y-1">
          {conversations.map((conversation) => {
            const isActive = conversation.id === active.id;
            return (
              <Link
                key={conversation.id}
                href={`/deals/${dealId}/messages?conversation=${conversation.id}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'block rounded px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary-subtle text-primary font-medium'
                    : 'text-text-secondary hover:bg-surface-sunken',
                )}
              >
                <span className="block truncate">{conversation.name}</span>
                <span className="text-text-muted text-2xs">
                  {conversation.type.replace(/_/g, ' ')}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-4">
          <DealChat
            conversationId={active.id}
            initialMessages={page.messages}
            initialCursor={page.nextCursor}
            canPost={membership.isMember}
          />

          <Card>
            <CardContent className="space-y-2">
              <h2 className="text-sm font-medium">In this conversation</h2>
              <ul className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <li key={member.userId}>
                    <Badge variant={member.role === 'banker' ? 'primary' : 'neutral'}>
                      {member.name ?? 'Unnamed'} · {member.role}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-text-muted text-xs">
                Everyone listed here can read every message in this conversation.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
