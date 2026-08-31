import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { nextActions, setupProgress, type AccountState, type NextAction } from '@ib/core';
import { Badge, Button, Card, CardContent } from '@ib/ui';

/**
 * The panel that answers "what do I do now".
 *
 * The complaint this exists for: a seller signs up and faces a blank form, a
 * buyer signs up and faces an empty market. Both leave. Neither is missing a
 * feature — they are missing a next step.
 *
 * ## Shape
 *
 * One highlighted action at the top, the rest as a checklist underneath. A flat
 * list of eight equal items is a list nobody starts; one thing with a button is
 * something somebody does. The finished ones stay visible, struck through and
 * ticked, because the shortening is what makes people continue.
 *
 * ## It disappears when it is done
 *
 * At 100% the panel renders nothing. A permanent "you have completed setup"
 * card is clutter on every visit thereafter, and the dashboard is more useful
 * without it.
 */
export function NextSteps({ state }: { state: AccountState }) {
  const actions = nextActions(state);
  const progress = setupProgress(actions);

  if (!progress.next) return null;

  const [lead, ...rest] = orderForDisplay(actions, progress.next);

  return (
    <Card>
      <CardContent className="space-y-5 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Next steps</h2>
          <p className="text-text-muted text-xs tabular-nums">
            {progress.done} of {progress.total} done
          </p>
        </div>

        {/*
          A bar rather than a number alone. It is the one element here doing
          motivational work, and it is honest — it only reaches full when every
          step genuinely is.
        */}
        <div
          className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div
            className="bg-chart-mark h-full rounded-full transition-all"
            style={{ width: `${Math.max(2, progress.percent)}%` }}
          />
        </div>

        {lead ? <Lead action={lead} /> : null}

        {rest.length > 0 ? (
          <ul className="divide-border-subtle divide-y">
            {rest.map((action) => (
              <li key={action.id} className="flex items-start gap-3 py-3">
                <span
                  className={
                    action.done
                      ? 'border-success bg-success/10 text-success mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border'
                      : 'border-border-default mt-0.5 h-4 w-4 shrink-0 rounded-full border'
                  }
                  aria-hidden
                >
                  {action.done ? <Check className="h-2.5 w-2.5" /> : null}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={
                      action.done
                        ? 'text-text-muted text-sm line-through'
                        : 'text-text-primary text-sm'
                    }
                  >
                    {action.title}
                    {/* Screen readers get the state as words, not as a shape. */}
                    <span className="sr-only">{action.done ? ' — done' : ' — still to do'}</span>
                  </p>
                  {!action.done ? (
                    <p className="text-text-muted mt-0.5 text-xs leading-relaxed">{action.body}</p>
                  ) : null}
                </div>

                {!action.done ? (
                  <Link
                    href={action.href}
                    className="text-accent shrink-0 text-xs underline underline-offset-4"
                  >
                    {action.cta}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The one thing to do, given room to explain itself. */
function Lead({ action }: { action: NextAction }) {
  return (
    <div className="border-accent space-y-2 border-l-2 pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base font-semibold">{action.title}</h3>
        {action.weight === 'blocking' ? <Badge variant="warning">Needed</Badge> : null}
      </div>
      <p className="text-text-secondary max-w-prose text-sm leading-relaxed">{action.body}</p>
      <Button asChild size="sm">
        <Link href={action.href}>
          {action.cta}
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

/**
 * The lead first, then everything else in its original order.
 *
 * `nextActions` already orders by what unblocks the most, so this only lifts
 * the chosen lead out rather than re-sorting — re-sorting here would put the
 * ordering rule in two places and let them disagree.
 */
function orderForDisplay(actions: NextAction[], lead: NextAction): NextAction[] {
  return [lead, ...actions.filter((action) => action.id !== lead.id)];
}
