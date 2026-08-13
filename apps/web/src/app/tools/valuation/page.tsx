import type { Metadata } from 'next';
import Link from 'next/link';
import { asFraction, asNumber, asString, type Answers, type IndustryKey } from '@ib/core';

import { ValuationForm, type ValuationPrefill } from '@/features/valuation/valuation-form';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Valuation estimate',
  description: 'An indicative valuation range for discussion, with the assumptions shown.',
};

// Reads the saved questionnaire when there is a session, so it cannot be
// prerendered. Still works signed out — the form just starts empty.
export const dynamic = 'force-dynamic';

/**
 * Carries the seller questionnaire's answers into the form.
 *
 * Without this, somebody answers eighteen questions about their business and
 * then lands on a page asking for revenue and earnings again. That is the kind
 * of seam that makes a product feel like several products, and it is the exact
 * moment a seller decides the thing is not worth the effort.
 *
 * Prefilled rather than locked. Every value stays editable, because the
 * questionnaire asked for round numbers and the valuation is worth doing
 * properly — and because a form that will not let you correct it is worse than
 * one that starts empty.
 */
async function loadPrefill(): Promise<ValuationPrefill | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from('questionnaire_responses')
    .select('answers')
    .eq('questionnaire_id', 'seller')
    .maybeSingle();

  const answers = (data as { answers?: Answers } | null)?.answers;
  if (!answers) return null;

  // Same units in both places: the questionnaire collects dollars and percents,
  // and the form does its own conversion to cents and fractions on submit. So
  // this is a stringify, not a conversion.
  const raw = (id: string): string | undefined => {
    const value = asNumber(answers, id);
    return value === null ? undefined : String(value);
  };

  const percent = (id: string): string | undefined => {
    const fraction = asFraction(answers, id);
    return fraction === null ? undefined : String(Math.round(fraction * 100));
  };

  const dependence = asString(answers, 'ownerDependence');

  return {
    industry: (asString(answers, 'industry') as IndustryKey | null) ?? undefined,
    revenue: raw('revenue'),
    earnings: raw('earnings'),
    customerConcentration: percent('customerConcentration'),
    recurringRevenueShare: percent('recurringRevenue'),
    // Growth may be negative and `asFraction` clamps to 0–1, so it is read
    // through `raw` rather than `percent` — a 12% decline must survive.
    revenueGrowth: raw('revenueGrowth'),
    yearsInBusiness: raw('yearsInBusiness'),
    ownerDependence:
      dependence === 'absentee' || dependence === 'moderate' || dependence === 'critical'
        ? dependence
        : undefined,
  };
}

export default async function ValuationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, prefill] = await Promise.all([searchParams, loadPrefill()]);
  const fromQuestionnaire = params.from === 'questionnaire';
  const hasPrefill = prefill !== null && prefill.revenue !== undefined;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">
          {fromQuestionnaire
            ? 'Here is what your business might be worth'
            : 'What might your business be worth?'}
        </h1>
        <p className="text-text-secondary max-w-2xl text-sm">
          {fromQuestionnaire && hasPrefill
            ? 'Filled in from your answers. Every figure is editable — the questionnaire asked for round numbers, and this is worth doing properly. Change anything and the range moves.'
            : 'Several methods, side by side, with every adjustment shown. The range moves as you change the inputs, so you can see which facts about your business are doing the work — and argue with them.'}
        </p>
      </header>

      <ValuationForm prefill={prefill ?? undefined} />

      {fromQuestionnaire ? (
        <p className="text-text-muted text-sm">
          Happy with this?{' '}
          <Link href="/listings/new" className="underline underline-offset-4">
            Start a listing
          </Link>{' '}
          — it begins as a draft that only you can see, and you set the asking price yourself.
        </p>
      ) : null}
    </main>
  );
}
