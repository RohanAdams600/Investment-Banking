'use client';

import { useActionState, useState, useTransition, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_HINTS,
  DOCUMENT_VISIBILITY_LABELS,
  DocumentRejected,
  assertAcceptable,
  formatBytes,
  visibilityWarning,
  type DocumentCategory,
  type DocumentVisibility,
} from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@ib/ui';

import {
  emptyVaultState,
  releaseDocument,
  requestDocumentUrl,
  revokeDocumentAccess,
  startDocumentUpload,
  withdrawDocument,
  type VaultState,
} from './actions';
import type { AccessEntry, DocumentRelease, RoomMember, VaultDocument } from './queries';

/**
 * The vault, from the side that has to decide who sees what.
 *
 * The screen is built around one question, because it is the question that goes
 * wrong: not "is this file uploaded" but "who can open it". So visibility is
 * chosen at upload rather than afterwards, every document says in words who can
 * read it, and releasing names a person from the room rather than asking for an
 * identifier.
 */

// ===========================================================================
// Upload
// ===========================================================================

/**
 * Two steps, and the second one is the file.
 *
 * `startDocumentUpload` reserves the row and hands back a one-shot URL; the
 * browser then PUTs the bytes straight to storage. That ordering keeps a 100 MB
 * diligence pack out of the serverless function's memory and execution budget,
 * and the storage policy re-checks on insert so the URL alone authorises
 * nothing.
 *
 * It is a plain submit handler rather than `useActionState`, because the action
 * is the first half of the work and the form has to keep going afterwards. A
 * form that submitted and stopped would leave a row pointing at a file that was
 * never uploaded.
 */
export function UploadPanel({ dealId, firmId }: { dealId: string; firmId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [state, setState] = useState<VaultState>(emptyVaultState);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>('financial_statement');
  const [visibility, setVisibility] = useState<DocumentVisibility>('restricted');
  const [clientError, setClientError] = useState<string | null>(null);

  const warning = visibilityWarning(category, visibility);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    const formData = new FormData(event.currentTarget);

    start(async () => {
      setClientError(null);
      const reserved = await startDocumentUpload(emptyVaultState, formData);
      setState(reserved);

      if (reserved.error || !reserved.upload) return;

      const response = await fetch(reserved.upload.url, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });

      if (!response.ok) {
        // The row is there and the object is not. Said plainly rather than
        // cleaned up behind the user's back: they can see the entry, and
        // withdrawing it is a decision they can make.
        setState({
          error: 'The entry was created but the file did not upload. Withdraw it and try again.',
          message: null,
          upload: null,
        });
        router.refresh();
        return;
      }

      setState({ error: null, message: 'Added to the room.', upload: null });
      setFile(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a document</CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="dealId" value={dealId} />
          {firmId ? <input type="hidden" name="firmId" value={firmId} /> : null}
          <input type="hidden" name="fileName" value={file?.name ?? ''} />
          <input type="hidden" name="contentType" value={file?.type ?? ''} />
          <input type="hidden" name="sizeBytes" value={file?.size ?? 0} />

          <div className="space-y-1.5">
            <label htmlFor="vault-file" className="text-text-primary block text-sm font-medium">
              File
            </label>
            <input
              id="vault-file"
              type="file"
              className="text-text-secondary file:border-border-default file:bg-surface file:text-text-primary block w-full text-sm file:mr-3 file:rounded file:border file:px-3 file:py-1.5 file:text-sm"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setClientError(null);

                if (chosen) {
                  try {
                    // Checked before anything moves, so a 90 MB file that was
                    // never going to be accepted fails in the same second it
                    // was chosen rather than at the end of the upload.
                    assertAcceptable(chosen);
                  } catch (thrown) {
                    setClientError(
                      thrown instanceof DocumentRejected
                        ? thrown.message
                        : 'That file was not accepted.',
                    );
                    setFile(null);
                    return;
                  }
                }

                setFile(chosen);
              }}
            />
            {file ? (
              <p className="text-text-muted text-xs">
                {file.name} · {formatBytes(file.size)}
              </p>
            ) : null}
          </div>

          <Input
            label="Title"
            name="title"
            required
            defaultValue=""
            placeholder="FY2025 federal return"
            hint="What the other side will see in the list."
          />

          <Select
            label="Category"
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value as DocumentCategory)}
          >
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>

          <Select
            label="Who can open it"
            name="visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as DocumentVisibility)}
            hint={DOCUMENT_VISIBILITY_HINTS[visibility]}
          >
            {DOCUMENT_VISIBILITIES.map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_VISIBILITY_LABELS[value]}
              </option>
            ))}
          </Select>

          {warning ? (
            <p className="border-warning/30 bg-warning-subtle text-warning rounded border p-3 text-xs">
              {warning}
            </p>
          ) : null}

          {(clientError ?? state.error) ? (
            <p role="alert" className="text-danger text-sm">
              {clientError ?? state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <Button type="submit" loading={pending} disabled={!file}>
            Add to the room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// The list
// ===========================================================================

export function DocumentList({
  dealId,
  documents,
  members,
  viewerId,
  canRelease,
}: {
  dealId: string;
  documents: VaultDocument[];
  members: RoomMember[];
  viewerId: string;
  canRelease: boolean;
}) {
  if (documents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing here yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-muted text-sm">
            Documents added to this room appear here. You see the ones released to you — anything
            released to somebody else is not hidden from you so much as absent, because the database
            never sends it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const live = documents.filter((d) => !d.withdrawnAt && !d.supersededAt);
  const past = documents.filter((d) => d.withdrawnAt || d.supersededAt);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {live.map((document) => (
          <DocumentCard
            key={document.id}
            dealId={dealId}
            document={document}
            members={members}
            viewerId={viewerId}
            canRelease={canRelease}
          />
        ))}
      </div>

      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-text-secondary text-sm font-medium">Withdrawn and superseded</h2>
          <p className="text-text-muted text-xs">
            Kept because a data room is a record of what was disclosed and when it was pulled. Only
            your side can see these.
          </p>
          {past.map((document) => (
            <DocumentCard
              key={document.id}
              dealId={dealId}
              document={document}
              members={members}
              viewerId={viewerId}
              canRelease={false}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function DocumentCard({
  dealId,
  document,
  members,
  viewerId,
  canRelease,
}: {
  dealId: string;
  document: VaultDocument;
  members: RoomMember[];
  viewerId: string;
  canRelease: boolean;
}) {
  const mine = document.uploadedBy === viewerId;
  const inactive = Boolean(document.withdrawnAt || document.supersededAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{document.title}</CardTitle>
            <p className="text-text-muted mt-1 text-xs">
              {document.fileName} · {formatBytes(document.sizeBytes)} ·{' '}
              {document.uploaderName ?? 'Unknown'} ·{' '}
              {new Date(document.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{DOCUMENT_CATEGORY_LABELS[document.category]}</Badge>
            <Badge variant={document.visibility === 'deal' ? 'warning' : 'neutral'}>
              {DOCUMENT_VISIBILITY_LABELS[document.visibility]}
            </Badge>
            {document.withdrawnAt ? <Badge variant="danger">Withdrawn</Badge> : null}
            {document.supersededAt ? <Badge variant="neutral">Superseded</Badge> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {document.withdrawnReason ? (
          <p className="text-text-secondary text-sm">Withdrawn: {document.withdrawnReason}</p>
        ) : null}

        {!inactive ? <DownloadButton documentId={document.id} /> : null}

        {mine && canRelease && !inactive ? (
          <ReleaseControls dealId={dealId} document={document} members={members} />
        ) : null}

        {mine ? (
          <AccessLog entries={document.openedBy} complete={document.accessLogComplete} />
        ) : null}

        {mine && !inactive ? <WithdrawControls dealId={dealId} documentId={document.id} /> : null}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Download
// ===========================================================================

function DownloadButton({ documentId }: { documentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            setNeedsStepUp(false);
            const result = await requestDocumentUrl(documentId);
            if (result.error || !result.url) {
              setError(result.error ?? 'That document could not be opened.');
              setNeedsStepUp(result.needsStepUp === true);
              return;
            }
            window.location.href = result.url;
          })
        }
      >
        Open
      </Button>

      {error ? (
        <p role="alert" className="text-danger text-xs">
          {error}{' '}
          {needsStepUp ? (
            // A dead end otherwise: the message says "confirm with your
            // authenticator" and there is nowhere on this page to do it.
            <Link href="/settings/security" className="underline underline-offset-4">
              Confirm now
            </Link>
          ) : null}
        </p>
      ) : null}

      <p className="text-text-muted text-xs">
        Opening is recorded, and the uploader can see it. The link expires in a minute.
      </p>
    </div>
  );
}

// ===========================================================================
// Release
// ===========================================================================

function ReleaseControls({
  dealId,
  document,
  members,
}: {
  dealId: string;
  document: VaultDocument;
  members: RoomMember[];
}) {
  const [releaseState, release] = useActionState(releaseDocument, emptyVaultState);
  const [revokeState, revoke] = useActionState(revokeDocumentAccess, emptyVaultState);

  const live = document.releasedTo.filter((r) => !r.revokedAt);
  const past = document.releasedTo.filter((r) => r.revokedAt);

  const candidates = members.filter(
    (member) =>
      member.userId !== document.uploadedBy && !live.some((r) => r.granteeId === member.userId),
  );

  return (
    <div className="border-border-subtle space-y-3 rounded border p-3">
      <h3 className="text-text-secondary text-xs font-medium">Released to</h3>

      {document.visibility === 'deal' ? (
        <p className="text-text-muted text-xs">
          This document is open to everyone in the room, so naming people changes nothing. Change it
          to &ldquo;only the people I name&rdquo; first.
        </p>
      ) : document.visibility === 'private' ? (
        <p className="text-text-muted text-xs">
          This document is staged. Nobody on the other side can see it, or see that it exists —
          naming somebody will not release it until you change that.
        </p>
      ) : null}

      {live.length === 0 ? (
        <p className="text-text-muted text-xs">Nobody yet.</p>
      ) : (
        <ul className="space-y-1">
          {live.map((entry) => (
            <li key={entry.granteeId} className="flex items-center justify-between gap-3 text-xs">
              <span>
                {entry.granteeName ?? 'Unnamed'} ·{' '}
                <span className="text-text-muted">
                  {new Date(entry.grantedAt).toLocaleDateString()}
                </span>
              </span>
              <form action={revoke}>
                <input type="hidden" name="documentId" value={document.id} />
                <input type="hidden" name="granteeId" value={entry.granteeId} />
                <input type="hidden" name="dealId" value={dealId} />
                <SmallSubmit label="Withdraw" />
              </form>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 ? (
        <form action={release} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="documentId" value={document.id} />
          <input type="hidden" name="dealId" value={dealId} />
          <div className="min-w-48 flex-1">
            <Select label="Release to" name="granteeId">
              {candidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name ?? 'Unnamed'} ({member.role})
                </option>
              ))}
            </Select>
          </div>
          <SmallSubmit label="Release" primary />
        </form>
      ) : null}

      {past.length > 0 ? (
        <p className="text-text-muted text-xs">
          Previously released to {past.map((p) => p.granteeName ?? 'someone').join(', ')}. Withdrawn
          access stays on record — anything already downloaded stays downloaded.
        </p>
      ) : null}

      {(releaseState.error ?? revokeState.error) ? (
        <p role="alert" className="text-danger text-xs">
          {releaseState.error ?? revokeState.error}
        </p>
      ) : null}

      <p aria-live="polite" className="text-text-muted text-xs">
        {releaseState.message ?? revokeState.message}
      </p>
    </div>
  );
}

// ===========================================================================
// Who opened it
// ===========================================================================

/**
 * The panel's promise, kept.
 *
 * Every card tells the reader "opening is recorded, and the uploader can see
 * it". This is where the uploader sees it — and it is the single most requested
 * thing a seller wants from a data room, because it is what makes releasing a
 * tax return survivable at all.
 *
 * Precise about the claim, in the same words the storage layer uses: a link was
 * issued to this person at this time. Not that the file was read, and not where
 * it went afterwards. No system can tell you that, and implying otherwise would
 * be worse than saying nothing.
 */
function AccessLog({
  entries,
  complete,
}: {
  entries: DocumentRelease[] | AccessEntry[];
  /**
   * Whether the log this came from was the whole log.
   *
   * The empty state below is a claim about the world — "nobody has opened it" —
   * and the query behind it fetches the newest 500 events across every document
   * in the room. On a busy data room an older document's reads fall outside
   * that window, and the card would say nobody looked when somebody did. That
   * is the wrong way for a confidentiality surface to be wrong.
   */
  complete: boolean;
}) {
  const log = entries as AccessEntry[];

  return (
    <div className="border-border-subtle space-y-2 rounded border p-3">
      <h3 className="text-text-secondary text-xs font-medium">Opened by</h3>

      {log.length === 0 ? (
        <p className="text-text-muted text-xs">
          {complete
            ? 'Nobody has opened it yet.'
            : 'Nothing recent. This deal room has more activity than one page of log, so older opens are not shown here.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {log.slice(0, 10).map((entry) => (
            <li key={entry.id} className="flex justify-between gap-3 text-xs">
              <span>
                {entry.actorName ?? 'Unnamed'}
                {/*
                  A refused request is the interesting row. A run of them
                  against one document is somebody probing.
                */}
                {entry.action === 'denied' ? <span className="text-danger"> · refused</span> : null}
              </span>
              <span className="text-text-muted tabular-nums">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {log.length > 10 ? (
        <p className="text-text-muted text-xs">and {log.length - 10} earlier.</p>
      ) : null}

      <p className="text-text-muted text-xs">
        A link was issued to each of these people at that time. Whether they read the file, and
        where it went afterwards, is not something any system can tell you.
      </p>
    </div>
  );
}

// ===========================================================================
// Withdrawal
// ===========================================================================

function WithdrawControls({ dealId, documentId }: { dealId: string; documentId: string }) {
  const [state, action] = useActionState(withdrawDocument, emptyVaultState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Withdraw
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="dealId" value={dealId} />
      <Input
        label="Why (optional)"
        name="reason"
        placeholder="Replaced by the audited version"
        hint="Withdrawing is one-way. It stops further access; it does not recall anything already downloaded."
      />
      <div className="flex gap-2">
        <SmallSubmit label="Withdraw it" />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-danger text-xs">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

// ===========================================================================

function SmallSubmit({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={primary ? 'primary' : 'secondary'} loading={pending}>
      {label}
    </Button>
  );
}
