import type { CvState } from '../src/types';
import { CV_STATE_VERSION } from '../src/types';

export function createTestState(overrides: Partial<CvState> = {}): CvState {
  return {
    version: CV_STATE_VERSION, lang: 'en', disabled: [], completedSections: [], keepTogetherSections: [],
    design: {}, anonymization: { excludedSections: [], excludedItems: [] },
    contact: { name: '', role: '', location: '', email: '', phone: '', website: '', linkedin: '', github: '' },
    about: { text: '' }, education: [], experience: { jobs: [] }, languages: [], hobbies: [],
    customSections: [], sidebarSections: [], sectionNames: {}, sectionHeaderSizes: {},
    bodyOrder: ['about', 'education', 'jobs'], sidebarOrder: ['languages', 'hobbies'],
    ...overrides,
  };
}

/** Unit tests implement only the external API members exercised by each case.
 * Keep the assertion at the fixture boundary, rather than disabling checking. */
export function stub<T>(implementation: unknown): T {
  return implementation as T;
}
