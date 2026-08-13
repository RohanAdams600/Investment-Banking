'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  diffDocuments,
  summariseRevision,
  type DocumentDiff,
  type LegalDocumentKind,
} from '@ib/core';
import {
  AIDisclaimer,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Textarea,
  cn,
} from '@ib/ui';

import { emptyRevisionState, saveRevision } from './revision-actions';

export interface StoredVersion {
  id: string;
  version: number;
  body: string;
  note: string | null;
  createdAt: string;
}

/**
 * Revising a document, and seeing exactly what changed.
 *
 * The redline is the feature. Not "the AI improved your contract" — a claim
 * nobody should make about a legal document — but "here is precisely what is
 * different between these two versions, read it".
 *
 * Which is why the diff renders unchanged lines too, in full. A view that
 * showed only the changes would be shorter and would lose the thing a reader
 * actually needs, which is the changed clause *in context*.
 */
export function RevisionPanel({
  draftId,
  kind,
  currentBody,
  versions,
}: {
  draftId: string;
  kind: LegalDocumentKind;
  currentBody: string;
  versions: StoredVersion[];
}) {
  const [state, action] = useActionState(saveRevision, emptyRevisionState);
  const [draft, setDraft] = useState(currentBody);
  const [compareTo, setCompareTo] = useState<string>(
    versions.length > 0 ? String(versions[0]!.version) : '',
  );

  const baseline = versions.find((v) => String(v.version) === compareTo);
  const diff: DocumentDiff | null = baseline ? diffDocuments(baseline.body, draft) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Revise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={action} className="space-y-3">
            <input type="hidden" name="draftId" value={draftId} />
            <input type="hidden" name="body" value={draft} />

            <Textarea
              label="Document"
              rows={16}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-xs"
              hint="Edit freely. Saving keeps the previous version — nothing is overwritten."
            />

            <Textarea
              label="What changed, and why"
              name="note"
              rows={2}
              maxLength={1000}
              placeholder="Buyer's counsel returned this with the indemnity capped."
              hint="Optional, and worth writing. In four rounds' time this is what tells you why."
            />

            {state.error ? (
              <p role="alert" className="text-danger text-sm">
                {state.error}
              </p>
            ) : null}

            <p aria-live="polite" className="text-text-muted text-sm">
              {state.message}
            </p>

            <SaveButton />
          </form>
        </CardContent>
      </Card>

      {versions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What changed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              label="Compare against"
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.version}>
                  Version {version.version}
                  {version.note ? ` — ${version.note}` : ''} (
                  {new Date(version.createdAt).toLocaleDateString()})
                </option>
              ))}
            </Select>

            {diff ? (
              <>
                <p className="text-text-secondary text-sm">{summariseRevision(diff, kind)}</p>

                {diff.significantRemovals.length > 0 ? (
                  <div className="border-warning/30 bg-warning-subtle/60 rounded border p-3">
                    <p className="text-text-secondary text-xs font-medium">
                      Language removed in this revision:
                    </p>
                    <ul className="text-text-secondary mt-1 flex flex-wrap gap-1.5 text-xs">
                      {diff.significantRemovals.map((removal) => (
                        <li key={removal}>
                          <Badge variant="warning">{removal}</Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="text-text-muted mt-2 text-xs">
                      Flagged because these are the clauses whose quiet disappearance causes
                      disputes. Whether removing them is right for this deal is a question for your
                      attorney, not for us.
                    </p>
                  </div>
                ) : null}

                <DiffView diff={diff} />
              </>
            ) : null}

            <AIDisclaimer variant="legal" />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The redline.
 *
 * Unchanged lines are shown in full rather than collapsed. The reader needs the
 * changed clause in context — a list of altered lines with no surroundings is
 * how people approve a change they would have objected to.
 *
 * Colour is not the only signal. A `+`/`−` gutter and a screen-reader label
 * carry the same information, because roughly one in twelve men cannot rely on
 * red against green.
 */
function DiffView({ diff }: { diff: DocumentDiff }) {
  return (
    <div className="border-border-default max-h-[28rem] overflow-auto rounded border">
      <table className="w-full font-mono text-xs">
        <caption className="sr-only">
          Line-by-line comparison. Added and removed lines are marked in the first column.
        </caption>
        <tbody>
          {diff.lines.map((line, index) => (
            <tr
              key={`${line.kind}-${line.beforeLine ?? ''}-${line.afterLine ?? ''}-${index}`}
              className={cn(
                line.kind === 'added' && 'bg-success-subtle/50',
                line.kind === 'removed' && 'bg-danger-subtle/50',
              )}
            >
              <td className="text-text-muted w-8 select-none border-r px-2 py-0.5 text-right">
                <span aria-hidden>
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
                </span>
                <span className="sr-only">
                  {line.kind === 'added' ? 'Added' : line.kind === 'removed' ? 'Removed' : ''}
                </span>
              </td>
              <td className="text-text-muted w-10 select-none px-2 py-0.5 text-right">
                {line.afterLine ?? line.beforeLine ?? ''}
              </td>
              <td className="whitespace-pre-wrap px-2 py-0.5">{line.text || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Save revision
    </Button>
  );
}
