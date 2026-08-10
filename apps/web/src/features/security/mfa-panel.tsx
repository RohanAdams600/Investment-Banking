'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@ib/ui';

import { beginMfaEnrollment, unenrollMfa, verifyMfaEnrollment } from './mfa-actions';
import { emptyMfaState, type MfaFactorSummary } from './types';

interface MfaPanelProps {
  factors: MfaFactorSummary[];
  /** True when this session actually completed a second-factor challenge. */
  sessionIsAal2: boolean;
}

export function MfaPanel({ factors, sessionIsAal2 }: MfaPanelProps) {
  const verified = factors.filter((f) => f.status === 'verified');
  const [enrolment, setEnrolment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startEnrolment] = useTransition();

  const [verifyState, verifyAction] = useActionState(verifyMfaEnrollment, emptyMfaState);
  const [unenrollState, unenrollAction] = useActionState(unenrollMfa, emptyMfaState);

  function handleStart() {
    setStartError(null);
    startEnrolment(async () => {
      const result = await beginMfaEnrollment();
      if (result.error) {
        setStartError(result.error);
        return;
      }
      setEnrolment({ factorId: result.factorId, qrCode: result.qrCode, secret: result.secret });
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Two-factor authentication</CardTitle>
        {verified.length > 0 ? (
          <Badge variant="success">
            <ShieldCheck aria-hidden className="h-3 w-3" />
            On
          </Badge>
        ) : (
          <Badge variant="warning">
            <ShieldAlert aria-hidden className="h-3 w-3" />
            Off
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-text-secondary text-sm">
          A code from an authenticator app, required alongside your password. Your account can reach
          confidential financial documents, so a leaked password should not be enough on its own.
        </p>

        {verified.length === 0 && !enrolment ? (
          <div className="space-y-2">
            <Button onClick={handleStart} loading={starting}>
              Set up authenticator app
            </Button>
            {startError ? (
              <p role="alert" className="text-danger text-sm">
                {startError}
              </p>
            ) : null}
          </div>
        ) : null}

        {enrolment ? (
          <form action={verifyAction} className="space-y-4">
            <input type="hidden" name="factorId" value={enrolment.factorId} />

            <ol className="text-text-secondary space-y-3 text-sm">
              <li>
                <span className="text-text-primary font-medium">1.</span> Scan this code with your
                authenticator app.
                <div className="bg-surface border-border-default mt-2 inline-block rounded border p-2">
                  {/* Supabase returns the otpauth URI already rendered as an SVG data URL. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={enrolment.qrCode}
                    alt="QR code for setting up two-factor authentication"
                    width={180}
                    height={180}
                  />
                </div>
              </li>
              <li>
                <span className="text-text-primary font-medium">2.</span> Or enter this key
                manually:
                <code className="bg-surface-sunken mt-1 block break-all rounded px-2 py-1 font-mono text-xs">
                  {enrolment.secret}
                </code>
              </li>
              <li>
                <span className="text-text-primary font-medium">3.</span> Enter the 6-digit code it
                shows.
              </li>
            </ol>

            <Input
              label="Verification code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              // The factor is not active until this succeeds, so a failed QR
              // scan cannot lock anyone out.
              hint="The factor is not active until this code is accepted."
            />

            {verifyState.error ? (
              <p role="alert" className="text-danger text-sm">
                {verifyState.error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <SubmitButton label="Turn on" />
              <Button type="button" variant="ghost" onClick={() => setEnrolment(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {verifyState.notice ? (
          <p role="status" className="text-success text-sm">
            {verifyState.notice}
          </p>
        ) : null}

        {verified.length > 0 ? (
          <ul className="divide-border-subtle divide-y">
            {verified.map((factor) => (
              <li key={factor.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {factor.friendlyName ?? 'Authenticator app'}
                  </p>
                  <p className="text-text-muted text-xs">
                    Added {new Date(factor.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <form action={unenrollAction}>
                  <input type="hidden" name="factorId" value={factor.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    // Removing a factor is what an attacker on a stolen session
                    // would do first, so it needs a session that used the factor.
                    disabled={!sessionIsAal2}
                    title={
                      sessionIsAal2
                        ? undefined
                        : 'Sign in with your authenticator app to remove this factor.'
                    }
                  >
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}

        {unenrollState.error ? (
          <p role="alert" className="text-danger text-sm">
            {unenrollState.error}
          </p>
        ) : null}
        {unenrollState.notice ? (
          <p role="status" className="text-success text-sm">
            {unenrollState.notice}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}
