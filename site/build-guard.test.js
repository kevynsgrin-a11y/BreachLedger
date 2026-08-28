// Tests for the build-blocking guards in site/build.js.
//
// The zero-JS guard was narrowed to admit JSON-LD metadata. That narrowing is
// the only hole ever cut in it, so these tests exist to prove the hole is
// exactly the shape intended: a well-formed, fully escaped ld+json block passes
// and everything else — including anything dressed up to look like one — still
// fails the build.

const test = require('node:test');
const assert = require('node:assert/strict');

const { guardPage } = require('./build');
const { jsonLd } = require('./templates/layout');

const shell = (body) => `<!doctype html>\n<html><head><title>Test page</title></head><body>${body}</body></html>`;

test('a clean page passes', () => {
  assert.doesNotThrow(() => guardPage('/x', shell('<p>Nothing unusual.</p>')));
});

test('a page missing its doctype fails', () => {
  assert.throws(() => guardPage('/x', '<html><title>t</title></html>'), /missing doctype/);
});

test('a page missing a title fails', () => {
  assert.throws(() => guardPage('/x', '<!doctype html>\n<html><head></head></html>'), /missing <title>/);
});

test('emoji still fail the build', () => {
  assert.throws(() => guardPage('/x', shell('<p>Breach \u{1F525}</p>')), /emoji/);
});

// --- the narrowed zero-JS guard ---

test('a properly escaped JSON-LD block is admitted', () => {
  const html = shell(jsonLd([{ '@context': 'https://schema.org', '@type': 'Dataset', name: 'Record' }]));
  assert.doesNotThrow(() => guardPage('/x', html));
});

test('an ordinary inline script still fails', () => {
  assert.throws(() => guardPage('/x', shell('<script>alert(1)</script>')), /zero-JS/);
});

test('an external script still fails', () => {
  assert.throws(() => guardPage('/x', shell('<script src="/x.js"></script>')), /zero-JS/);
});

test('an uppercase or spaced script tag still fails', () => {
  assert.throws(() => guardPage('/x', shell('<SCRIPT>alert(1)</SCRIPT>')), /zero-JS/);
  assert.throws(() => guardPage('/x', shell('<script >alert(1)</script>')), /zero-JS/);
});

test('a script wearing the ld+json type but carrying a raw < still fails', () => {
  // The exact breakout an unescaped serializer would produce.
  const forged = '<script type="application/ld+json">{"n":"</script><script>steal()</script>"}</script>';
  assert.throws(() => guardPage('/x', shell(forged)), /zero-JS/);
});

test('a differently-quoted ld+json tag is not admitted', () => {
  // Only the exact form layout.js emits is stripped; anything else is suspect.
  assert.throws(
    () => guardPage('/x', shell(`<script type='application/ld+json'>{"a":1}</script>`)),
    /zero-JS/
  );
});

test('a script hidden after a valid ld+json block is still caught', () => {
  const html = shell(jsonLd([{ '@type': 'Dataset' }]) + '<script>alert(1)</script>');
  assert.throws(() => guardPage('/x', html), /zero-JS/);
});

test('a script with an event-handler payload inside a JSON-LD value cannot execute', () => {
  // Escaped by jsonLd, so it is inert text and the guard admits the page.
  const html = shell(jsonLd([{ name: '<img src=x onerror=alert(1)>' }]));
  assert.doesNotThrow(() => guardPage('/x', html));
  assert.ok(!html.includes('<img src=x'), 'payload must not appear as live markup');
});

test('the guard reports every problem it found, not just the first', () => {
  assert.throws(
    () => guardPage('/x', '<html><script>x</script></html>'),
    (e) => /missing doctype/.test(e.message) && /missing <title>/.test(e.message) && /zero-JS/.test(e.message)
  );
});
