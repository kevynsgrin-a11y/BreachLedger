// Tests for the build-blocking guards in site/build.js.
//
// The zero-JS guard was narrowed to admit JSON-LD metadata. That narrowing is
// the only hole ever cut in it, so these tests exist to prove the hole is
// exactly the shape intended: a well-formed, fully escaped ld+json block passes
// and everything else — including anything dressed up to look like one — still
// fails the build.

const test = require('node:test');
const assert = require('node:assert/strict');

const { guardPage, CONTENT_SECURITY_POLICY } = require('./build');
const { jsonLd, page, ga4Bootstrap } = require('./templates/layout');

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

// --- the allowScript exception (the /scan tool) ---

test('an allowScript page may load one fingerprinted /assets script', () => {
  const html = shell('<script src="/assets/scan.0123456789.js" defer></script>');
  assert.doesNotThrow(() => guardPage('/scan', html, { allowScript: true }));
});

test('an allowScript page with an inline script still fails', () => {
  assert.throws(
    () => guardPage('/scan', shell('<script>alert(1)</script>'), { allowScript: true }),
    /exactly one fingerprinted/
  );
});

test('an allowScript page loading a second script still fails', () => {
  const html = shell('<script src="/assets/scan.0123456789.js" defer></script><script src="/assets/x.js"></script>');
  assert.throws(() => guardPage('/scan', html, { allowScript: true }), /exactly one fingerprinted/);
});

test('an allowScript page loading a script from another origin still fails', () => {
  const html = shell('<script src="https://evil.example/assets/scan.js"></script>');
  assert.throws(() => guardPage('/scan', html, { allowScript: true }), /exactly one fingerprinted/);
});

// --- Google Analytics 4: the one approved exception beyond JSON-LD ---

const GA_ID = 'G-6KG8DVBHJG';
const LOADER = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>`;
const BOOTSTRAP = '<script async src="/assets/ga4.0123456789.js"></script>';

test('the GA4 loader and same-origin bootstrap pair is admitted', () => {
  assert.doesNotThrow(() => guardPage('/x', shell(LOADER + BOOTSTRAP)));
});

test('a page rendered by the layout with a GA4 ID carries exactly the pair and passes', () => {
  const site = { name: 'BreachBook', tagline: 't', origin: 'https://breachbook.org', language: 'en-US', ga4MeasurementId: GA_ID };
  const html = page({ site, title: 'T', description: 'd', content: '<p>x</p>', route: '/x', assets: { 'ga4.js': 'ga4.0123456789.js' } });
  assert.equal(html.split(LOADER).length - 1, 1);
  assert.equal(html.split(BOOTSTRAP).length - 1, 1);
  assert.doesNotThrow(() => guardPage('/x', html));
});

test('the GA4 bootstrap configures the given ID and is not inline markup', () => {
  const js = ga4Bootstrap(GA_ID);
  assert.match(js, /gtag\("config", "G-6KG8DVBHJG"\);/);
  assert.match(js, /gtag\("js", new Date\(\)\);/);
  assert.ok(!js.includes('<'), 'bootstrap is a script file, not markup');
  assert.throws(() => ga4Bootstrap('G-1"); alert(1); ("'), /invalid GA4 measurement ID/);
});

test('an inline gtag bootstrap still fails', () => {
  const inline = "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6KG8DVBHJG');</script>";
  assert.throws(() => guardPage('/x', shell(LOADER + BOOTSTRAP + inline)), /zero-JS/);
});

test('a GA4 loader from another host or with a malformed ID still fails', () => {
  const offHost = '<script async src="https://www.googletagmanager.evil/gtag/js?id=G-6KG8DVBHJG"></script>';
  assert.throws(() => guardPage('/x', shell(offHost + BOOTSTRAP)), /GA4 loader|zero-JS/);
  const badId = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-6kg8&x=1"></script>';
  assert.throws(() => guardPage('/x', shell(badId + BOOTSTRAP)), /GA4 loader|zero-JS/);
});

test('a bootstrap outside /assets or without a content hash still fails', () => {
  assert.throws(() => guardPage('/x', shell(LOADER + '<script async src="/ga4.js"></script>')), /GA4|zero-JS/);
  assert.throws(() => guardPage('/x', shell(LOADER + '<script async src="/assets/ga4.js"></script>')), /GA4|zero-JS/);
});

test('a duplicated or unpaired GA4 tag fails', () => {
  assert.throws(() => guardPage('/x', shell(LOADER + LOADER + BOOTSTRAP + BOOTSTRAP)), /one GA4 loader/);
  assert.throws(() => guardPage('/x', shell(LOADER)), /one GA4 loader/);
  assert.throws(() => guardPage('/x', shell(BOOTSTRAP)), /one GA4 loader/);
});

test('an allowScript page may carry the GA4 pair beside its one /assets script', () => {
  const html = shell(LOADER + BOOTSTRAP + '<script src="/assets/scan.0123456789.js" defer></script>');
  assert.doesNotThrow(() => guardPage('/scan', html, { allowScript: true }));
});

// --- the served Content-Security-Policy ---

const directives = Object.fromEntries(
  CONTENT_SECURITY_POLICY.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values])
);

test('the CSP allows exactly the approved script origins', () => {
  assert.deepEqual(directives['script-src'], [
    "'self'",
    'https://www.googletagmanager.com',
    'https://static.cloudflareinsights.com',
  ]);
});

test('the CSP allows exactly the approved connect and img origins', () => {
  assert.deepEqual(directives['connect-src'], [
    "'self'",
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
    'https://cloudflareinsights.com',
  ]);
  assert.deepEqual(directives['img-src'], [
    "'self'",
    'data:',
    'https://*.google-analytics.com',
    'https://*.googletagmanager.com',
  ]);
});

test('the CSP stays strict everywhere else', () => {
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.deepEqual(directives['style-src'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /'unsafe-inline'|'unsafe-eval'|\shttps:(\s|;|$)|\s\*(\s|;|$)/);
});
