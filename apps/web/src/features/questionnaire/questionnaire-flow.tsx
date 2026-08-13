'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  nextQuestion,
  previousQuestion,
  progressFor,
  pruneAnswers,
  validateAnswer,
  visibleQuestions,
  type Answer,
  type Answers,
  type Questionnaire,
} from '@ib/core';
import { Button } from '@ib/ui';

import { QuestionScreen } from './question-screen';
import { finishQuestionnaire, saveProgress } from './actions';

/**
 * Drives a questionnaire, one question at a time.
 *
 * State lives here rather than on the server between questions. Round-tripping
 * every answer would put a network delay in front of each click, and the whole
 * reason for asking one at a time is that it feels fast. Progress is saved in
 * the background instead — a fire-and-forget write after each answer, so
 * closing the tab loses at most the current question.
 *
 * The authoritative write happens once at the end, in `finishQuestionnaire`,
 * which maps answers onto the real tables. Everything before that is scratch.
 */
export function QuestionnaireFlow({
  questionnaire,
  initialAnswers,
}: {
  questionnaire: Questionnaire;
  initialAnswers: Answers;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(Object.keys(initialAnswers).length > 0);
  const [submitting, startSubmitting] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Resume at the first unanswered question rather than the beginning.
  useEffect(() => {
    if (currentId === null) {
      setCurrentId(nextQuestion(questionnaire, initialAnswers)?.id ?? null);
    }
  }, [questionnaire, initialAnswers, currentId]);

  const visible = visibleQuestions(questionnaire, answers);
  const question = visible.find((q) => q.id === currentId) ?? null;
  const progress = question ? progressFor(questionnaire, answers, question.id) : null;
  const isLast = question ? visible[visible.length - 1]?.id === question.id : false;

  const persist = useCallback(
    (next: Answers) => {
      // Fire and forget. A failed background save costs the current question,
      // and surfacing it would interrupt somebody mid-flow for something they
      // cannot act on.
      void saveProgress(questionnaire.id, next);
    },
    [questionnaire.id],
  );

  function handleChange(value: Answer) {
    setError(null);
    setAnswers((prev) => ({ ...prev, [question!.id]: value }));
  }

  function handleNext() {
    if (!question) return;

    const value = answers[question.id] ?? null;
    const message = validateAnswer(question, value);
    if (message) {
      setError(message);
      return;
    }

    // Pruned before saving, so an abandoned branch's answers never reach the
    // database and quietly affect matching.
    const pruned = pruneAnswers(questionnaire, answers);
    setAnswers(pruned);
    persist(pruned);
    setError(null);

    const next = nextQuestion(questionnaire, pruned);

    if (next) {
      setCurrentId(next.id);
      return;
    }

    startSubmitting(async () => {
      const result = await finishQuestionnaire(questionnaire.id, pruned);
      if (result.error) {
        setSubmitError(result.error);
        return;
      }
      router.push(result.redirectTo ?? '/dashboard');
    });
  }

  function handleBack() {
    if (!question) return;
    const previous = previousQuestion(questionnaire, answers, question.id);
    if (previous) {
      setError(null);
      setCurrentId(previous.id);
    }
  }

  if (!started) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {questionnaire.title}
          </h1>
          <p className="text-text-secondary max-w-prose">{questionnaire.intro}</p>
        </div>
        <Button size="lg" onClick={() => setStarted(true)}>
          Start
        </Button>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="space-y-4">
        <p className="text-text-secondary text-sm">
          {submitting ? 'Saving your answers…' : 'All done.'}
        </p>
        {submitError ? (
          <p role="alert" className="text-danger text-sm">
            {submitError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {progress ? (
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-valuenow={progress.current}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Questionnaire progress"
            className="bg-surface-sunken h-1 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-primary duration-fast ease-standard h-full transition-all"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <p className="text-text-muted text-xs">
            {progress.current + 1} of {progress.total}
          </p>
        </div>
      ) : null}

      <QuestionScreen
        question={question}
        value={answers[question.id] ?? null}
        onChange={handleChange}
        onNext={handleNext}
        onBack={handleBack}
        canGoBack={previousQuestion(questionnaire, answers, question.id) !== null}
        isLast={isLast}
        error={error}
      />

      {submitError ? (
        <p role="alert" className="text-danger text-sm">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}
