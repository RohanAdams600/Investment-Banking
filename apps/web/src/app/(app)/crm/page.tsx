import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, truncationNotice } from '@ib/core';

import { ContactPanel, PipelineBoard, TaskList } from '@/features/crm/crm-panels';
import { listContacts, listLeads, listNotes, listStages, listTasks } from '@/features/crm/queries';
import { FirmBadge, FirmPicker } from '@/features/firms/firm-picker';
import { resolveFirmScope } from '@/features/firms/firm-scope';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Pipeline',
  // A brokerage's pipeline is its business.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string }>;
}) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');
  if (!can(actor, 'crm:manage')) redirect('/dashboard');

  const { firm: requestedFirm } = await searchParams;
  const scope = await resolveFirmScope(requestedFirm);

  /*
   * A broker at two brokerages says which before anything loads.
   *
   * Not only before writing: the pipeline itself is different per firm, and
   * showing one firm's board while a form quietly posts to the other is worse
   * than asking. RLS admits both firms' rows to this person, so the database
   * cannot make this choice for them — it is genuinely theirs to make.
   */
  if (scope.mustChoose) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-6">
        <FirmPicker options={scope.options} basePath="/crm" what="your pipeline" />
      </main>
    );
  }

  const firmId = scope.firm?.id ?? null;

  const [stages, leads, contacts, tasks, notes] = await Promise.all([
    listStages(),
    listLeads(),
    listContacts(),
    listTasks(),
    listNotes(),
  ]);

  const notices = [
    truncationNotice(leads, 'leads'),
    truncationNotice(contacts, 'contacts'),
    truncationNotice(tasks, 'tasks'),
  ].filter((notice): notice is string => notice !== null);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Pipeline</h1>
        <p className="text-text-muted text-sm">
          {actor.firmMemberships.length > 0
            ? 'Shared with everyone at your firm. Nobody outside it can see any of this.'
            : 'Yours alone. Nobody else can see any of this.'}
        </p>
      </header>

      {scope.firm ? <FirmBadge firm={scope.firm} options={scope.options} basePath="/crm" /> : null}

      {/*
        One notice rather than three. The page holds four capped lists, and a
        warning stripe over each of them would be read as decoration by the
        second one — which is how a warning stops working.
      */}
      {notices.length > 0 ? (
        <div className="border-warning/40 bg-warning-subtle text-warning space-y-1 rounded border p-3 text-sm">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
      ) : null}

      <PipelineBoard stages={stages} leads={leads.rows} firmId={firmId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskList tasks={tasks.rows} contacts={contacts.rows} firmId={firmId} />
        <ContactPanel
          contacts={contacts.rows}
          notes={notes}
          firmId={firmId}
          truncated={contacts.truncated}
        />
      </div>
    </main>
  );
}
