import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

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

      <PipelineBoard stages={stages} leads={leads} firmId={firmId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskList tasks={tasks} contacts={contacts} firmId={firmId} />
        <ContactPanel contacts={contacts} notes={notes} firmId={firmId} />
      </div>
    </main>
  );
}
