import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMarkdownText, normalizeMarkdownText, parseInlineMarkdown, parseMarkdownText, safeMarkdownUrl } from '../src/composables/markdownText.js';

test('parses multiline prose before markdown bullets', () => {
  const parsed = parseMarkdownText('First line\nSecond line\n- First bullet\n- Second bullet');

  assert.equal(parsed.prose, 'First line\nSecond line');
  assert.deepEqual(parsed.bullets, ['First bullet', 'Second bullet']);
});

test('continues the current bullet and ignores blank lines after a list starts', () => {
  const parsed = parseMarkdownText('Intro\n- First bullet\ncontinued detail\n\n- Second bullet');

  assert.equal(parsed.prose, 'Intro');
  assert.deepEqual(parsed.bullets, ['First bullet\ncontinued detail', 'Second bullet']);
});

test('converts legacy bullet arrays to markdown text', () => {
  assert.equal(normalizeMarkdownText(['First', 'Second']), '- First\n- Second');
  assert.equal(hasMarkdownText('- A point'), true);
  assert.equal(hasMarkdownText(''), false);
});

test('parses bold text and explicit HTTP(S) markdown links', () => {
  assert.deepEqual(parseInlineMarkdown('A **bold** [link](https://example.com/path).'), [
    { type: 'text', value: 'A ' },
    { type: 'bold', value: 'bold' },
    { type: 'text', value: ' ' },
    { type: 'link', value: 'link', href: 'https://example.com/path' },
    { type: 'text', value: '.' },
  ]);
  assert.deepEqual(parseInlineMarkdown('- **Important** [reference](http://example.com)'), [
    { type: 'text', value: '- ' },
    { type: 'bold', value: 'Important' },
    { type: 'text', value: ' ' },
    { type: 'link', value: 'reference', href: 'http://example.com/' },
  ]);
});

test('keeps bare and unsafe URLs as text', () => {
  assert.deepEqual(parseInlineMarkdown('Visit https://example.com'), [{ type: 'text', value: 'Visit https://example.com' }]);
  assert.deepEqual(parseInlineMarkdown('[bad](javascript:evil)'), [{ type: 'text', value: '[bad](javascript:evil)' }]);
  assert.equal(safeMarkdownUrl('mailto:person@example.com'), null);
});
