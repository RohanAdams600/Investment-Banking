'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@ib/ui';

import { createAgentToken, emptyAgentTokenState, revokeAgentToken } from './actions';
import type { AgentToken } from './queries';

/**
 * Connecting an external AI agent.
 *
 * The screen a person uses to hand Manus, Claude Desktop or anything else
 * speaking Model Context Protocol a key to this account. Everything the key can
 * do is chosen here and cannot be widened afterwards — a token is revoked and
 * reissued, never edited, because mutating scopes in place is how a read-only
 * agent quietly becomes something else.
 */

const SCOPES: { value: string; label: string; detail: string }[] = [
  {
    value: 'read:listings',
    label: 'Read listings',
    detail:
      'Anonymised teasers. A confidential profile only where you have already signed that seller’s NDA.',
  },
  {
    value: 'read:matches',
    label: 'Read your matches',
    detail: 'Listings scored against your criteria, with the reasoning.',
  },
  {
    value: 'read:pipeline',
    label: 'Read your pipeline',
    detail: 'Open tasks and due dates. Never message bodies.',
  },
  {
    value: 'run:valuation',
    label: 'Run valuations',
    detail: 'The deterministic estimate. Touches no stored record.',
  },
  {
    value: 'draft:outreach',
    label: 'Write drafts',
    detail: 'Puts a draft in your approval queue. It cannot send anything.',
  },
];

export function AgentPanel({ tokens, endpoint }: { tokens: AgentToken[]; endpoint: string }) {
  const [state, action] = useActionState(createAgentToken, emptyAgentTokenState);

  return (
    <div className="space-y-6">
      {/*
        Stated before the form rather than after it.

        Somebody about to hand an AI agent a key to their deal data should know
        the boundary before they choose scopes, not discover it in a tooltip.
      */}
      <Card>
        <CardHeader>
          <CardTitle>What an agent can and cannot do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-text-secondary leading-relaxed">
            An agent can read anything you can read and write drafts for you to review.{' '}
            <strong className="text-text-primary">
              It cannot send a message, issue a confidentiality agreement, or publish anything.
            </strong>{' '}
            No such tool exists on this server, and asking it for one will not produce it — a person
            still clicks send on anything that reaches another human being.
          </p>
          <p className="text-text-muted leading-relaxed">
            Point your agent at{' '}
            <code className="bg-surface-sunken rounded px-1.5 py-0.5 font-mono text-xs">
              {endpoint}
            </code>{' '}
            with the token as a bearer credential.
          </p>
        </CardContent>
      </Card>

      {state.plaintext ? <NewToken token={state.plaintext} label={state.label ?? ''} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Issue a key</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-5">
            <Input
              label="What is it for"
              name="label"
              required
              maxLength={100}
              placeholder="Manus"
              hint="So you know which one to revoke later."
            />

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">What may it do</legend>
              {SCOPES.map((scope) => (
                <label
                  key={scope.value}
                  className="border-border-subtle hover:border-border-default flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors"
                >
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope.value}
                    defaultChecked={scope.value.startsWith('read:')}
                    className="mt-1"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{scope.label}</span>
                    <span className="text-text-secondary block text-sm leading-relaxed">
                      {scope.detail}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <Select label="Expires after" name="days" defaultValue="90">
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </Select>

            {state.error ? (
              <p role="alert" className="text-danger text-sm">
                {state.error}
              </p>
            ) : null}

            <Submit label="Issue key" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected agents</CardTitle>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-text-muted text-sm">Nothing connected yet.</p>
          ) : (
            <ul className="divide-border-subtle divide-y">
              {tokens.map((token) => (
                <TokenRow key={token.id} token={token} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The one time the secret is visible.
 *
 * There is no way to see it again, deliberately: a credential that can be
 * re-read is one a leaked session hands over, and reissuing costs nothing.
 */
function NewToken({ token, label }: { token: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Card className="border-accent">
      <CardContent className="space-y-3 py-6">
        <div className="space-y-1">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.16em]">Copy this now</p>
          <h3 className="font-display text-lg font-semibold">
            Key issued{label ? ` for ${label}` : ''}
          </h3>
          <p className="text-text-secondary text-sm leading-relaxed">
            This is the only time it is shown. If you lose it, revoke this one and issue another —
            that is cheaper than being able to look it up would be safe.
          </p>
        </div>

        <div className="bg-surface-sunken flex items-center gap-2 overflow-x-auto rounded-md p-3">
          <code className="break-all font-mono text-xs">{token}</code>
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(token).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardContent>
    </Card>
  );
}

function TokenRow({ token }: { token: AgentToken }) {
  const [, action] = useActionState(revokeAgentToken, emptyAgentTokenState);

  const expired = new Date(token.expiresAt) < new Date();
  const dead = token.revokedAt !== null || expired;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{token.label}</span>
          {token.revokedAt ? (
            <Badge variant="neutral">Revoked</Badge>
          ) : expired ? (
            <Badge variant="neutral">Expired</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          )}
        </div>
        <p className="text-text-muted font-mono text-xs">{token.hint}…</p>
        <p className="text-text-secondary text-xs">
          {token.scopes.join(' · ')}
          {' — '}
          {token.lastUsedAt
            ? `last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
            : 'never used'}
        </p>
      </div>

      {dead ? null : (
        <form action={action}>
          <input type="hidden" name="id" value={token.id} />
          <Submit label="Revoke" variant="secondary" size="sm" />
        </form>
      )}
    </li>
  );
}

function Submit({ label, variant, size }: { label: string; variant?: 'secondary'; size?: 'sm' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size}>
      {pending ? 'Working…' : label}
    </Button>
  );
}
