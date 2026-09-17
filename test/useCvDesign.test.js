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

test('applies independent header bottom padding and margin', () => {
  withDocument((properties) => {
    applyCvDesign({ headerPaddingBottom: '8mm', headerBottomMargin: '16mm' });

    assert.equal(properties.get('--header-padding-bottom'), '8mm');
    assert.equal(properties.get('--header-bottom-margin'), '16mm');
  });
});

test('applies independent vertical page margins', () => {
  withDocument((properties) => {
    applyCvDesign({ pageMarginTop: '10mm', pageMarginBottom: '18mm' });

    assert.equal(properties.get('--page-margin-top'), '10mm');
    assert.equal(properties.get('--page-margin-bottom'), '18mm');
  });
});

test('applies configurable spacing between body section items', () => {
  withDocument((properties) => {
    applyCvDesign({ itemSpacing: '6.5mm' });

    assert.equal(properties.get('--section-item-spacing'), '6.5mm');
  });
});

test('sidebar bottom padding applies only to content-sized sidebars, the default', () => {
  withDocument((properties) => {
    applyCvDesign({});
    assert.equal(properties.get('--sidebar-bottom-padding'), '6mm');
    applyCvDesign({ sidebarBottomPadding: '18mm' });
    assert.equal(properties.get('--sidebar-bottom-padding'), '18mm');
    applyCvDesign({ sidebarHeightMode: 'content', sidebarBottomPadding: '0mm' });
    assert.equal(properties.get('--sidebar-bottom-padding'), '0mm');
    applyCvDesign({ sidebarHeightMode: 'full-page', sidebarBottomPadding: '18mm' });
    assert.equal(properties.get('--sidebar-bottom-padding'), '6mm');
  });
});

test('sidebar bottom padding clamps oversized values and rejects invalid values', () => {
  withDocument((properties) => {
    for (const [value, expected] of [['90mm', '30mm'], ['-1mm', '6mm'], ['invalid', '6mm']]) {
      applyCvDesign({ sidebarBottomPadding: value });
      assert.equal(properties.get('--sidebar-bottom-padding'), expected);
    }
  });
});
