import type { CvState } from './types';

export interface CvAdjustmentField { id: string; label: string; text: string }
/** The complete upload boundary. Paths, CV identities and reconstruction data stay local. */
export interface CvAdjustmentRequest {
  schemaVersion: 1;
  requestId: string;
  fields: CvAdjustmentField[];
  opportunity: Record<string, unknown>;
  instructions: string;
}
export interface CvAdjustmentResponse {
  schemaVersion: 1;
  requestId: string;
  edits: { fieldId: string; text: string }[];
}
export interface LocalCvAdjustmentRequest {
  sourceVariantId: string;
  baselineState: CvState;
  publicRequest: CvAdjustmentRequest;
  /** Never upload this map or the baselineState. */
  bindings: { fieldId: string; path: (string | number)[]; tokens: Record<string, string> }[];
}
export interface CvAdjustmentRequestRow {
  id: string; user_id: string; application_id: string | null;
  request_json: CvAdjustmentRequest; created_at: string;
}
export interface CvAdjustmentResponseRow {
  id: string; user_id: string; request_id: string;
  response_json: CvAdjustmentResponse; created_at: string;
}
