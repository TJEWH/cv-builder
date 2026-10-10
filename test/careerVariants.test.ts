import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVariantIndex } from '../src/composables/careerVariants';

test('legacy subvariants become independent variants without changing their identity or timestamps', () => {
  const input = [
    { id: 'root', name: 'Root' }, { id: 'child', name: 'Child', mtime: 123, parentId: 'root' },
    { id: 'nested', name: 'Third level', parentId: 'child' }, { id: 'orphan', name: 'Orphan', parentId: 'gone' },
    { id: 'loop', name: 'Cycle', parentId: 'loop' }, { id: 'root', name: 'Duplicate' },
  ];
  const result = normalizeVariantIndex(input);
  assert.deepEqual(result, [
    { id: 'root', name: 'Root' }, { id: 'child', name: 'Child', mtime: 123 },
    { id: 'nested', name: 'Third level' }, { id: 'orphan', name: 'Orphan' },
    { id: 'loop', name: 'Cycle' },
  ]);
  assert.equal(input[1]?.parentId, 'root', 'normalization does not rewrite stored documents or its input');
});

test('flat libraries remain readable and malformed index entries are ignored', () => {
  assert.deepEqual(normalizeVariantIndex([{ id: 'old', name: 'Existing CV' }]), [{ id: 'old', name: 'Existing CV' }]);
  assert.deepEqual(normalizeVariantIndex([null, false, {}, { id: '', name: 'Empty' }, { id: 'missing-name' }]), []);
  assert.deepEqual(normalizeVariantIndex({ id: 'wrong-shape' }), []);
});
