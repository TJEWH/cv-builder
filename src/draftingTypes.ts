import type { CvContent, CvDesign } from './types';
import type { LetterTemplateGuidance } from './letterTypes';

export interface DraftingTemplateSnapshot extends LetterTemplateGuidance {
  id: string;
  name: string;
  revision: number;
  structure: string;
  tone: string;
}

export interface PublishDraftingInput {
  template: DraftingTemplateSnapshot;
  language: string;
  instructions: string;
  maxWords: number;
}

export interface DraftingContextBundle extends PublishDraftingInput {
  schemaVersion: 1;
  opportunity: Record<string, unknown>;
  opportunityCapturedAt: string;
  cv: { snapshotId: string | null; revision: number; content: CvContent; theme: CvDesign };
  identityPlaceholders: Record<string, string>;
}

export interface DraftingContext {
  id: string;
  user_id: string;
  application_id: string;
  cv_variant_id: string;
  context_json: DraftingContextBundle;
  created_at: string;
}

/** Returned drafts are append-only source material, never the local edited/final letter. */
export interface MotivationLetterDraft {
  id: string;
  user_id: string;
  application_id: string;
  context_id: string;
  body: string;
  created_at: string;
}
