import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@ib/core';

import { ContactPanel, PipelineBoard, TaskList } from '@/features/crm/crm-panels';
import { listContacts, listLeads, listStages, listTasks } from '@/features/crm/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Pipeline',
  // A brokerage's pipeline is its business.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');
  if (!can(actor, 'crm:manage')) redirect('/dashboard');

  const [stages, leads, contacts, tasks] = await Promise.all([
    listStages(),
    listLeads(),
    listContacts(),
    listTasks(),
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

      <PipelineBoard stages={stages} leads={leads} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskList tasks={tasks} contacts={contacts} />
        <ContactPanel contacts={contacts} />
      </div>
    </main>
  );
}
