'use server';

import { revalidatePath } from 'next/cache';
import {
  BUYER_QUESTIONNAIRE,
  SELLER_QUESTIONNAIRE,
  asArray,
  asCents,
  asFraction,
  asNumber,
  asString,
  isComplete,
  priorAcquisitionsFrom,
  type Answers,
  type Questionnaire,
} from '@ib/core';

import { recomputeMatchesForBuyer } from '@/features/matching/recompute';
import { recordAuditEvent } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';

/**
 * Saving and finishing a questionnaire.
 *
 * `saveProgress` writes scratch. `finishQuestionnaire` maps the answers onto
 * the tables the product actually reads — `acquisition_criteria`,
 * `buyer_profiles`, `seller_preferences` — and that mapping lives here, in one
 * place, rather than being spread across the question definitions.
 *
 * The separation matters more than it looks. Question wording changes often;
 * the shape matching runs on should not change with it. Keeping the mapping
 * explicit means renaming a question or rewording an option is a content edit,
 * and only an edit to this file changes what the platform computes.
 */

export interface QuestionnaireResult {
  error: string | null;
  redirectTo?: string;
}

const QUESTIONNAIRES: Record<string, Questionnaire> = {
  buyer: BUYER_QUESTIONNAIRE,
  seller: SELLER_QUESTIONNAIRE,
};

/**
 * Background save after each answer.
 *
 * Returns nothing useful on purpose: the caller does not await it, and a failed
 * background write costs the current question rather than interrupting somebody
 * mid-flow with an error they cannot act on.
 */
export async function saveProgress(questionnaireId: string, answers: Answers): Promise<void> {
  if (!QUESTIONNAIRES[questionnaireId]) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  await supabase.from('questionnaire_responses').upsert(
    {
      user_id: user.id,
      questionnaire_id: questionnaireId,
      answers,
    },
    { onConflict: 'user_id,questionnaire_id' },
  );
}

export async function finishQuestionnaire(
  questionnaireId: string,
  answers: Answers,
): Promise<QuestionnaireResult> {
  const questionnaire = QUESTIONNAIRES[questionnaireId];
  if (!questionnaire) return { error: 'That questionnaire does not exist.' };

  if (!isComplete(questionnaire, answers)) {
    return { error: 'Some required answers are still missing.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to save your answers.' };

  const result =
    questionnaireId === 'buyer'
      ? await applyBuyerAnswers(user.id, answers)
      : await applySellerAnswers(user.id, answers);

  if (result.error) return result;

  await supabase
    .from('questionnaire_responses')
    .update({ completed_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('questionnaire_id', questionnaireId);

  await recordAuditEvent({
    action: 'questionnaire.completed',
    entityType: 'questionnaire',
    entityId: questionnaireId,
  });

  revalidatePath('/dashboard');
  return result;
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------

async function applyBuyerAnswers(userId: string, answers: Answers): Promise<QuestionnaireResult> {
  const supabase = await createClient();

  const geography = asString(answers, 'geography');
  // A national buyer has no state list, and an empty array means "anywhere"
  // rather than "nowhere" — the same convention the scorer uses.
  const jurisdictions = geography === 'national' ? [] : asArray(answers, 'states');

  const involvement = asString(answers, 'involvement') ?? 'either';
  const structure = asString(answers, 'structure') ?? 'either';

  // Criteria are superseded rather than updated, so a buyer can see that their
  // recommendations changed because they changed what they asked for.
  const { error: supersedeError } = await supabase
    .from('acquisition_criteria')
    .update({ superseded_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('superseded_at', null);

  if (supersedeError) return { error: 'Could not save your criteria.' };

  const { error } = await supabase.from('acquisition_criteria').insert({
    user_id: userId,
    industries: asArray(answers, 'industries'),
    jurisdictions,
    revenue_min_cents: asCents(answers, 'revenueMin'),
    revenue_max_cents: asCents(answers, 'revenueMax'),
    earnings_min_cents: asCents(answers, 'earningsMin'),
    deal_size_max_cents: asCents(answers, 'dealSizeMax'),
    deal_structure: structure,
    involvement,
    max_customer_concentration: asFraction(answers, 'maxConcentration'),
    thesis: asString(answers, 'thesis'),
  });

  if (error) return { error: 'Could not save your criteria.' };

  const { error: profileError } = await supabase.from('buyer_profiles').upsert(
    {
      user_id: userId,
      entity_name: asString(answers, 'entityName'),
      funding_source: fundingLabel(asString(answers, 'fundingSource')),
      prior_acquisitions: priorAcquisitionsFrom(answers),
    },
    { onConflict: 'user_id' },
  );

  if (profileError) return { error: 'Could not save your profile.' };

  // Score them against the market immediately. Landing on an empty match page
  // after answering fourteen questions is the wrong first impression, and this
  // is the moment the answers are freshest.
  await recomputeMatchesForBuyer(userId);

  return { error: null, redirectTo: '/matches' };
}

/** The stored funding label, from the questionnaire's option value. */
function fundingLabel(value: string | null): string | null {
  if (!value) return null;

  return (
    {
      cash: 'Cash',
      sba: 'SBA loan',
      conventional: 'Bank debt',
      fund: 'Committed fund capital',
      seller: 'Mostly seller financing',
      undecided: 'Still deciding',
    }[value] ?? null
  );
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

async function applySellerAnswers(userId: string, answers: Answers): Promise<QuestionnaireResult> {
  const supabase = await createClient();

  const { error } = await supabase.from('seller_preferences').upsert(
    {
      user_id: userId,
      acceptable_buyer_types: asArray(answers, 'buyerTypes'),
      employee_priority: asNumber(answers, 'employeePriority') ?? 3,
      legacy_priority: asNumber(answers, 'legacyPriority') ?? 3,
      confidentiality_concern: asNumber(answers, 'confidentialityConcern') ?? 3,
      transition: asString(answers, 'transition') ?? 'months',
      seller_financing: asString(answers, 'sellerFinancing') ?? 'open',
      timeline: asString(answers, 'timeline') ?? 'six_months',
      sale_reason: asString(answers, 'sellReason'),
    },
    { onConflict: 'user_id' },
  );

  if (error) return { error: 'Could not save your preferences.' };

  // The business answers go to the valuation page rather than into a listing.
  // A seller should see what the business is worth before deciding to publish
  // anything — and many people take the questionnaire only to find that out.
  return { error: null, redirectTo: '/tools/valuation?from=questionnaire' };
}
