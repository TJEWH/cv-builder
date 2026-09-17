import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineRailPath, updateTimelineRails } from '../src/composables/timelineLayout.js';

test('timeline stays continuous through item spacing and page-break gaps', () => {
  assert.equal(timelineRailPath([
    { x: 240, top: 10, bottom: 80 },
    { x: 240, top: 130, bottom: 200 },
    { x: 240, top: 500, bottom: 560 },
  ]), 'M 240 10 L 240 80 L 240 200 L 240 560');
});

test('timeline follows changes in the item column without crossing the sidebar', () => {
  assert.equal(timelineRailPath([
    { x: 10, top: 10, bottom: 80 },
    { x: 240, top: 130, bottom: 200 },
    { x: 10, top: 250, bottom: 300 },
  ]), 'M 10 10 L 10 80 M 240 130 L 240 200 M 10 250 L 10 300');
});

test('empty timelines have no rail', () => {
  assert.equal(timelineRailPath([]), '');
});

test('rail geometry uses final title positions, not the full-width timeline wrapper', () => {
  const attributes = {};
  const path = { setAttribute: (key, value) => { attributes[key] = value; } };
  const item = (left, top, bottom) => ({
    querySelector: () => ({ getBoundingClientRect: () => ({ left, top, height: 20 }) }),
    getBoundingClientRect: () => ({ bottom }),
  });
  const items = [item(320, 200, 260), item(320, 450, 530)];
  const rail = {
    parentElement: {
      getBoundingClientRect: () => ({ left: 40, top: 100, width: 700, height: 450 }),
      querySelectorAll: () => items,
    },
    setAttribute: (key, value) => { attributes[key] = value; },
    querySelector: () => path,
  };
  const root = {
    ownerDocument: { defaultView: { getComputedStyle: () => ({ left: '-22px', width: '16px' }) } },
    querySelectorAll: () => [rail],
  };
  updateTimelineRails(root);
  assert.deepEqual(attributes, { width: '700', height: '450', viewBox: '0 0 700 450', d: 'M 266 110 L 266 160 L 266 430' });
  // Mirroring the sidebar or resizing a column must not retain cached geometry.
  items.splice(0, 2, item(80, 200, 260), item(80, 450, 530));
  updateTimelineRails(root);
  assert.equal(attributes.d, 'M 26 110 L 26 160 L 26 430');
});
