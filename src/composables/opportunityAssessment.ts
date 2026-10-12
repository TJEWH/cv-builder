/** Canonical search assessment. Legacy values remain unknown until reassessed. */
export interface OpportunityAssessment {
  score: number;
  scale_min: 0;
  scale_max: 10;
  summary: string;
  subscores?: Record<string, number>;
}

export const OPPORTUNITY_ASSESSMENT_SCHEMA = {
  type: 'object', required: ['score', 'scale_min', 'scale_max', 'summary'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 10 },
    scale_min: { type: 'number', const: 0 }, scale_max: { type: 'number', const: 10 },
    summary: { type: 'string', minLength: 1, pattern: '\\S' },
    subscores: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 10 } },
  },
} as const;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const score = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
export function isOpportunityAssessment(value: unknown): value is OpportunityAssessment {
  return record(value) && score(value.score) && value.scale_min === 0 && value.scale_max === 10
    && typeof value.summary === 'string' && !!value.summary.trim()
    && (!Object.hasOwn(value, 'subscores') || (record(value.subscores) && Object.values(value.subscores).every(score)));
}
