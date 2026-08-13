import { describe, expect, it } from 'vitest';

import { BUYER_QUESTIONNAIRE } from './buyer';
import { SELLER_QUESTIONNAIRE } from './seller';
import {
  isComplete,
  nextQuestion,
  progressFor,
  pruneAnswers,
  validateAnswer,
  visibleQuestions,
} from './engine';
import { scoreSellerFit, type BuyerSnapshot, type SellerPreferences } from './seller-fit';
import type { Question, Questionnaire } from './types';

const BOTH = [BUYER_QUESTIONNAIRE, SELLER_QUESTIONNAIRE];

describe('question sets', () => {
  it.each(BOTH)('$id has unique question ids', (questionnaire) => {
    const ids = questionnaire.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BOTH)('$id explains why it is asking, on every question', (questionnaire) => {
    // People disclose more when they know what a figure is for. A question with
    // no `help` is one somebody will answer with a round number or skip.
    for (const question of questionnaire.questions) {
      expect(question.help, `${question.id} has no help text`).toBeTruthy();
      expect(question.help!.length).toBeGreaterThan(20);
    }
  });

  it.each(BOTH)('$id gives every choice question options', (questionnaire) => {
    for (const question of questionnaire.questions) {
      if (question.type === 'single' || question.type === 'multi') {
        expect(question.options?.length, `${question.id} has no options`).toBeGreaterThan(1);
      }
    }
  });

  it.each(BOTH)('$id has unique option values within each question', (questionnaire) => {
    for (const question of questionnaire.questions) {
      const values = (question.options ?? []).map((o) => o.value);
      expect(new Set(values).size, `${question.id} has duplicate options`).toBe(values.length);
    }
  });

  it.each(BOTH)('$id asks questions as questions', (questionnaire) => {
    for (const question of questionnaire.questions) {
      expect(question.prompt.endsWith('?'), `${question.id}: "${question.prompt}"`).toBe(true);
    }
  });

  it('does not ask a seller for an asking price', () => {
    // Deliberate. A price given before seeing any analysis anchors the whole
    // process to a guess; it is collected after the estimate instead.
    const ids = SELLER_QUESTIONNAIRE.questions.map((q) => q.id);
    expect(ids).not.toContain('askingPrice');
  });

  it('asks the seller who they want to sell to', () => {
    const ids = SELLER_QUESTIONNAIRE.questions.map((q) => q.id);
    expect(ids).toContain('buyerTypes');
    expect(ids).toContain('employeePriority');
    expect(ids).toContain('legacyPriority');
  });
});

describe('branching', () => {
  it('skips the state question for a national buyer', () => {
    const national = visibleQuestions(BUYER_QUESTIONNAIRE, { geography: 'national' });
    expect(national.map((q) => q.id)).not.toContain('states');
  });

  it('asks it of a regional buyer', () => {
    const regional = visibleQuestions(BUYER_QUESTIONNAIRE, { geography: 'regional' });
    expect(regional.map((q) => q.id)).toContain('states');
  });

  it('drops answers to questions that stopped applying', () => {
    // Going back and widening the search closes the branch. Without pruning,
    // the abandoned states would be written to the criteria and quietly filter
    // the buyer's matches.
    const answers = { geography: 'regional', states: ['US-NY'], structure: 'asset' };
    const widened = pruneAnswers(BUYER_QUESTIONNAIRE, { ...answers, geography: 'national' });

    expect(widened.states).toBeUndefined();
    expect(widened.structure).toBe('asset');
  });
});

describe('walking the questionnaire', () => {
  it('starts at the first question', () => {
    expect(nextQuestion(BUYER_QUESTIONNAIRE, {})?.id).toBe(BUYER_QUESTIONNAIRE.questions[0]!.id);
  });

  it('resumes at the first gap rather than the start', () => {
    const answers = { industries: ['home_services'], geography: 'national' };
    // Not `industries` — somebody coming back should not re-answer what they
    // already told us.
    expect(nextQuestion(BUYER_QUESTIONNAIRE, answers)?.id).not.toBe('industries');
  });

  it('returns null once everything applicable is answered', () => {
    const answers: Record<string, string | string[]> = {};
    for (const question of visibleQuestions(BUYER_QUESTIONNAIRE, { geography: 'national' })) {
      answers[question.id] = question.type === 'multi' ? ['x'] : 'x';
    }
    answers.geography = 'national';

    expect(nextQuestion(BUYER_QUESTIONNAIRE, answers)).toBeNull();
  });

  it('treats an empty array as unanswered', () => {
    // A multi-choice question with nothing selected was skipped, not answered.
    expect(nextQuestion(BUYER_QUESTIONNAIRE, { industries: [] })?.id).toBe('industries');
  });

  it('counts progress against the questions that actually apply', () => {
    const national = progressFor(BUYER_QUESTIONNAIRE, { geography: 'national' }, 'revenueMin');
    const regional = progressFor(BUYER_QUESTIONNAIRE, { geography: 'regional' }, 'revenueMin');

    // The regional buyer is asked one extra question, and it comes before this
    // one — so their total is larger and they are one step further along when
    // they reach it. The alternative, a fixed total padded with questions
    // nobody will see, makes the bar lie in the other direction.
    expect(regional.total).toBe(national.total + 1);
    expect(regional.current).toBe(national.current + 1);
    expect(national.fraction).toBeLessThan(1);
  });

  it('never produces NaN progress for an empty questionnaire', () => {
    const empty: Questionnaire = { id: 'x', title: 'x', intro: 'x', questions: [] };
    expect(progressFor(empty, {}, 'nothing').fraction).toBe(1);
  });

  it('is complete only when the required questions are answered', () => {
    expect(isComplete(SELLER_QUESTIONNAIRE, {})).toBe(false);

    const answers: Record<string, string> = {};
    for (const question of SELLER_QUESTIONNAIRE.questions) {
      if (question.required) answers[question.id] = question.type === 'money' ? '100' : 'x';
    }
    expect(isComplete(SELLER_QUESTIONNAIRE, answers)).toBe(true);
  });
});

describe('validateAnswer', () => {
  const single: Question = {
    id: 'q',
    type: 'single',
    prompt: 'Pick?',
    required: true,
    options: [{ value: 'a', label: 'A' }],
  };

  it('requires an answer to a required question', () => {
    expect(validateAnswer(single, null)).toMatch(/needed/i);
  });

  it('allows skipping an optional one', () => {
    expect(validateAnswer({ ...single, required: false }, null)).toBeNull();
  });

  it('rejects an option that is not on the list', () => {
    // The client sends the value; it is not authoritative.
    expect(validateAnswer(single, 'z')).toMatch(/one of the options/i);
  });

  it('enforces a selection cap', () => {
    const multi: Question = {
      id: 'q',
      type: 'multi',
      prompt: 'Pick?',
      maxSelections: 2,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    };
    expect(validateAnswer(multi, ['a', 'b', 'c'])).toMatch(/up to 2/);
    expect(validateAnswer(multi, ['a', 'b'])).toBeNull();
  });

  it('rejects a negative amount of money', () => {
    const money: Question = { id: 'q', type: 'money', prompt: 'How much?' };
    expect(validateAnswer(money, '-500')).toMatch(/positive/i);
  });

  it('accepts a formatted amount', () => {
    const money: Question = { id: 'q', type: 'money', prompt: 'How much?' };
    expect(validateAnswer(money, '$1,250,000')).toBeNull();
  });

  it('enforces bounds', () => {
    const scale: Question = { id: 'q', type: 'scale', prompt: 'How much?', min: 1, max: 5 };
    expect(validateAnswer(scale, 6)).toMatch(/5 or less/);
    expect(validateAnswer(scale, 0)).toMatch(/1 or more/);
    expect(validateAnswer(scale, 3)).toBeNull();
  });

  it('accepts a negative growth rate', () => {
    // A decline is a fact, not an input error.
    const percent: Question = { id: 'q', type: 'percent', prompt: 'Growth?', min: -100, max: 500 };
    expect(validateAnswer(percent, '-12')).toBeNull();
  });
});

describe('scoreSellerFit', () => {
  const preferences: SellerPreferences = {
    acceptableBuyerTypes: ['individual', 'search_fund'],
    employeePriority: 5,
    legacyPriority: 5,
    transition: 'months',
    sellerFinancing: 'small',
    timeline: 'six_months',
  };

  const buyer: BuyerSnapshot = {
    kind: 'individual',
    fundingSource: 'sba',
    involvement: 'owner_operator',
    timeline: 'six_months',
    priorAcquisitions: 1,
  };

  it('scores a buyer the seller asked for highly', () => {
    expect(scoreSellerFit(preferences, buyer).score).toBeGreaterThan(70);
  });

  it('scores a competitor lower when legacy matters', () => {
    const strategic = scoreSellerFit(preferences, { ...buyer, kind: 'strategic' });
    expect(strategic.score).toBeLessThan(scoreSellerFit(preferences, buyer).score);
  });

  it('does not penalise a competitor when the seller does not care', () => {
    // A seller indifferent to legacy should not have buyers marked down for it.
    const indifferent: SellerPreferences = {
      ...preferences,
      acceptableBuyerTypes: [],
      employeePriority: 1,
      legacyPriority: 1,
    };

    const strategic = scoreSellerFit(indifferent, { ...buyer, kind: 'strategic' });
    const individual = scoreSellerFit(indifferent, buyer);

    expect(Math.abs(strategic.score - individual.score)).toBeLessThan(12);
  });

  it('raises the friction a seller most needs to hear', () => {
    const result = scoreSellerFit(preferences, { ...buyer, kind: 'strategic' });
    expect(result.frictions.join(' ')).toMatch(/name and the team/i);
  });

  it('says plainly that nothing here binds a buyer on staff', () => {
    // The platform must not imply it can enforce a promise about employees.
    const result = scoreSellerFit(preferences, buyer);
    expect(result.frictions.join(' ')).toMatch(/purchase agreement/i);
    expect(result.frictions.join(' ')).toMatch(/attorney/i);
  });

  it('flags a buyer who has not decided how to pay', () => {
    const result = scoreSellerFit(preferences, { ...buyer, fundingSource: 'undecided' });
    expect(result.frictions.join(' ')).toMatch(/not settled how they would pay/i);
  });

  it('penalises seller financing the seller ruled out', () => {
    const strict: SellerPreferences = { ...preferences, sellerFinancing: 'no' };
    const needsIt = scoreSellerFit(strict, { ...buyer, fundingSource: 'seller' });
    const cash = scoreSellerFit(strict, { ...buyer, fundingSource: 'cash' });

    expect(needsIt.score).toBeLessThan(cash.score);
  });

  it('stays within bounds across every combination', () => {
    const kinds: BuyerSnapshot['kind'][] = [
      'individual',
      'search_fund',
      'strategic',
      'private_equity',
      'family_office',
      'employees',
    ];
    const funding: BuyerSnapshot['fundingSource'][] = [
      'cash',
      'sba',
      'conventional',
      'fund',
      'seller',
      'undecided',
    ];
    const timelines: BuyerSnapshot['timeline'][] = ['now', 'six_months', 'year', 'exploring'];

    for (const kind of kinds) {
      for (const fundingSource of funding) {
        for (const timeline of timelines) {
          const result = scoreSellerFit(preferences, { ...buyer, kind, fundingSource, timeline });
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('always explains itself', () => {
    const result = scoreSellerFit(preferences, buyer);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    for (const reason of result.reasons) {
      expect(reason.detail.length).toBeGreaterThan(10);
    }
  });
});
