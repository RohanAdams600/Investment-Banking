'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@ib/ui';

import { refreshMyMatches } from './actions';
import { emptyOutreachState } from './types';

/** Rescores the signed-in buyer against the market. */
export function RefreshMatchesButton() {
  const [state, action] = useActionState(async () => refreshMyMatches(), emptyOutreachState);

  return (
    <form action={action} className="space-y-1">
      <Submit />
      {state.error ? (
        <p role="alert" className="text-danger text-xs">
          {state.error}
        </p>
      ) : null}
      <p aria-live="polite" className="text-text-muted text-xs">
        {state.message}
      </p>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending}>
      Refresh matches
    </Button>
  );
}
