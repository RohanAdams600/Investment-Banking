export {
  asArray,
  asCents,
  asFraction,
  asNumber,
  asString,
  isAnswered,
  isComplete,
  nextQuestion,
  previousQuestion,
  progressFor,
  pruneAnswers,
  questionById,
  validateAnswer,
  visibleQuestions,
} from './engine';

export { BUYER_QUESTIONNAIRE, US_STATE_OPTIONS, priorAcquisitionsFrom } from './buyer';
export { SELLER_QUESTIONNAIRE } from './seller';

export {
  scoreSellerFit,
  type BuyerKind,
  type BuyerSnapshot,
  type SellerFitResult,
  type SellerPreferences,
} from './seller-fit';

export type {
  Answer,
  Answers,
  Question,
  QuestionOption,
  QuestionType,
  Questionnaire,
  QuestionnaireProgress,
} from './types';
