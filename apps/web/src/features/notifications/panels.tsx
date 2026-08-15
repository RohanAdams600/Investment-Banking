'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { NotificationCategory } from '@ib/core';
import { Button } from '@ib/ui';

import { emptyNotificationState, markAllRead, saveNotificationPreferences } from './actions';
import type { NotificationPreferences } from './queries';

export function MarkAllRead() {
  const [, action] = useActionState(markAllRead, emptyNotificationState);

  return (
    <form action={action}>
      <Submit label="Mark all read" small />
    </form>
  );
}

/**
 * Which categories reach the inbox.
 *
 * Checkboxes rather than toggles, because a form of checkboxes submits as one
 * thing a person deliberately saves — a row of toggles that each fire their own
 * request makes "did that save" a question, and the answer matters here: somebody
 * turning off deal emails on their phone should know it took.
 */
export function NotificationPreferencesForm({
  preferences,
  labels,
  hints,
}: {
  preferences: NotificationPreferences;
  labels: Record<NotificationCategory, string>;
  hints: Record<NotificationCategory, string>;
}) {
  const [state, action] = useActionState(saveNotificationPreferences, emptyNotificationState);

  const rows: Array<{ name: string; category: NotificationCategory; checked: boolean }> = [
    { name: 'dealActivity', category: 'deal_activity', checked: preferences.dealActivity },
    { name: 'newMatches', category: 'new_matches', checked: preferences.newMatches },
    { name: 'listingStatus', category: 'listing_status', checked: preferences.listingStatus },
    { name: 'messages', category: 'messages', checked: preferences.messages },
  ];

  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="sr-only">Email categories</legend>

        {rows.map((row) => (
          <label key={row.name} className="flex gap-3">
            <input
              type="checkbox"
              name={row.name}
              defaultChecked={row.checked}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm">{labels[row.category]}</span>
              <span className="text-text-muted block text-xs">{hints[row.category]}</span>
            </span>
          </label>
        ))}

        <label className="border-border-subtle flex gap-3 border-t pt-3">
          <input
            type="checkbox"
            name="digest"
            defaultChecked={preferences.digest}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm">Send one summary a day instead</span>
            <span className="text-text-muted block text-xs">
              Off by default. Somebody whose listing has just gone live wants to know about the
              first access request within the hour, not tomorrow morning.
            </span>
          </span>
        </label>
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}
      <p aria-live="polite" className="text-text-muted text-sm">
        {state.message}
      </p>

      <Submit label="Save" />
    </form>
  );
}

function Submit({ label, small = false }: { label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size={small ? 'sm' : 'md'}
      variant={small ? 'secondary' : 'primary'}
      loading={pending}
    >
      {label}
    </Button>
  );
}
