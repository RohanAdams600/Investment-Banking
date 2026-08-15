import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BUYER_QUESTIONNAIRE, SELLER_QUESTIONNAIRE, can, type Answers } from '@ib/core';

import { QuestionnaireFlow } from '@/features/questionnaire/questionnaire-flow';
import { getActor } from '@/lib/auth/actor';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'A few questions',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const FLOWS = {
  buyer: BUYER_QUESTIONNAIRE,
  seller: SELLER_QUESTIONNAIRE,
} as const;

export default async function QuestionnairePage({ params }: { params: Promise<{ flow: string }> }) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const { flow } = await params;
  const questionnaire = FLOWS[flow as keyof typeof FLOWS];
  if (!questionnaire) notFound();

  // Offering the buyer questionnaire to somebody who cannot buy would end in a
  // failed write fourteen questions later.
  const allowed = flow === 'buyer' ? can(actor, 'listing:view_full') : can(actor, 'listing:create');
  if (!allowed) redirect('/dashboard');

  const supabase = await createClient();
  const { data } = await supabase
    .from('questionnaire_responses')
    .select('answers')
    .eq('questionnaire_id', flow)
    .maybeSingle();

  const initialAnswers = ((data as { answers?: Answers } | null)?.answers ?? {}) as Answers;

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-2xl flex-col justify-center px-6 py-12">
      <QuestionnaireFlow questionnaire={questionnaire} initialAnswers={initialAnswers} />
    </main>
  );
}
