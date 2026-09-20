export interface LetterContent {
  subject: string;
  salutation: string;
  body: string;
  closing: string;
}

export interface LetterTemplateGuidance {
  /** Optional so libraries exported before template guidance remain readable. */
  subjectInstructions?: string;
  salutationInstructions?: string;
  closingInstructions?: string;
}

export interface LetterTemplate extends LetterTemplateGuidance {
  id: string;
  name: string;
  revision: number;
  structure: string;
  tone: string;
  language: string;
  maxWords: number;
  updatedAt: string;
}

/** Content and design are tracked independently: a design change only needs layout review. */
export interface LetterContextVersion { content: string; theme: string }
export interface LetterRevision {
  id: string;
  kind: 'generated' | 'edited' | 'final';
  content: LetterContent;
  context: LetterContextVersion;
  cloudDraftId?: string;
  cloudContextId?: string;
  createdAt: string;
}

export interface ApplicationLetter {
  version: 1;
  applicationId: string;
  userId: string;
  templateId: string;
  instructions: string;
  language: string;
  maxWords: number;
  working: LetterContent;
  workingContext: LetterContextVersion;
  publishedContexts: Record<string, LetterContextVersion>;
  finalRevisionId: string | null;
  revisions: LetterRevision[];
  updatedAt: string;
}

export interface LetterReadiness {
  record: ApplicationLetter | null;
  ready: boolean;
  unresolvedPlaceholders: string[];
}
