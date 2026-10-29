import type { CvConfig, CvContent, CvState } from './types';

export const TRACKING_STATUSES = ['ready', 'contacted', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export const APPLICATION_STATUSES = ['preparation', 'refinement', 'attachments', ...TRACKING_STATUSES] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
export const APPLICATION_STAGES = ['preparation', 'refinement', 'review', 'tracking'] as const;
export type ApplicationStage = typeof APPLICATION_STAGES[number];
export const OPPORTUNITY_REVIEW_STATES = ['unreviewed', 'not_interested', 'interested', 'strong_interest'] as const;
export type OpportunityReviewState = typeof OPPORTUNITY_REVIEW_STATES[number];
export const OPPORTUNITY_INTEREST_REASON_CATEGORIES = ['topic', 'method', 'hardware', 'location', 'funding', 'timing', 'other'] as const;
export type OpportunityInterestReasonCategory = typeof OPPORTUNITY_INTEREST_REASON_CATEGORIES[number];

export interface OpportunityInterestReason {
  category: OpportunityInterestReasonCategory;
  polarity: 'positive' | 'negative';
  /** An explicitly selected topic/method, never a target inferred from private prose. */
  target?: string;
}

/** Reference to a structured original prediction; its source must be independently verified. */
export interface OpportunityPredictionBaseline {
  user_id: string;
  opportunity_id: string;
  score: number;
  scale_min: 0;
  scale_max: 10;
  predicted_at: string;
  source_kind: 'historical_snapshot';
  source_ref: string;
}

export interface OpportunityReview {
  user_id: string;
  opportunity_id: string;
  state: OpportunityReviewState;
  /** Private context for the user's interest; older workspaces may omit this field. */
  comment?: string | null;
  /** AF-01 fields are optional while an installation is awaiting its additive migration. */
  interest_rating?: number | null;
  interest_reasons?: OpportunityInterestReason[];
  feedback_excluded?: boolean;
  feedback_revision?: number;
  feedback_updated_at?: string | null;
  /** Frozen for the explicit feedback revision, separate from the catalogue's AI fit. */
  prediction_baseline?: OpportunityPredictionBaseline | null;
  /** Private summary draft. Only its exact explicit approval permits adaptive export. */
  search_feedback_summary?: string | null;
  search_feedback_revision?: number;
  search_feedback_summary_hash?: string;
  search_feedback_source_hash?: string;
  search_feedback_approved_at?: string | null;
  search_feedback_approved_summary_hash?: string | null;
  search_feedback_approved_source_hash?: string | null;
  reviewed_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityFeedbackPatch {
  interest_rating?: number | null;
  interest_reasons?: OpportunityInterestReason[];
  feedback_excluded?: boolean;
  search_feedback_summary?: string | null;
}

export interface OpportunityFeedbackSettings {
  user_id: string;
  search_id: string | null;
  structured_feedback_enabled: boolean;
  consent_revision: number;
  consent_updated_at: string | null;
}

/** A display projection supporting both the imported catalogue and portable schema. */
export interface Opportunity {
  id: string;
  opportunity_key: string;
  vacancy_id: string | null;
  title: string;
  university: string | null;
  country: string | null;
  deadline: string | null;
  supervisor: string | null;
  supervisor_reputation: string | null;
  supervisor_research_focus: Record<string, unknown>;
  supervisor_top_papers: unknown[];
  contact: unknown;
  topics: string[];
  salary_text: string | null;
  research_career_potential: string | null;
  rd_career_potential: string | null;
  hardware_software_profile: string | null;
  personal_fit: string | null;
  particularly_suitable: boolean | null;
  special_features: string | null;
  requirements: unknown;
  required_documents: unknown;
  official_url: string | null;
  availability: string | null;
  verification_level: string | null;
  data: Record<string, unknown>;
  details: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

export interface CloudCvVariant {
  id: string;
  user_id: string;
  name: string;
  cv_version: number;
  revision: number;
  created_at: string;
}

export interface CloudCvSnapshot {
  id: string;
  name: string;
  content_json: CvContent;
  config_json: CvConfig;
  cv_version: number;
  revision: number;
  is_base_variant: boolean;
}

export interface Application {
  id: string;
  /** Persistent server-assigned reference; older workspaces may not provide one yet. */
  application_code?: string | null;
  user_id: string;
  opportunity_id: string;
  cv_variant_id: string | null;
  contact_email: string | null;
  /** Captured opportunity research, stable until the user explicitly refreshes it. */
  context_json: Record<string, unknown>;
  context_captured_at: string;
  completed_checklist_keys: string[];
  status: ApplicationStatus;
  /** Last opened application tab; absent on databases that need the stage upgrade. */
  workflow_stage?: ApplicationStage;
  /** Sticky after the first explicit Tracking dropdown selection, including Ready. */
  tracking_started?: boolean;
  /** Server-recorded transitions; older installations may not have history yet. */
  status_history?: { status: ApplicationStatus; changedAt: string | null }[];
  notes: string | null;
  contacted_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationInput {
  opportunityId: string;
}

export interface ApplicationContext {
  application: Application;
  cv: CloudCvSnapshot | null;
}

export interface UpdateApplicationInput {
  status?: ApplicationStatus;
  notes?: string | null;
  contactEmail?: string | null;
  contactedAt?: string | null;
  submittedAt?: string | null;
  /** Assign a new immutable privacy snapshot; never update the previous CV. */
  cvState?: CvState;
}
