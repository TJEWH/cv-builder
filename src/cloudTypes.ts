import type { CvConfig, CvContent, CvState } from './types';

export const APPLICATION_STATUSES = ['shortlist', 'contacted', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
export const OPPORTUNITY_REVIEW_STATES = ['unreviewed', 'interested', 'not_interested'] as const;
export type OpportunityReviewState = typeof OPPORTUNITY_REVIEW_STATES[number];

export interface OpportunityReview {
  user_id: string;
  opportunity_id: string;
  state: OpportunityReviewState;
  created_at: string;
  updated_at: string;
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
  duration_months: number | null;
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
  user_id: string;
  opportunity_id: string;
  cv_variant_id: string | null;
  contact_email: string | null;
  /** Captured opportunity research, stable until the user explicitly refreshes it. */
  context_json: Record<string, unknown>;
  context_captured_at: string;
  status: ApplicationStatus;
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
