import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { Button, Card, CardContent } from '@ib/ui';

import {
  requireConfidentialAssurance,
  StepUpRequiredError,
  STEP_UP_ACTIONS,
} from '@/lib/auth/assurance';

/**
 * The second factor in front of a deal room.
 *
 * ## Why a layout and not a check on each page
 *
 * There are two pages under this segment today — messages and documents — and
 * there will be more. A guard copied into each one is a guard somebody forgets
 * on the third, and the failure is silent: the page renders, the data loads,
 * and nothing says the gate was skipped. A layout covers every route in the
 * segment by construction, including ones not written yet.
 *
 * ## What it does and does not decide
 *
 * It does not decide whether this person may see the deal. Row Level Security
 * has already done that, and every page and action re-checks membership
 * independently — this cannot widen access, only refuse it.
 *
 * What it decides is whether the *session* is trusted enough to open a room
 * holding another party's financials and documents. A deal room is the highest
 * concentration of confidential information in the product: a stolen cookie
 * that reaches one reaches all of it at once.
 *
 * An account with no second factor is sent to enrol rather than let through.
 * That is the operator policy recorded in `step-up-policy.ts`; the earlier
 * behaviour was to proceed and count the gap.
 */
export default async function DealRoomLayout({ children }: { children: ReactNode }) {
  try {
    await requireConfidentialAssurance(STEP_UP_ACTIONS.dealRoom);
  } catch (error) {
    if (!(error instanceof StepUpRequiredError)) throw error;

    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Card>
          <CardContent className="space-y-4 py-10">
            <ShieldAlert className="text-accent h-6 w-6" aria-hidden />
            <h1 className="font-display text-xl font-semibold">
              {error.canStepUp ? 'Confirm it is you' : 'Two-factor authentication required'}
            </h1>
            <p className="text-text-secondary max-w-xl text-sm leading-relaxed">{error.message}</p>
            <p className="text-text-muted max-w-xl text-sm leading-relaxed">
              You are not being asked this because anything is wrong. A deal room holds financials
              and documents that belong to the other side, and they were promised that only the
              people they approved can open them.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild>
                <Link href="/settings/security">
                  {error.canStepUp ? 'Confirm' : 'Set it up'}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/deals">Back to deals</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <>{children}</>;
}
