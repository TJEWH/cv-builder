export interface SearchProfessionalProfile {
  id: string;
  name: string;
  enabled: boolean;
  /** Confirmed career context; interests alone do not establish qualifications. */
  professionalContext: string;
  researchInterests: string;
  /** Editable search intent, written in English by default. */
  userPrompt: string;
}

export interface SearchTemplateCloudBinding {
  id: string;
  revision: number;
  /** Exact committed content acknowledged by Supabase. */
  contentKey: string;
}

export interface SearchTemplate {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  professionalContext: string;
  researchInterests: string;
  locationPreferences: string;
  userPrompt: string;
  profiles: SearchProfessionalProfile[];
  dailyTime: string;
  timezone: string;
  cloud?: SearchTemplateCloudBinding;
}

export const SEARCH_CRITERIA_KEYS = ['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions', 'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'] as const;
export type SearchCriteria = Record<typeof SEARCH_CRITERIA_KEYS[number], string>;
export interface SearchCloudSchedule {
  frequency: 'hourly' | 'daily' | 'weekly';
  intervalHours: number;
  weekdays: number[];
  time: string;
  timezone: string;
  runImmediately: boolean;
}
export interface SearchCloudTemplate {
  id: string;
  user_id: string;
  name: string;
  revision: number;
  criteria: SearchCriteria;
  schedule: SearchCloudSchedule;
  created_at: string;
  updated_at: string;
  meta_search?: SearchMetaSearchDocument | null;
}

export interface SearchMetaSearchDocument {
  version: 1;
  active: boolean;
  editor: SearchTemplate;
  systemPrompt: string;
  userPrompt: string;
  recurringPrompt: string;
}
