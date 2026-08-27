'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { INDUSTRY_PROFILES } from '@ib/core';
import { Button, Card, CardContent, Input, Select, Textarea } from '@ib/ui';

import { emptyInterestState, registerInterest } from './actions';

/**
 * The form somebody sees instead of an empty board.
 *
 * ## What it must not do
 *
 * Claim there is a market. The copy says what is true — which state is opening
 * first, and that they will be told when something fits — and never implies
 * inventory or buyers that do not exist. A marketplace's first lie is always
 * about how busy it is, and the person most likely to catch it is the first
 * seller worth having.
 *
 * ## Why it asks so little
 *
 * An address and a side is enough to be useful. Industry and state make the
 * eventual message worth sending, and the free-text box is where the actually
 * valuable information turns up — but every one of them is optional, because a
 * form at the door of an empty market has no standing to demand anything.
 */
export function InterestForm({
  side,
  jurisdictions,
  source,
  heading,
  blurb,
}: {
  side: 'selling' | 'buying' | 'advising';
  jurisdictions: { code: string; name: string }[];
  source: string;
  heading: string;
  blurb: string;
}) {
  const [state, action] = useActionState(registerInterest, emptyInterestState);

  if (state.ok) {
    return (
      <Card>
        <CardContent className="space-y-2 py-8">
          <h2 className="font-display text-xl font-semibold">Noted — thank you.</h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            We will write when there is something worth writing about, and not before. No
            newsletter.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5 py-8">
        <div className="space-y-2">
          <p className="text-accent font-mono text-xs uppercase tracking-[0.2em]">
            Opening shortly
          </p>
          <h2 className="font-display text-2xl font-semibold">{heading}</h2>
          <p className="text-text-secondary max-w-xl text-sm leading-relaxed">{blurb}</p>
        </div>

        <form action={action} className="space-y-4">
          <input type="hidden" name="side" value={side} />
          <input type="hidden" name="source" value={source} />

          <Input
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Industry (optional)" name="industry" defaultValue="">
              <option value="">Any industry</option>
              {Object.values(INDUSTRY_PROFILES).map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.label}
                </option>
              ))}
            </Select>

            <Select label="State (optional)" name="jurisdiction" defaultValue="">
              <option value="">Any state</option>
              {jurisdictions.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.name}
                </option>
              ))}
            </Select>
          </div>

          <Textarea
            label="Anything else (optional)"
            name="note"
            maxLength={2000}
            rows={3}
            placeholder={
              side === 'buying'
                ? 'What you are looking for, in your own words. Size, structure, anything you will not compromise on.'
                : 'Roughly what the business does and where you are in thinking about a sale.'
            }
          />

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <Submit />

          <p className="text-text-muted text-xs leading-relaxed">
            One message when there is something that fits, and nothing else. No account needed, and
            nothing about you is shown to anybody on the platform.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Tell me when it opens'}
    </Button>
  );
}
