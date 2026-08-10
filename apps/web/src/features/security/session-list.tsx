'use client';

import { useActionState, useTransition, useState } from 'react';
import { Laptop, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@ib/ui';

import { revokeOtherSessions, revokeSession } from './session-actions';
import { emptyMfaState, type MfaActionState, type SessionSummary } from './types';

/**
 * Turns a user-agent string into something a person can recognise.
 *
 * Deliberately crude. The goal is "is this me?", which needs roughly
 * browser plus platform — not accurate device fingerprinting, which would be
 * both unreliable and a privacy problem to store.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : 'Browser';

  const platform = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown platform';

  return `${browser} on ${platform}`;
}

function formatWhen(value: string | null): string {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  const [revokeState, revokeAction] = useActionState(revokeSession, emptyMfaState);
  const [othersState, setOthersState] = useState<MfaActionState>(emptyMfaState);
  const [signingOutOthers, startSignOutOthers] = useTransition();

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Active sessions</CardTitle>
          <p className="text-text-muted text-sm">
            Signing out a device stops its session continuing. An access token already issued stays
            valid until it expires, up to an hour.
          </p>
        </div>

        {otherSessions.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            loading={signingOutOthers}
            onClick={() =>
              startSignOutOthers(async () => setOthersState(await revokeOtherSessions()))
            }
          >
            Sign out others
          </Button>
        ) : null}
      </CardHeader>

      <CardContent>
        {sessions.length === 0 ? (
          <EmptyState
            icon={Laptop}
            title="No active sessions"
            description="Sessions appear here once you sign in from a device."
          />
        ) : (
          <ul className="divide-border-subtle divide-y">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {describeDevice(session.userAgent)}
                    {session.isCurrent ? <Badge variant="primary">This device</Badge> : null}
                    {session.assuranceLevel === 'aal2' ? (
                      <Badge variant="success">
                        <ShieldCheck aria-hidden className="h-3 w-3" />
                        2FA
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-text-muted text-xs">
                    Last active {formatWhen(session.lastSeenAt ?? session.createdAt)}
                    {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                  </p>
                </div>

                {session.isCurrent ? null : (
                  <form action={revokeAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Sign out
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {[revokeState, othersState].map((state, i) =>
          state.error ? (
            <p key={i} role="alert" className="text-danger pt-3 text-sm">
              {state.error}
            </p>
          ) : state.notice ? (
            <p key={i} role="status" className="text-success pt-3 text-sm">
              {state.notice}
            </p>
          ) : null,
        )}
      </CardContent>
    </Card>
  );
}
