'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  buildBoard,
  countPipeline,
  findDuplicate,
} from '@ib/core';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Textarea,
} from '@ib/ui';

import {
  addNote,
  createLead,
  createTask,
  deleteContact,
  emptyCrmState,
  saveContact,
  seedBoard,
  setTaskStatus,
  updateLead,
} from './actions';
import type { CrmContact, CrmLead, CrmNote, CrmStage, CrmTask } from './queries';

/**
 * The CRM's screens.
 *
 * The organising question is "who do I call today", which is why the board and
 * the task list come before the contact table. A CRM that opens on a
 * spreadsheet of everybody you have ever met is a CRM people stop opening.
 */

// ===========================================================================
// The board
// ===========================================================================

export function PipelineBoard({
  stages,
  leads,
  firmId,
}: {
  stages: CrmStage[];
  leads: CrmLead[];
  /** The firm this board was rendered for. Null for a seller with no firm. */
  firmId: string | null;
}) {
  const [state, action] = useActionState(updateLead, emptyCrmState);
  const [seedState, seed] = useActionState(seedBoard, emptyCrmState);

  const counts = countPipeline(stages, leads);

  if (stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No board yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-text-muted text-sm">
            Seven stages, from new to closed. Rename or reorder them later — this is a starting
            point, not a process you have to adopt.
          </p>
          <form action={seed}>
            <FirmField firmId={firmId} />
            <Submit label="Set up my board" />
          </form>
          {seedState.error ? (
            <p role="alert" className="text-danger text-sm">
              {seedState.error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const columns = buildBoard(stages, leads);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Open" value={counts.open} />
        <Stat label="Won" value={counts.won} />
        <Stat label="Closed lost" value={counts.lost} />
        <Stat label="Overdue" value={counts.overdue} emphasis={counts.overdue > 0} />
      </dl>

      <p className="text-text-muted text-xs">
        &ldquo;Overdue&rdquo; is a next action whose date has passed — somebody was promised a call
        that has not happened. No conversion rate here: a percentage computed over three weeks of
        pipeline is a number that gets quoted and means nothing.
      </p>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {columns.map(({ stage, leads: columnLeads }) => (
          <Card key={stage.id}>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle>{stage.name}</CardTitle>
                <span className="text-text-muted text-xs tabular-nums">{columnLeads.length}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {columnLeads.length === 0 ? (
                <p className="text-text-muted text-xs">Nothing here.</p>
              ) : (
                columnLeads.map((lead) => (
                  <div key={lead.id} className="border-border-subtle space-y-2 rounded border p-2">
                    <div>
                      <p className="text-sm font-medium">{lead.contactName}</p>
                      <p className="text-text-muted text-xs">
                        {LEAD_SOURCE_LABELS[lead.source]}
                        {lead.nextActionAt
                          ? ` · next ${new Date(lead.nextActionAt).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>

                    {lead.message ? (
                      // Plain text. Never dangerouslySetInnerHTML — this string
                      // came from a stranger through a public inquiry form.
                      <p className="text-text-secondary whitespace-pre-wrap text-xs">
                        {lead.message}
                      </p>
                    ) : null}

                    {/*
                      Stage and status are separate controls because they are
                      separate facts. The stage is where somebody put the card;
                      the status is what actually became of the lead. Collapsing
                      them would mean a board that has been tidied claims deals
                      that never closed.
                    */}
                    <form action={action} className="flex flex-wrap items-center gap-1">
                      <FirmField firmId={firmId} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <select
                        name="stageId"
                        defaultValue={stage.id}
                        aria-label={`Stage for ${lead.contactName}`}
                        className="border-border-default bg-surface rounded border px-2 py-1 text-xs"
                      >
                        {stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                      <select
                        name="status"
                        defaultValue={lead.status}
                        aria-label={`Status for ${lead.contactName}`}
                        className="border-border-default bg-surface rounded border px-2 py-1 text-xs"
                      >
                        {LEAD_STATUSES.map((option) => (
                          <option key={option} value={option}>
                            {LEAD_STATUS_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      <SmallSubmit label="Save" />
                    </form>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {state.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}
      <p aria-live="polite" className="text-text-muted text-sm">
        {state.message}
      </p>
    </div>
  );
}

// ===========================================================================
// Tasks
// ===========================================================================

export function TaskList({
  tasks,
  contacts,
  firmId,
}: {
  tasks: CrmTask[];
  contacts: CrmContact[];
  firmId: string | null;
}) {
  const [state, action] = useActionState(setTaskStatus, emptyCrmState);
  const [createState, create] = useActionState(createTask, emptyCrmState);

  const open = tasks.filter((task) => task.status === 'open');
  const now = Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {open.length === 0 ? (
          <p className="text-text-muted text-sm">Nothing outstanding.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((task) => {
              const overdue = task.dueAt !== null && new Date(task.dueAt).getTime() < now;
              return (
                <li key={task.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm">{task.title}</p>
                    <p className={overdue ? 'text-danger text-xs' : 'text-text-muted text-xs'}>
                      {task.dueAt
                        ? `${overdue ? 'Overdue · ' : 'Due '}${new Date(task.dueAt).toLocaleDateString()}`
                        : 'No date'}
                    </p>
                  </div>
                  <form action={action}>
                    <FirmField firmId={firmId} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="status" value="done" />
                    <SmallSubmit label="Done" />
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <form action={create} className="border-border-subtle space-y-3 border-t pt-4">
          <Input
            label="New task"
            name="title"
            required
            placeholder="Call Dana back about the LOI"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Due" name="dueAt" type="date" />
            <Select label="About" name="contactId">
              <option value="">Nobody in particular</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.fullName}
                </option>
              ))}
            </Select>
          </div>
          <Submit label="Add task" />
        </form>

        {(state.error ?? createState.error) ? (
          <p role="alert" className="text-danger text-sm">
            {state.error ?? createState.error}
          </p>
        ) : null}
        <p aria-live="polite" className="text-text-muted text-sm">
          {state.message ?? createState.message}
        </p>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Contacts
// ===========================================================================

export function ContactPanel({
  contacts,
  notes,
  firmId,
  notice,
}: {
  contacts: CrmContact[];
  notes: Map<string, CrmNote[]>;
  firmId: string | null;
  /**
   * Set when the contact list did not fit.
   *
   * Passed in rather than derived, because the duplicate check below runs
   * against `contacts` — and on a truncated list it can only say "no duplicate
   * *in what you can see*". Somebody needs to know that before they trust it.
   */
  notice?: string | null;
}) {
  const [state, action] = useActionState(saveContact, emptyCrmState);
  const [removeState, remove] = useActionState(deleteContact, emptyCrmState);
  const [leadState, lead] = useActionState(createLead, emptyCrmState);
  const [noteState, note] = useActionState(addNote, emptyCrmState);

  const [email, setEmail] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Warned about here, refused by the unique index in 0024. The database is
  // what decides; this is so the refusal is not the first the user hears of it.
  const duplicate = findDuplicate(contacts, email);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a contact</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <FirmField firmId={firmId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" name="fullName" required />
              <Input
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={duplicate ? `${duplicate.fullName} already has this address.` : undefined}
              />
              <Input label="Phone" name="phone" />
              <Input label="Company" name="company" />
              <Input label="Title" name="title" />
              <Select label="Kind" name="kind" defaultValue="buyer">
                {CONTACT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CONTACT_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </div>

            {state.error ? (
              <p role="alert" className="text-danger text-sm">
                {state.error}
              </p>
            ) : null}
            <p aria-live="polite" className="text-text-muted text-sm">
              {state.message}
            </p>

            <Submit label="Add" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notice ? (
            <p className="border-warning/40 bg-warning-subtle text-warning rounded border p-2 text-xs">
              {notice} The duplicate check above only sees the contacts listed here.
            </p>
          ) : null}
          {contacts.length === 0 ? (
            <p className="text-text-muted text-sm">
              Nobody yet. A contact does not need an account — most people in a pipeline never sign
              up, and that is the normal case rather than a limitation.
            </p>
          ) : (
            <ul className="space-y-3">
              {contacts.map((contact) => (
                <li key={contact.id} className="border-border-subtle border-b pb-3 last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{contact.fullName}</p>
                      <p className="text-text-muted text-xs">
                        {[contact.email, contact.phone, contact.company]
                          .filter(Boolean)
                          .join(' · ') || 'No details'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{CONTACT_KIND_LABELS[contact.kind]}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpanded(expanded === contact.id ? null : contact.id)}
                      >
                        {expanded === contact.id ? 'Close' : 'Open'}
                      </Button>
                    </div>
                  </div>

                  {expanded === contact.id ? (
                    <div className="mt-3 space-y-3">
                      <form action={lead} className="space-y-2">
                        <FirmField firmId={firmId} />
                        <input type="hidden" name="contactId" value={contact.id} />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Select label="Add as a lead from" name="source" defaultValue="manual">
                            {LEAD_SOURCES.map((source) => (
                              <option key={source} value={source}>
                                {LEAD_SOURCE_LABELS[source]}
                              </option>
                            ))}
                          </Select>
                          <Input label="Next action" name="nextActionAt" type="date" />
                        </div>
                        <SmallSubmit label="Add to pipeline" primary />
                      </form>

                      <div className="space-y-2">
                        {(notes.get(contact.id) ?? []).length > 0 ? (
                          <ul className="border-border-subtle space-y-2 rounded border p-2">
                            {(notes.get(contact.id) ?? []).map((entry) => (
                              <li key={entry.id} className="text-xs">
                                {/*
                                  Plain text. A note can contain anything
                                  somebody typed, and nothing in this product
                                  renders a user string as HTML.
                                */}
                                <p className="whitespace-pre-wrap">{entry.body}</p>
                                <p className="text-text-muted">
                                  {entry.authorName ?? 'Someone'} ·{' '}
                                  {new Date(entry.createdAt).toLocaleDateString()}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        <form action={note} className="space-y-2">
                          <FirmField firmId={firmId} />
                          <input type="hidden" name="contactId" value={contact.id} />
                          <Textarea label="Note" name="body" rows={2} required />
                          <SmallSubmit label="Save note" />
                        </form>
                      </div>

                      <form action={remove}>
                        <FirmField firmId={firmId} />
                        <input type="hidden" name="id" value={contact.id} />
                        <SmallSubmit label="Remove contact" />
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {(removeState.error ?? leadState.error ?? noteState.error) ? (
            <p role="alert" className="text-danger text-sm">
              {removeState.error ?? leadState.error ?? noteState.error}
            </p>
          ) : null}
          <p aria-live="polite" className="text-text-muted text-sm">
            {removeState.message ?? leadState.message ?? noteState.message}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================

/**
 * The firm this form belongs to, carried on the request.
 *
 * Rendered rather than re-derived server-side, because the page already decided
 * and a second derivation could disagree — a broker who switched firms in
 * another tab would otherwise write into whichever one this request resolved.
 *
 * Not a trust boundary: the action checks it against actual membership before
 * writing anything.
 */
function FirmField({ firmId }: { firmId: string | null }) {
  if (!firmId) return null;
  return <input type="hidden" name="firmId" value={firmId} />;
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="border-border-subtle rounded-md border p-3">
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd
        className={
          emphasis
            ? 'text-danger font-mono text-2xl tabular-nums'
            : 'font-mono text-2xl tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

function SmallSubmit({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={primary ? 'primary' : 'secondary'} loading={pending}>
      {label}
    </Button>
  );
}
