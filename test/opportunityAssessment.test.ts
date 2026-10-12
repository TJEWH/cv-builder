import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpportunityAssessment } from '../src/composables/opportunityAssessment';
import { buildOpportunityGroups, opportunityContextMarkdown, personalFitScore } from '../src/composables/opportunityContext';

const assessment = { score: 8.2, scale_min: 0, scale_max: 10, summary: 'Evidence supports a methods fit.' };
test('canonical assessment accepts endpoints and decimals, including all subscores', () => {
  for (const score of [0, 10, 8.25]) {
    const value = { ...assessment, score, subscores: { first: 0, last: 10, methods: 8.25 } };
    assert.equal(isOpportunityAssessment(value), true);
    assert.equal(personalFitScore(value), score);
  }
});
test('unverified, categorical and malformed ratings never become canonical by coercion', () => {
  for (const value of [null, {}, 'very good', 4, '4/5', { score: 4, summary: 'Historical' },
    ...['8.2', true, -1, 10.01, NaN, Infinity].map(score => ({ ...assessment, score })),
    ...['', ' \n\t', 1, null].map(summary => ({ ...assessment, summary })),
    { ...assessment, scale_min: 1, scale_max: 5 }, { ...assessment, scale_min: '0' },
    ...[null, [], 'good', { methods: '8.5' }, { methods: 11 }, { methods: false }].map(subscores => ({ ...assessment, subscores })),
  ]) {
    assert.equal(isOpportunityAssessment(value), false, JSON.stringify(value));
    assert.equal(personalFitScore(value), undefined);
  }
});
test('legacy evidence remains verbatim with localized scale notices in detail and exports', () => {
  for (const value of [4, '4/5', 'very good', { score: 4, summary: 'Keep original rationale', subscores: { methods: 5 } }]) {
    for (const lang of ['en', 'de']) {
      const context = { personal_fit: value, rd_career_potential: value, research_career_potential: value };
      const before = structuredClone(context);
      const fits = buildOpportunityGroups(context, lang).flatMap(group => group.items).filter(item => item.kind === 'fit');
      assert.equal(fits.length, 3);
      for (const fit of fits) {
        assert.equal(fit.score, undefined);
        assert.equal(fit.assessmentNotice, lang === 'de' ? 'Skala nicht verifiziert' : 'Scale unverified');
      }
      const markdown = opportunityContextMarkdown(context, lang);
      assert.equal(markdown.split(lang === 'de' ? 'Skala nicht verifiziert' : 'Scale unverified').length - 1, 3);
      assert.doesNotMatch(markdown, /\/ 10/);
      assert.ok(markdown.includes(typeof value === 'object' ? value.summary : String(value)));
      assert.deepEqual(context, before);
    }
  }
});
