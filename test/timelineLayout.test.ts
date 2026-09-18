import { stub } from './helpers';
import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineRailPath, updateTimelineRails } from '../src/composables/timelineLayout.ts';

test('timeline stays continuous through item spacing and page-break gaps', () => {
  assert.equal(timelineRailPath([
    { x: 240, top: 10, bottom: 80 },
    { x: 240, top: 130, bottom: 200 },
    { x: 240, top: 500, bottom: 560 },
  ]), 'M 240 560 L 240 500 L 240 130 L 240 10');
});

test('timeline follows changes in the item column without crossing the sidebar', () => {
  assert.equal(timelineRailPath([
    { x: 10, top: 10, bottom: 80 },
    { x: 240, top: 130, bottom: 200 },
    { x: 10, top: 250, bottom: 300 },
  ]), 'M 10 300 L 10 250 M 240 200 L 240 130 M 10 80 L 10 10');
});

test('empty timelines have no rail', () => {
  assert.equal(timelineRailPath([]), '');
});

test('rail geometry uses final title positions, not the full-width timeline wrapper', () => {
  const attributes: Record<string, string> = {};
  let writes = 0;
  const getAttribute = (key: string) => attributes[key] ?? null;
  const path = { getAttribute, setAttribute: (key: string, value: string) => { attributes[key] = value; writes++; } };
  const item = (left: number, top: number, bottom: number) => ({
    querySelector: () => ({ getBoundingClientRect: () => ({ left, top, height: 20 }) }),
    getBoundingClientRect: () => ({ bottom }),
  });
  const items = [item(320, 200, 260), item(320, 450, 530)];
  const rail = {
    getAttribute,
    style: { top: "" },
    parentElement: {
      getBoundingClientRect: () => ({ left: 40, top: 100, width: 700, height: 450 }),
      querySelectorAll: () => items,
    },
    setAttribute: (key: string, value: string) => { attributes[key] = value; writes++; },
    querySelector: () => path,
  };
  const root = {
    ownerDocument: { documentElement: { getAttribute: () => null }, defaultView: { getComputedStyle: () => ({ left: '-22px', width: '16px' }) } },
    querySelectorAll: () => [rail],
  };
  updateTimelineRails(stub<HTMLElement>(root));
  assert.deepEqual(attributes, { preserveAspectRatio: 'none', width: '700', height: '324', viewBox: '0 108 700 324', d: 'M 266 430 L 266 360 L 266 110' });
  assert.equal(rail.style.top, '108px');
  const initialWrites = writes;
  updateTimelineRails(stub<HTMLElement>(root));
  assert.equal(writes, initialWrites, 'unchanged geometry must not mutate the DOM');
  // Pagination whitespace above the entries moves the SVG, without shifting its
  // endpoints relative to the entries or stretching it to the section height.
  items.splice(0, 2, item(320, 700, 760), item(320, 950, 1030));
  updateTimelineRails(stub<HTMLElement>(root));
  assert.equal(rail.style.top, '608px');
  assert.equal(attributes.height, '324');
  assert.equal(attributes.d, 'M 266 930 L 266 860 L 266 610');
  // Mirroring the sidebar or resizing a column must not retain cached geometry.
  items.splice(0, 2, item(80, 200, 260), item(80, 450, 530));
  updateTimelineRails(stub<HTMLElement>(root));
  assert.equal(attributes.d, 'M 26 430 L 26 360 L 26 110');
});

test('disabled timelines do not measure layout or write SVG attributes', () => {
  updateTimelineRails(stub<HTMLElement>({
    ownerDocument: { documentElement: { getAttribute: () => 'false' } },
    querySelectorAll() { throw new Error('Hidden timelines should not be traversed'); },
  }));
});
