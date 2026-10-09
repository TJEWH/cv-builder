import type { CvAdjustmentRequest, LocalCvAdjustmentRequest, CvAdjustmentResponse } from './cvAdjustmentTypes';
import type { LetterContent, LetterTemplate } from './letterTypes';
import type { CvStructure, CvOperation, CvComment, CvStructureBindings } from './cvStructuredTypes';

export type RefinementScope = 'both' | 'cv' | 'letter';
export interface AnnotationReference { proposalId: string; annotationId: string; reviewId: string | null }
export type AnnotationStatus = 'open' | 'resolved' | 'ignored';
export type RefinementAnnotation = {
  id: string; type: 'comment' | 'todo' | 'question'; text: string;
} & ({ document: 'cv'; location: { fieldId: string } | null }
  | { document: 'letter'; location: { start: number; quote: string } | null });
export interface RefinementFeedback { id: string; text: string; scope: RefinementScope; createdAt: string; annotation?: AnnotationReference }
export interface RefinementSetup { template: LetterTemplate; language: string; maxWords: number }
export interface RefinementApprovals { cv: string | null; letter: string | null }
export type PrivacyContextType = 'person' | 'organization' | 'location' | 'link' | 'contact' | 'confidential' | 'other';
/** Public context only; never include the original value, local path or reverse mapping. */
export interface PrivacyLegendEntry { fieldId: string; token: string; type: PrivacyContextType; description: string }
/** Locally approved context keyed by an exact private source fingerprint, never by token numbering. */
export type ApprovedPrivacyContexts = Record<string, Pick<PrivacyLegendEntry, 'type' | 'description'>>;
export interface RefinementState {
  application_id: string; user_id: string; setup_json: RefinementSetup;
  approvals_json: RefinementApprovals; current_request_id: string | null; revision: number; updated_at: string;
}
interface RefinementRequestBase {
  requestId: string; applicationId: string;
  cv: CvAdjustmentRequest; letter: RefinementSetup & { text: string };
  scope: RefinementScope; feedback: RefinementFeedback[]; parentProposalId: string | null;
  privacyLegend?: PrivacyLegendEntry[];
}
export interface RefinementRequestV1 extends RefinementRequestBase { schemaVersion: 1 }
export interface RefinementRequestV2 extends RefinementRequestBase { schemaVersion: 2; cvStructure: CvStructure }
export type RefinementRequest = RefinementRequestV1 | RefinementRequestV2;
export interface RefinementProposalV1 {
  schemaVersion: 1; requestId: string; summary: string;
  cvEdits: CvAdjustmentResponse['edits']; letterText: string;
}
export interface RefinementProposalV2 {
  schemaVersion: 2; requestId: string; summary: string;
  cvOperations: CvOperation[]; cvComments: CvComment[]; letterText: string;
  /** Optional extension: older v2 proposals remain readable without annotations. */
  annotations?: RefinementAnnotation[];
}
export type RefinementProposal = RefinementProposalV1 | RefinementProposalV2;
export interface RefinementRequestRow {
  id: string; application_id: string; user_id: string; request_json: RefinementRequest; created_at: string;
  cv_snapshot?: { snapshotId?: string; revision?: number };
}
export interface RefinementProposalRow {
  id: string; application_id: string; user_id: string; request_id: string;
  proposal_json: RefinementProposal; created_at: string;
}
export interface RefinementReviewRow {
  id: string; application_id: string; user_id: string; request_id: string | null;
  kind: 'feedback' | 'approve_cv' | 'approve_letter' | 'reopen_cv' | 'reopen_letter' | 'cv_decisions' | 'annotation';
  payload: Record<string, unknown>; created_at: string;
}
/** Full baseline and reconstruction bindings never cross the upload boundary. */
export interface LocalRefinementRequest {
  request: RefinementRequest; cv: LocalCvAdjustmentRequest; baselineSignature: string;
  structureBindings?: CvStructureBindings;
  /** Exact local letter source, including private wording; never upload or infer from request.letter. */
  letterBaseline?: { text: string; setup: RefinementSetup; content?: LetterContent };
  /** Integrity of the frozen local originals, independently of the current application version. */
  sourceSignatures?: { cv: string; letter: string };
  /** Local idempotency receipts for explicit acceptance; never part of request_json. */
  acceptances?: { key: string; proposalId: string; variantId: string | null; acceptedAt: string; reviewId: string }[];
  /** Optional local provenance for the frozen source; never part of request_json. */
  source?: {
    cv: { name: string; variantId: string; baseRevision: number; hasApplicationEdits: boolean };
    letter: { updatedAt: string; version: string };
    contextCapturedAt: string;
  };
  /** Actual prompt implementation recorded for this request; older sources remain unknown. */
  promptVersion?: string;
  publishedAt?: string;
}
