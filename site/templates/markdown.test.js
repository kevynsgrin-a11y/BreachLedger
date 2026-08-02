const test = require('node:test');
const assert = require('node:assert');
const { renderMarkdown, escapeHtml } = require('./markdown');

test('table line without trailing pipe terminates (regression: infinite loop)', () => {
  const html = renderMarkdown('| a | b\n| c | d');
  assert.ok(html.includes('<td>a</td>'));
  assert.ok(html.includes('<td>d</td>'));
});

test('table without separator row renders all rows as body, no fake header', () => {
  const html = renderMarkdown('| a | b |\n| c | d |');
  assert.ok(!html.includes('<th>'));
  assert.ok(html.includes('<td>a</td>') && html.includes('<td>c</td>'));
});

test('table with separator renders thead + tbody', () => {
  const html = renderMarkdown('| H1 | H2 |\n| --- | --- |\n| x | y |');
  assert.ok(html.includes('<th>H1</th>'));
  assert.ok(html.includes('<td>y</td>'));
});

test('lone separator line renders nothing', () => {
  assert.equal(renderMarkdown('| --- | --- |'), '');
});

test('wrapped list items absorb indented continuation lines (regression)', () => {
  const html = renderMarkdown('- first line of item\n  continuation of item.\n- second item');
  assert.ok(html.includes('<li>first line of item continuation of item.</li>'));
  assert.ok(html.includes('<li>second item</li>'));
  assert.equal((html.match(/<ul>/g) || []).length, 1);
});

test('code spans are literal: no bold or link processing inside', () => {
  assert.ok(renderMarkdown('use `**not bold**` here').includes('<code>**not bold**</code>'));
  assert.ok(renderMarkdown('see `[x](y)` syntax').includes('<code>[x](y)</code>'));
});

test('unsafe link schemes render as plain text, safe schemes as links', () => {
  assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('<a '));
  assert.ok(!renderMarkdown('[x](data:text/html,hi)').includes('<a '));
  assert.ok(renderMarkdown('[x](https://example.gov/a)').includes('<a href="https://example.gov/a">x</a>'));
  assert.ok(renderMarkdown('[x](/severity)').includes('<a href="/severity">x</a>'));
});

test('link URLs with balanced parentheses survive', () => {
  const html = renderMarkdown('[w](https://en.wikipedia.org/wiki/Act_(law))');
  assert.ok(html.includes('href="https://en.wikipedia.org/wiki/Act_(law)"'));
});

test('HTML in source text is escaped everywhere, including apostrophes', () => {
  const html = renderMarkdown('<script>alert("x")</script> & O\'Brien');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&#39;'));
  assert.ok(!html.includes('<script>'));
  assert.equal(escapeHtml(`<a b="c" d='e'>`), '&lt;a b=&quot;c&quot; d=&#39;e&#39;&gt;');
});

test('headings, hr, paragraphs still render', () => {
  const html = renderMarkdown('# Title\n\nBody text.\n\n---\n\nMore.');
  assert.ok(html.includes('<h1>Title</h1>'));
  assert.ok(html.includes('<hr>'));
  assert.ok(html.includes('<p>Body text.</p>'));
});
