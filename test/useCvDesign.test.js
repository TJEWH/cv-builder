import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCvDesign } from '../src/composables/useCvDesign.js';

function withDocument(run) {
  const previousDocument = globalThis.document;
  const properties = new Map();
  globalThis.document = {
    documentElement: {
      style: { setProperty: (key, value) => properties.set(key, value) },
      setAttribute() {},
    },
    getElementById: () => null,
  };

  try {
    run(properties);
  } finally {
    globalThis.document = previousDocument;
  }
}

test('applies independent header top and bottom padding', () => {
  withDocument((properties) => {
    applyCvDesign({ headerPaddingTop: '8mm', headerPaddingBottom: '16mm' });

    assert.equal(properties.get('--header-padding-top'), '8mm');
    assert.equal(properties.get('--header-padding-bottom'), '16mm');
  });
});

test('uses the legacy vertical header padding for both sides', () => {
  withDocument((properties) => {
    applyCvDesign({ headerPaddingVertical: '10mm' });

    assert.equal(properties.get('--header-padding-top'), '10mm');
    assert.equal(properties.get('--header-padding-bottom'), '10mm');
  });
});

test('applies configurable spacing between body section items', () => {
  withDocument((properties) => {
    applyCvDesign({ itemSpacing: '6.5mm' });

    assert.equal(properties.get('--section-item-spacing'), '6.5mm');
  });
});
