'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CONTACT_KINDS, LEAD_SOURCES, LEAD_STATUSES, can } from '@ib/core';

import { recordAuditEvent } from '@/lib/audit';
import { getActor } from '@/lib/auth/actor';
import { createClient } from '@/lib/supabase/server';

import { resolveFirmScope } from '@/features/firms/firm-scope';

import { crmScope } from './queries';

/**
 * Writes for the CRM.
 *
 * `crm:manage` has been in the capability catalog since step 2 and enforced
 * nowhere. It is checked here, and the firm boundary underneath it is RLS's —
 * two layers answering different questions, as everywhere else: this one says
 * "your role includes keeping a pipeline", the policy says "this row is yours".
 */

export interface CrmState {
  error: string | null;
  message?: string | null;
}

export const emptyCrmState: CrmState = { error: null, message: null };

function fail(error: string): CrmState {
  return { error, message: null };
}

/**
 * The firm this form was rendered for.
 *
 * Carried on every CRM form as a hidden field rather than re-derived here,
 * because the page already resolved it and a second derivation could disagree —
 * a broker who switched firms in another tab would otherwise write into
 * whichever one this request happened to resolve.
 *
 * It is not trusted: `crmContext` checks it against actual membership.
 */
function formDataFirm(formData: FormData): string | null {
  const value = formData.get('firmId');
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Everything here needs the same three things: a session, the capability, and
 * which owner columns to write. Resolved once so a new action cannot forget one
 * — the check that gets skipped is always the one that had to be copied.
 */
async function crmContext(
  requestedFirmId?: string | null,
): Promise<
  { ok: true; userId: string; scope: ReturnType<typeof crmScope> } | { ok: false; state: CrmState }
> {
  const actor = await getActor();
  if (!actor) return { ok: false, state: fail('Sign in first.') };

  if (!can(actor, 'crm:manage')) {
    return { ok: false, state: fail('Your role does not include a pipeline.') };
  }

  /*
   * Which firm this write belongs to.
   *
   * This used to be `actor.firmMemberships[0]` — right for the majority who
   * belong to one firm, and silently wrong for everybody else. A contact filed
   * against the wrong brokerage is visible to that brokerage's brokers, which
   * is a disclosure the person who typed it never made.
   *
   * `resolveFirmScope` reads membership rather than visibility, so a firm id
   * arriving from a form is honoured only if it is genuinely theirs.
   */
  const firm = await resolveFirmScope(requestedFirmId);

  if (firm.mustChoose) {
    return {
      ok: false,
      state: fail('You belong to more than one firm. Choose which one this is for first.'),
    };
  }

  return {
    ok: true,
    userId: actor.userId,
    scope: crmScope(firm.firm?.id ?? null, actor.userId),
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  fullName: z.string().trim().min(1, 'A contact needs a name.').max(200),
  email: z
    .string()
    .trim()
    .max(320)
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null))
    .refine((value) => value === null || /.+@.+\..+/.test(value), 'That is not an email address.'),
  phone: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((value) => value || null),
  company: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || null),
  kind: z.enum(CONTACT_KINDS),
});

export async function saveContact(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const parsed = contactSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email') ?? undefined,
    phone: formData.get('phone') ?? undefined,
    company: formData.get('company') ?? undefined,
    title: formData.get('title') ?? undefined,
    kind: formData.get('kind') ?? 'other',
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const supabase = await createClient();

  const { error } = await supabase.from('contacts').insert({
    ...context.scope,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    company: parsed.data.company,
    title: parsed.data.title,
    kind: parsed.data.kind,
    created_by: context.userId,
  });

  if (error) {
    // 23505 is the dedupe index doing its job. Said as a fact about the
    // pipeline rather than as a database error, because "this person is already
    // in your list" is the useful sentence.
    if (error.code === '23505') {
      return fail(`${parsed.data.email} is already in your contacts.`);
    }
    return fail('Could not save that contact.');
  }

  await recordAuditEvent({
    action: 'crm.contact_created',
    entityType: 'contact',
    firmId: context.scope.firm_id,
    // No name, no email. The audit log is broadly readable by platform admins
    // and gets exported; who a brokerage is talking to is not theirs to read.
    metadata: { kind: parsed.data.kind },
  });

  revalidatePath('/crm');
  return { error: null, message: 'Contact added.' };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteContact(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const parsed = deleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('Not a valid contact.');

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('contacts')
    .delete({ count: 'exact' })
    .eq('id', parsed.data.id);

  if (error) {
    // 23503 is `leads.contact_id on delete restrict`. Tidying a contact that a
    // lead points at has to be deliberate, so the message says what is in the
    // way rather than "could not delete".
    if (error.code === '23503') {
      return fail('That contact has leads attached. Remove or close those first.');
    }
    return fail('Could not remove that contact.');
  }

  if (count === 0) return fail('That contact is not yours to remove.');

  revalidatePath('/crm');
  return { error: null, message: 'Contact removed.' };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const leadSchema = z.object({
  contactId: z.string().uuid('Choose a contact.'),
  source: z.enum(LEAD_SOURCES),
  message: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((value) => value || null),
  nextActionAt: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value).toISOString() : null)),
});

export async function createLead(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const parsed = leadSchema.safeParse({
    contactId: formData.get('contactId'),
    source: formData.get('source') ?? 'manual',
    message: formData.get('message') ?? undefined,
    nextActionAt: formData.get('nextActionAt') ?? undefined,
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const supabase = await createClient();

  // The first stage on the board, so a new lead lands somewhere visible. A lead
  // with no stage is a lead nobody calls.
  const { data: firstStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .order('position')
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('leads').insert({
    ...context.scope,
    contact_id: parsed.data.contactId,
    source: parsed.data.source,
    message: parsed.data.message,
    next_action_at: parsed.data.nextActionAt,
    stage_id: (firstStage as { id?: string } | null)?.id ?? null,
    assigned_to: context.userId,
  });

  if (error) return fail('Could not add that lead.');

  revalidatePath('/crm');
  return { error: null, message: 'Lead added.' };
}

const moveSchema = z.object({
  leadId: z.string().uuid(),
  stageId: z.string().uuid().optional().nullable(),
  status: z.enum(LEAD_STATUSES).optional(),
});

/** Moves a lead along the board, or changes what it is. */
export async function updateLead(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const stageId = formData.get('stageId');
  const status = formData.get('status');

  const parsed = moveSchema.safeParse({
    leadId: formData.get('leadId'),
    stageId: typeof stageId === 'string' && stageId !== '' ? stageId : null,
    status: typeof status === 'string' && status !== '' ? status : undefined,
  });

  if (!parsed.success) return fail('Not a valid change.');

  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.data.stageId !== null) patch.stage_id = parsed.data.stageId;
  if (parsed.data.status) {
    patch.status = parsed.data.status;
    // The constraint requires it, and the constraint is right: "how many
    // inquiries turn into something" has to be answerable from the row.
    if (parsed.data.status === 'converted') patch.converted_at = new Date().toISOString();
    if (parsed.data.status === 'contacted') patch.last_contacted_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change.');

  const { error, count } = await supabase
    .from('leads')
    .update(patch, { count: 'exact' })
    .eq('id', parsed.data.leadId);

  if (error) return fail('Could not update that lead.');
  if (count === 0) return fail('That lead is not yours.');

  revalidatePath('/crm');
  return { error: null, message: 'Updated.' };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  title: z.string().trim().min(1, 'What is the task?').max(300),
  contactId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((value) => value || null),
  leadId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((value) => value || null),
  dueAt: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value).toISOString() : null)),
});

export async function createTask(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const parsed = taskSchema.safeParse({
    title: formData.get('title'),
    contactId: formData.get('contactId'),
    leadId: formData.get('leadId'),
    dueAt: formData.get('dueAt') ?? undefined,
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  const supabase = await createClient();

  const { error } = await supabase.from('crm_tasks').insert({
    ...context.scope,
    title: parsed.data.title,
    contact_id: parsed.data.contactId,
    lead_id: parsed.data.leadId,
    due_at: parsed.data.dueAt,
    assigned_to: context.userId,
    created_by: context.userId,
  });

  if (error) return fail('Could not add that task.');

  revalidatePath('/crm');
  return { error: null, message: 'Task added.' };
}

const taskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['open', 'done', 'cancelled']),
});

export async function setTaskStatus(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const parsed = taskStatusSchema.safeParse({
    taskId: formData.get('taskId'),
    status: formData.get('status'),
  });

  if (!parsed.success) return fail('Not a valid change.');

  const supabase = await createClient();

  // `completed_at` and `completed_by` are the trigger's to write. Sending them
  // from here would be a claim about who did the work.
  const { error, count } = await supabase
    .from('crm_tasks')
    .update({ status: parsed.data.status }, { count: 'exact' })
    .eq('id', parsed.data.taskId);

  if (error) return fail('Could not update that task.');
  if (count === 0) return fail('That task is not yours.');

  revalidatePath('/crm');
  return { error: null, message: parsed.data.status === 'done' ? 'Done.' : 'Updated.' };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const noteSchema = z.object({
  body: z.string().trim().min(1, 'Write something.').max(8000),
  contactId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((value) => value || null),
  leadId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((value) => value || null),
});

export async function addNote(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const parsed = noteSchema.safeParse({
    body: formData.get('body'),
    contactId: formData.get('contactId'),
    leadId: formData.get('leadId'),
  });

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');

  if (!parsed.data.contactId && !parsed.data.leadId) {
    return fail('A note has to be about somebody.');
  }

  const supabase = await createClient();

  const { error } = await supabase.from('crm_notes').insert({
    contact_id: parsed.data.contactId,
    lead_id: parsed.data.leadId,
    author_id: context.userId,
    body: parsed.data.body,
  });

  if (error) return fail('Could not save that note.');

  revalidatePath('/crm');
  return { error: null, message: 'Noted.' };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Gives a firm or a solo seller a working board. Idempotent. */
export async function seedBoard(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const context = await crmContext(formDataFirm(formData));
  if (!context.ok) return context.state;

  const supabase = await createClient();

  const { error } = await supabase.rpc('seed_pipeline_stages', {
    target_firm_id: context.scope.firm_id,
  });

  if (error) return fail('Could not set up the board.');

  revalidatePath('/crm');
  return { error: null, message: 'Board ready.' };
}
