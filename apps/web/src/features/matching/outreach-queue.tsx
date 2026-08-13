'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '@ib/ui';

import { approveOutreachDraft, discardOutreachDraft, updateOutreachDraft } from './actions';
import { emptyOutreachState, type OutreachDraft } from './types';

/**
 * Drafts waiting for a person.
 *
 * The specification is unambiguous: no agent sends anything to a third party
 * without a human clicking send. This is where the human is. Generation is
 * automatic; approval is not, and the database refuses to mark anything sent
 * that has no approver recorded against it.
 *
 * Editing an approved draft withdraws the approval — otherwise the step is
 * theatre, because you could approve something bland and rewrite it after.
 */
export function OutreachQueue({
  drafts,
  blockers,
}: {
  drafts: OutreachDraft[];
  blockers: string[];
}) {
  const [editState, editAction] = useActionState(updateOutreachDraft, emptyOutreachState);
  const [approveState, approveAction] = useActionState(approveOutreachDraft, emptyOutreachState);
  const [discardState, discardAction] = useActionState(discardOutreachDraft, emptyOutreachState);

  const pending = drafts.filter((d) => d.status === 'draft' || d.status === 'approved');
  const history = drafts.filter((d) => d.status === 'sent');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outreach</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockers.length > 0 ? (
          <div className="border-warning/30 bg-warning-subtle/60 rounded border p-3">
            <p className="text-text-secondary text-xs font-medium">
              These messages cannot be sent as commercial email yet:
            </p>
            <ul className="text-text-secondary mt-1 list-disc space-y-0.5 pl-4 text-xs">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <p className="text-text-muted mt-2 text-xs">
              These are the two things a commercial message always needs. They are not the whole of
              your obligations — rules vary by state and by channel, and SMS carries consent
              requirements this does not check. Cairn provides the tooling; compliance stays yours.
            </p>
          </div>
        ) : null}

        {pending.length === 0 ? (
          <p className="text-text-muted text-sm">
            No drafts waiting. Draft an introduction to a matched buyer above; it will appear here
            for you to read and approve.
          </p>
        ) : (
          <ul className="space-y-4">
            {pending.map((draft) => (
              <li key={draft.id} className="border-border-subtle border-b pb-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    To {draft.recipientName ?? 'a matched buyer'}
                  </p>
                  <Badge variant={draft.status === 'approved' ? 'success' : 'neutral'}>
                    {draft.status === 'approved' ? 'Approved — ready to send' : 'Draft'}
                  </Badge>
                </div>

                {draft.subject ? (
                  <p className="text-text-muted mt-1 text-xs">Subject: {draft.subject}</p>
                ) : null}

                {draft.status === 'draft' ? (
                  <form action={editAction} className="mt-3 space-y-2">
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="subject" value={draft.subject ?? ''} />
                    <Textarea
                      label="Message"
                      name="body"
                      rows={10}
                      defaultValue={draft.body}
                      maxLength={10_000}
                      hint="Edit freely. Once approved, changing the words withdraws the approval."
                    />
                    <SmallButton label="Save draft" variant="secondary" />
                  </form>
                ) : (
                  // Rendered as text, never as markup — same rule as message bodies.
                  <pre className="border-border-subtle text-text-secondary mt-3 whitespace-pre-wrap rounded border p-3 font-sans text-xs">
                    {draft.body}
                  </pre>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {draft.status === 'draft' ? (
                    <form action={approveAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="draftId" value={draft.id} />
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          name="confirmed"
                          required
                          className="border-border-default text-primary focus-visible:ring-ring h-4 w-4 rounded focus-visible:ring-2"
                        />
                        I have read this message
                      </label>
                      <SmallButton label="Approve" />
                    </form>
                  ) : null}

                  <form action={discardAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <SmallButton label="Discard" variant="ghost" />
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        {history.length > 0 ? (
          <div className="border-border-subtle border-t pt-3">
            <h3 className="text-text-secondary mb-2 text-xs font-medium">Sent</h3>
            <ul className="space-y-1">
              {history.map((draft) => (
                <li key={draft.id} className="text-text-muted flex justify-between gap-4 text-xs">
                  <span>{draft.recipientName ?? 'A matched buyer'}</span>
                  <time dateTime={draft.sentAt ?? ''}>
                    {draft.sentAt ? new Date(draft.sentAt).toLocaleDateString() : ''}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {(editState.error ?? approveState.error ?? discardState.error) ? (
          <p role="alert" className="text-danger text-sm">
            {editState.error ?? approveState.error ?? discardState.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {editState.message ?? approveState.message ?? discardState.message}
        </p>
      </CardContent>
    </Card>
  );
}

function SmallButton({
  label,
  variant = 'primary',
}: {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {label}
    </Button>
  );
}
