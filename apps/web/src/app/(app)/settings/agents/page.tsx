import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { brand, pageTitle } from '@ib/core';
import { Card, CardContent } from '@ib/ui';

import { AgentPanel } from '@/features/agents/agent-panel';
import { listAgentTokens } from '@/features/agents/queries';
import { getActor } from '@/lib/auth/actor';
import { isMcpConfigured } from '@/lib/mcp/auth';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: pageTitle('Connected agents'),
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Where somebody connects an external AI agent to their account.
 *
 * The half of the MCP work that was missing: the server, the tokens table and
 * the tool allowlist all existed, and there was no way for a person to actually
 * get a key — which made the whole thing unreachable by anybody who could not
 * write SQL.
 */
export default async function AgentsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  const tokens = await listAgentTokens();
  const endpoint = `${brand.url.replace(/\/$/, '')}/api/mcp`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Connected agents</h1>
        <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
          Give an AI agent — Manus, Claude Desktop, anything speaking Model Context Protocol — a key
          to read this account and draft on your behalf.
        </p>
      </header>

      {/*
        Said plainly rather than left as a confusing 503 later.

        Without the signing secret the endpoint refuses every caller, and a
        person who issued a key and then watched their agent fail would have no
        way of knowing why.
      */}
      {isMcpConfigured() ? null : (
        <Card className="border-warning">
          <CardContent className="space-y-2 py-6">
            <h2 className="font-display text-lg font-semibold">Not switched on yet</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              You can issue keys, but the endpoint will refuse them until this deployment has{' '}
              <code className="bg-surface-sunken rounded px-1.5 py-0.5 font-mono text-xs">
                SUPABASE_JWT_SECRET
              </code>{' '}
              set. It is in the Supabase dashboard under Settings → API → JWT Settings.
            </p>
          </CardContent>
        </Card>
      )}

      <AgentPanel tokens={tokens} endpoint={endpoint} />
    </main>
  );
}
