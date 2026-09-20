import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVariantIndex, rootVariantId, subvariantParent } from '../src/composables/careerVariants';
import { SAMPLE_DOCUMENT_ID } from '../src/composables/builtinConfigurations';

test('variants have one subvariant level; copying a subvariant creates a sibling', () => {
  const items = [{ id: 'research', name: 'Research' }, { id: 'robotics', name: 'Robotics', parentId: 'research' }];
  assert.equal(subvariantParent('research', items), 'research');
  assert.equal(subvariantParent('robotics', items), 'research');
  assert.equal(rootVariantId('robotics', items), 'research');
  assert.throws(() => subvariantParent('missing', items));
  assert.throws(() => subvariantParent(SAMPLE_DOCUMENT_ID, [{ id: SAMPLE_DOCUMENT_ID, name: 'Sample' }]));
});

test('old flat libraries remain readable and malformed relationships never discard CVs', () => {
  const input = [
    { id: 'root', name: 'Root' }, { id: 'child', name: 'Child', parentId: 'root' },
    { id: 'nested', name: 'Third level', parentId: 'child' }, { id: 'orphan', name: 'Orphan', parentId: 'gone' },
    { id: 'loop', name: 'Cycle', parentId: 'loop' }, { id: 'root', name: 'Duplicate' },
  ];
  const result = normalizeVariantIndex(input);
  assert.equal(result.length, 5);
  assert.equal(result.find(item => item.id === 'child')?.parentId, 'root');
  for (const id of ['nested', 'orphan', 'loop']) assert.equal(result.find(item => item.id === id)?.parentId, undefined);
  assert.deepEqual(normalizeVariantIndex([{ id: 'old', name: 'Existing CV' }]), [{ id: 'old', name: 'Existing CV' }]);
});
