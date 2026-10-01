import type { CvAdjustmentRequest, LocalCvAdjustmentRequest, CvAdjustmentResponse } from './cvAdjustmentTypes';
import type { LetterTemplate } from './letterTypes';
import type { CvStructure, CvOperation, CvComment, CvStructureBindings } from './cvStructuredTypes';

export type RefinementScope = 'both' | 'cv' | 'letter';
export interface RefinementFeedback { id: string; text: string; scope: RefinementScope; createdAt: string }
export interface RefinementSetup { template: LetterTemplate; language: string; maxWords: number }
export interface RefinementApprovals { cv: string | null; letter: string | null }
export interface RefinementState {
  application_id: string; user_id: string; setup_json: RefinementSetup;
  approvals_json: RefinementApprovals; current_request_id: string | null; revision: number; updated_at: string;
}
interface RefinementRequestBase {
  requestId: string; applicationId: string;
  cv: CvAdjustmentRequest; letter: RefinementSetup & { text: string };
  scope: RefinementScope; feedback: RefinementFeedback[]; parentProposalId: string | null;
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
}
export type RefinementProposal = RefinementProposalV1 | RefinementProposalV2;
export interface RefinementRequestRow {
  id: string; application_id: string; user_id: string; request_json: RefinementRequest; created_at: string;
}
export interface RefinementProposalRow {
  id: string; application_id: string; user_id: string; request_id: string;
  proposal_json: RefinementProposal; created_at: string;
}
export interface RefinementReviewRow {
  id: string; application_id: string; user_id: string; request_id: string | null;
  kind: 'feedback' | 'approve_cv' | 'approve_letter' | 'reopen_cv' | 'reopen_letter' | 'cv_decisions';
  payload: Record<string, unknown>; created_at: string;
}
/** Full baseline and reconstruction bindings never cross the upload boundary. */
export interface LocalRefinementRequest {
  request: RefinementRequest; cv: LocalCvAdjustmentRequest; baselineSignature: string;
  structureBindings?: CvStructureBindings;
  /** Optional local provenance for the frozen source; never part of request_json. */
  source?: {
    cv: { name: string; variantId: string; baseRevision: number; hasApplicationEdits: boolean };
    letter: { updatedAt: string; version: string };
    contextCapturedAt: string;
  };
  publishedAt?: string;
}
