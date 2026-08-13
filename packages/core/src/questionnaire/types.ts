/**
 * Questionnaire model.
 *
 * One question per screen. That is a product decision with a cost — more
 * clicks — and it buys two things worth more than the clicks:
 *
 *   1. **Answer quality.** A twenty-field form gets skimmed and half-filled. A
 *      single question gets read. Everything downstream — matching, valuation,
 *      the AI thesis read — is only as good as what people actually tell us,
 *      and a form that produces shallow answers produces a shallow product.
 *   2. **Branching that makes sense.** Asking a private-equity fund about SBA
 *      financing wastes their time and tells them we were not listening. One
 *      question at a time makes it natural to skip what does not apply.
 *
 * The definitions live here, framework-free, so the same question set drives
 * the web flow, a future mobile app, and the tests — and so the questions can
 * be reviewed as content rather than read out of JSX.
 */

export type QuestionType =
  'single' | 'multi' | 'money' | 'number' | 'percent' | 'text' | 'longtext' | 'scale';

export interface QuestionOption {
  value: string;
  label: string;
  /** Shown under the label. Use it to explain a term, not to sell the option. */
  description?: string;
}

/** An answer to one question. Shape depends on the question type. */
export type Answer = string | string[] | number | null;

export type Answers = Record<string, Answer>;

export interface Question {
  id: string;
  type: QuestionType;

  /** The question itself, in plain language. Second person, no jargon. */
  prompt: string;

  /**
   * Why we are asking.
   *
   * Shown on every question, and not optional in spirit even though the type
   * allows it. People disclose more when they know what a figure is for, and
   * "we use this to rank listings for you — sellers never see it" is the
   * difference between a real answer and a round number.
   */
  help?: string;

  placeholder?: string;
  options?: QuestionOption[];

  /** Unanswered questions block progress only when this is true. */
  required?: boolean;

  /** Bounds for `number`, `money`, `percent` and `scale`. */
  min?: number;
  max?: number;

  /** For `multi`. Forces prioritisation instead of "all of the above". */
  maxSelections?: number;

  /** Shown when this returns true. Absent means always. */
  when?: (answers: Answers) => boolean;

  /** Labels either end of a `scale`. */
  scaleLabels?: { low: string; high: string };
}

export interface Questionnaire {
  id: string;
  title: string;
  /** Set once at the start. Sets expectations about length. */
  intro: string;
  questions: Question[];
}

export interface QuestionnaireProgress {
  /** Index within the currently applicable questions. */
  current: number;
  /** How many apply given the answers so far. Changes as branches open. */
  total: number;
  /** 0–1. */
  fraction: number;
}
