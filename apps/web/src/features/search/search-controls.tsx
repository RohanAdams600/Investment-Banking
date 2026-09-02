'use client';

import { useActionState } from 'react';
import { Button } from '@ib/ui';

import { deleteSearch, setSearchFrequency, type SavedSearchState } from './actions';

const initial: SavedSearchState = { error: null, message: null };

/**
 * Retuning or removing one saved search.
 *
 * Two forms rather than one with a mode flag: they submit to different actions,
 * and a single form whose behaviour depends on which button was pressed is the
 * pattern that eventually deletes something because a browser submitted on
 * Enter.
 *
 * Pausing is offered beside deleting and listed first. A buyer who is mid-deal
 * does not want six alerts a week and does not want to rebuild the search
 * afterwards either — without a pause, the only way to stop the email is to
 * destroy the thing that produces it.
 */
export function SearchControls({
  id,
  frequency,
  label,
}: {
  id: string;
  frequency: 'daily' | 'weekly' | 'off';
  label: string;
}) {
  const [freqState, freqAction, freqPending] = useActionState(setSearchFrequency, initial);
  const [delState, delAction, delPending] = useActionState(deleteSearch, initial);

  const error = freqState.error ?? delState.error;

  return (
    <div className="border-border-subtle space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action={freqAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`freq-${id}`} className="text-text-muted text-xs">
            Alert me
          </label>
          <select
            id={`freq-${id}`}
            name="frequency"
            defaultValue={frequency}
            className="border-border-default bg-canvas focus-visible:ring-ring rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="off">Not at all</option>
          </select>
          <Button type="submit" variant="secondary" size="sm" disabled={freqPending}>
            {freqPending ? 'Saving…' : 'Update'}
          </Button>
        </form>

        <form action={delAction} className="ml-auto">
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="ghost" size="sm" disabled={delPending}>
            {delPending ? 'Deleting…' : `Delete “${label}”`}
          </Button>
        </form>
      </div>

      {error ? (
        <p className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {freqState.message ? (
        <p className="text-text-muted text-xs" role="status">
          {freqState.message}
        </p>
      ) : null}
    </div>
  );
}
