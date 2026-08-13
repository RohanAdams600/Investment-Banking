export {
  fillTemplate,
  reviewDocument,
  LEGAL_DOCUMENT_KINDS,
  DOCUMENT_LABELS,
  LEGAL_DRAFT_NOTICE,
  type LegalDocumentKind,
  type ReviewResult,
  type ReviewFinding,
  type FindingSeverity,
} from './review';

export {
  addVersion,
  diffDocuments,
  summariseRevision,
  type ChangeKind,
  type DiffLine,
  type DocumentDiff,
  type DocumentVersion,
} from './revise';
