'use client';

import { useActionState, useState } from 'react';
import { BellPlus } from 'lucide-react';
import { Button } from '@ib/ui';

import { saveSearch, type SavedSearchState } from './actions';

const initial: SavedSearchState = { error: null, message: null };

/**
 * "Tell me when one of these comes up", on the results page.
 *
 * ## Why it lives here and not on a settings page
 *
 * The moment a buyer wants an alert is the moment a search returns two results
 * instead of twenty — not later, on a preferences screen they would have to go
 * looking for. So the control sits with the filters that produced the result,
 * pre-filled from them, and saving is one field and one button.
 *
 * ## Collapsed until asked for
 *
 * It opens on click rather than sitting open. A form permanently occupying the
 * top of a results page is a form most people scroll past, and the results are
 * what they came for.
 *
 * The filters ride along as hidden inputs rather than being re-read from the
 * URL on the server. That is deliberate: what gets saved is exactly what
 * produced the list on screen, so a buyer cannot save one search while looking
 * at another's results.
 */
export function SaveSearchForm({
  filters,
  isEmpty,
}: {
  filters: {
    q?: string;
    industry?: string;
    jurisdiction?: string;
    minEarnings?: string;
    maxAsking?: string;
  };
  /** True when no filter is set — the search would match the whole market. */
  isEmpty: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveSearch, initial);

  if (state.message) {
    return (
      <p className="text-text-secondary flex items-center gap-2 text-sm" role="status">
        <BellPlus className="text-accent h-4 w-4 shrink-0" aria-hidden />
        {state.message}{' '}
        <a href="/saved-searches" className="hover:text-text-primary underline underline-offset-4">
          Manage saved searches
        </a>
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <BellPlus aria-hidden />
        Alert me about searches like this
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="border-border-default bg-surface w-full space-y-3 rounded-md border p-4"
    >
      {Object.entries(filters).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}

      <div className="space-y-1">
        <label htmlFor="saved-search-label" className="block text-sm font-medium">
          Name this search
        </label>
        <input
          id="saved-search-label"
          name="label"
          required
          maxLength={80}
          autoFocus
          placeholder="Ohio machine shops"
          className="border-border-default bg-canvas focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
        />
        <p className="text-text-muted text-xs">
          {isEmpty
            ? 'No filters are set, so this will alert you about every new listing.'
            : 'Your current filters are saved with it.'}
        </p>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">How often</legend>
        {/*
          Daily and weekly, and no instant option. A seller taking a listing
          live and a stranger's phone buzzing in the same second publishes the
          exact minute a business came to market — a timing signal the seller
          did not agree to. A day's batching costs a buyer nothing.
        */}
        <div className="flex gap-4 pt-1">
          {(['daily', 'weekly'] as const).map((option, index) => (
            <label key={option} className="flex items-center gap-2 text-sm capitalize">
              <input type="radio" name="frequency" value={option} defaultChecked={index === 0} />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? (
        <p className="text-danger text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save search'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
