import type { Answer, Answers, Question, Questionnaire, QuestionnaireProgress } from './types';

/**
 * Walking a questionnaire.
 *
 * Pure functions over `(questionnaire, answers)`. No state of its own, which is
 * what makes it testable and what lets a half-finished questionnaire be stored
 * as a plain object and resumed later — including on a different device.
 *
 * The subtle part is that **the question set changes as it is answered.** A
 * buyer who says they want to run the business themselves gets asked about
 * relocation; one buying through a fund does not. So "question 4 of 9" is
 * computed from the answers rather than fixed, and the total can move while
 * somebody is partway through.
 *
 * That is honest rather than annoying: the alternative is padding the count
 * with questions nobody will be asked, which makes the progress bar a lie in
 * the other direction.
 */

/** The questions that apply given what has been answered so far. */
export function visibleQuestions(questionnaire: Questionnaire, answers: Answers): Question[] {
  return questionnaire.questions.filter((question) => !question.when || question.when(answers));
}

/**
 * The next question needing an answer, or null when the questionnaire is done.
 *
 * Skips anything already answered, so resuming lands on the first gap rather
 * than making somebody click through what they have already told us.
 */
export function nextQuestion(questionnaire: Questionnaire, answers: Answers): Question | null {
  return visibleQuestions(questionnaire, answers).find((q) => !isAnswered(q, answers)) ?? null;
}

export function questionById(questionnaire: Questionnaire, id: string): Question | null {
  return questionnaire.questions.find((q) => q.id === id) ?? null;
}

/** The question before `id` among those currently applicable. */
export function previousQuestion(
  questionnaire: Questionnaire,
  answers: Answers,
  id: string,
): Question | null {
  const visible = visibleQuestions(questionnaire, answers);
  const index = visible.findIndex((q) => q.id === id);
  return index > 0 ? (visible[index - 1] ?? null) : null;
}

export function progressFor(
  questionnaire: Questionnaire,
  answers: Answers,
  currentId: string,
): QuestionnaireProgress {
  const visible = visibleQuestions(questionnaire, answers);
  const index = visible.findIndex((q) => q.id === currentId);
  const current = index === -1 ? visible.length : index;

  return {
    current,
    total: visible.length,
    // Guard against a zero-question questionnaire producing NaN, which renders
    // as a blank progress bar rather than an obvious error.
    fraction: visible.length === 0 ? 1 : current / visible.length,
  };
}

/**
 * Whether a question has a usable answer.
 *
 * An empty string and an empty array both count as unanswered — a `multi`
 * question with nothing selected has not been answered, it has been skipped.
 * Zero and `false` are answers and are treated as such.
 */
export function isAnswered(question: Question, answers: Answers): boolean {
  const value = answers[question.id];

  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function isComplete(questionnaire: Questionnaire, answers: Answers): boolean {
  return visibleQuestions(questionnaire, answers)
    .filter((q) => q.required)
    .every((q) => isAnswered(q, answers));
}

/**
 * Validates one answer.
 *
 * Returns a sentence to show, or null when the answer is fine. Messages are
 * written to be read directly by the person who just typed something — no
 * field names, no "invalid input".
 */
export function validateAnswer(question: Question, value: Answer): string | null {
  const empty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);

  if (empty) {
    return question.required ? 'This one is needed to carry on.' : null;
  }

  if (question.type === 'multi') {
    if (!Array.isArray(value)) return 'Choose at least one.';
    if (question.maxSelections && value.length > question.maxSelections) {
      return `Choose up to ${question.maxSelections}.`;
    }
    const allowed = new Set((question.options ?? []).map((o) => o.value));
    if (value.some((v) => !allowed.has(v))) return 'That is not one of the options.';
    return null;
  }

  if (question.type === 'single') {
    const allowed = new Set((question.options ?? []).map((o) => o.value));
    if (typeof value !== 'string' || !allowed.has(value)) return 'Choose one of the options.';
    return null;
  }

  if (
    question.type === 'money' ||
    question.type === 'number' ||
    question.type === 'percent' ||
    question.type === 'scale'
  ) {
    const numeric =
      typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));

    if (!Number.isFinite(numeric)) return 'Enter a number.';
    if (question.type === 'money' && numeric < 0) return 'Enter a positive amount.';
    if (question.min !== undefined && numeric < question.min) {
      return `Enter ${question.min} or more.`;
    }
    if (question.max !== undefined && numeric > question.max) {
      return `Enter ${question.max} or less.`;
    }
    return null;
  }

  if (typeof value !== 'string') return 'Enter an answer.';
  if (question.max !== undefined && value.length > question.max) {
    return `Keep it under ${question.max} characters.`;
  }

  return null;
}

/**
 * Drops answers to questions that are no longer asked.
 *
 * Going back and changing an answer can close a branch. Without this, the
 * abandoned answers stay in the object and get written to the database — so a
 * buyer who switched from "I will run it myself" to "through a fund" would
 * still carry a relocation preference nobody asked them about, and it would
 * quietly affect their matches.
 */
export function pruneAnswers(questionnaire: Questionnaire, answers: Answers): Answers {
  const visible = new Set(visibleQuestions(questionnaire, answers).map((q) => q.id));

  return Object.fromEntries(Object.entries(answers).filter(([id]) => visible.has(id)));
}

/** Reads an answer as a string, for the single-choice and text types. */
export function asString(answers: Answers, id: string): string | null {
  const value = answers[id];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Reads an answer as a string array, for the multi type. */
export function asArray(answers: Answers, id: string): string[] {
  const value = answers[id];
  return Array.isArray(value) ? value : [];
}

/** Reads a numeric answer. Returns null rather than NaN for anything unusable. */
export function asNumber(answers: Answers, id: string): number | null {
  const value = answers[id];
  if (value === null || value === undefined || Array.isArray(value)) return null;

  const numeric =
    typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

/** Dollars in the questionnaire, integer cents everywhere else. */
export function asCents(answers: Answers, id: string): number | null {
  const dollars = asNumber(answers, id);
  return dollars === null ? null : Math.round(dollars * 100);
}

/** Percent in the questionnaire, 0–1 fraction everywhere else. */
export function asFraction(answers: Answers, id: string): number | null {
  const percent = asNumber(answers, id);
  if (percent === null) return null;
  return Math.min(1, Math.max(0, percent / 100));
}
