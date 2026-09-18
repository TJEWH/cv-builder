import { stub } from './helpers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCvDesign } from '../src/composables/useCvDesign.ts';

function withDocument(run: (properties: Map<string, string>, links: Map<string, HTMLLinkElement>) => void) {
  const previousDocument = globalThis.document;
  const properties = new Map<string, string>();
  const links = new Map<string, HTMLLinkElement>();
  globalThis.document = stub<Document>({
    documentElement: {
      style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      setAttribute() {},
    },
    getElementById: (id: string) => links.get(id) || null,
    createElement: () => {
      const link = stub<HTMLLinkElement>({ remove: () => links.delete(link.id) });
      return link;
    },
    head: { appendChild: (link: HTMLLinkElement) => links.set(link.id, link) },
  });

  try {
    run(properties, links);
  } finally {
    globalThis.document = previousDocument;
  }
}

test('loads Bunny stylesheets and updates existing links when fonts change', () => {
  withDocument((properties, links) => {
    applyCvDesign({ fontBody: 'Source Sans 3', fontHead: 'Inter' });
    const bodyLink = links.get('cv-font-body');
    assert.equal(bodyLink?.rel, 'stylesheet');
    assert.equal(bodyLink?.href, 'https://fonts.bunny.net/css?family=source-sans-3:300,400,600,700&display=swap');
    assert.equal(links.get('cv-font-head')?.href, 'https://fonts.bunny.net/css?family=inter:300,400,600,700&display=swap');

    applyCvDesign({ fontBody: 'Browallia New', fontHead: 'Century Gothic' });
    assert.equal(links.get('cv-font-body'), bodyLink);
    assert.equal(links.size, 2);
    assert.equal(bodyLink?.href, 'https://fonts.googleapis.com/css?family=Browallia+New:300,400,600,700&display=swap');
    assert.equal(links.get('cv-font-head')?.href, 'https://fonts.googleapis.com/css?family=Century+Gothic:300,400,600,700&display=swap');
    assert.match(properties.get('--font-body') || '', /Browallia New/);
    assert.match(properties.get('--font-head') || '', /Century Gothic/);

    applyCvDesign({ fontBody: 'Inter', fontHead: 'Open Sans', customFonts: [{ name: 'Inter', source: 'google' }, { name: 'Open Sans', source: 'bunny' }] });
    assert.equal(bodyLink?.href, 'https://fonts.googleapis.com/css?family=Inter:300,400,600,700&display=swap');
    assert.equal(links.get('cv-font-head')?.href, 'https://fonts.bunny.net/css?family=open-sans:300,400,600,700&display=swap');

    applyCvDesign({ fontBody: 'Inter', fontHead: '' });
    assert.equal(links.has('cv-font-head'), false);
    applyCvDesign({ fontBody: '', fontHead: '' });
    assert.equal(links.size, 0);
  });
});

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
    assert.equal(properties.get('--sidebar-bottom-padding'), '0mm');
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
    for (const [value, expected] of [['90mm', '30mm'], ['-1mm', '0mm'], ['invalid', '0mm']]) {
      applyCvDesign({ sidebarBottomPadding: value });
      assert.equal(properties.get('--sidebar-bottom-padding'), expected);
    }
  });
});
