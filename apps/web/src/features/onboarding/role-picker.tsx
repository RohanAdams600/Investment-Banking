'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Card, CardContent, CardHeader, CardTitle, cn } from '@ib/ui';
import type { PlatformRole } from '@ib/core';

import { saveRoles } from './actions';
import { emptyOnboardingState, ROLE_OPTIONS } from './roles';

const GROUPS: Array<{ side: 'sell' | 'buy' | 'advise'; heading: string }> = [
  { side: 'sell', heading: 'Selling a business' },
  { side: 'buy', heading: 'Buying a business' },
  { side: 'advise', heading: 'Advising on deals' },
];

export function RolePicker({ existing }: { existing: PlatformRole[] }) {
  const [selected, setSelected] = useState<Set<PlatformRole>>(new Set(existing));
  const [state, action] = useActionState(saveRoles, emptyOnboardingState);

  function toggle(role: PlatformRole) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <form action={action} className="space-y-6">
      {GROUPS.map((group) => (
        <Card key={group.side}>
          <CardHeader>
            <CardTitle>{group.heading}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ROLE_OPTIONS.filter((option) => option.side === group.side).map((option) => {
              const isSelected = selected.has(option.role);
              return (
                <label
                  key={option.role}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                    isSelected
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border-subtle hover:border-border-default',
                  )}
                >
                  <input
                    type="checkbox"
                    name="roles"
                    value={option.role}
                    checked={isSelected}
                    onChange={() => toggle(option.role)}
                    className="border-border-default text-primary focus-visible:ring-ring mt-0.5 h-4 w-4 rounded"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-text-muted block text-xs">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/*
        Said explicitly, because the checkbox layout implies a single answer to
        anyone who has met a radio group. A broker who also buys is one account
        with two roles — the data model was built for exactly this.
      */}
      <p className="text-text-muted text-sm">
        Pick as many as apply. A broker who also buys is one account with both, and you can change
        this later.
      </p>

      {state.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}

      <SubmitButton disabled={selected.size === 0} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={disabled}>
      Continue
    </Button>
  );
}
