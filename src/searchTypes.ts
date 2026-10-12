export type { OpportunityAssessment } from './composables/opportunityAssessment';
export const SEARCH_CRITERIA_FIELDS = [
  'opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions',
  'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting',
] as const;
export type SearchCriteriaField = typeof SEARCH_CRITERIA_FIELDS[number];
export type SearchCriteria = Record<SearchCriteriaField, string>;
export interface SearchSchedule {
  frequency: 'hourly' | 'daily' | 'weekly';
  intervalHours: number;
  weekdays: number[];
  time: string;
  timezone: string;
  runImmediately: boolean;
}
export interface SearchTemplate {
  id: string;
  userId: string;
  name: string;
  criteria: SearchCriteria;
  schedule: SearchSchedule;
  /** Last acknowledged database revision; zero for an unsaved local template. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface SearchReadiness {
  ready: boolean;
  bootstrap_version: number;
  protocol_version: string | null;
  protocol_hash: string | null;
  reason?: string | null;
}
export interface SearchScheduleBinding {
  search_id: string;
  user_id: string;
  task_id: string;
  schedule: SearchSchedule;
  template_revision: number;
  protocol_version: string;
  confirmed_at: string;
}
export interface SearchQueryRevision {
  id: string;
  search_id: string;
  user_id: string;
  template_revision: number;
  protocol_version: string;
  queries: { query: string; sources?: string[] }[];
  created_at: string;
}
export interface SearchRun {
  id: string;
  search_id: string;
  user_id: string;
  template_revision: number;
  protocol_version: string;
  definition: { name: string; criteria: SearchCriteria; schedule: SearchSchedule; revision: number };
  queries: SearchQueryRevision['queries'] | null;
  status: 'running' | 'complete' | 'failed';
  recovery_count: number;
  summary: { new: number; updated: number; unchanged: number; verified: number; unresolvedCount: number; notes: string; status: string } | null;
  created_at: string;
  started_at: string;
  completed_at: string | null;
}
export interface SearchReceipt {
  run_id: string;
  item_id: string;
  opportunity_id: string;
  opportunity_key: string;
  outcome: 'new' | 'updated' | 'unchanged';
  snapshot: Record<string, unknown>;
  conflicts: string[];
  previous_assessments?: Partial<Record<'personal_fit' | 'rd_career_potential' | 'research_career_potential', unknown>>;
  verified: boolean;
  current_snapshot?: Record<string, unknown>;
  changed_since_save?: boolean;
}
