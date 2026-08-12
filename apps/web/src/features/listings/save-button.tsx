'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Button } from '@ib/ui';

import { toggleSaved } from './actions';
import { emptyListingState } from './types';

/** Watchlist toggle. Private to the user — sellers never see who saved them. */
export function SaveButton({ listingId, saved }: { listingId: string; saved: boolean }) {
  const [state, action] = useActionState(toggleSaved, emptyListingState);

  return (
    <form action={action}>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="saved" value={String(saved)} />
      <Toggle saved={saved} />
      {state.error ? (
        <span role="alert" className="sr-only">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function Toggle({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();
  const Icon = saved ? BookmarkCheck : Bookmark;

  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon"
      disabled={pending}
      aria-pressed={saved}
      title={saved ? 'Remove from watchlist' : 'Save to watchlist'}
    >
      <Icon aria-hidden />
      <span className="sr-only">{saved ? 'Remove from watchlist' : 'Save to watchlist'}</span>
    </Button>
  );
}
