const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./browse-index');
const { guardPage } = require('../build');
const config = require('../../ue.config');

const context = (overrides = {}) => ({
  site: config.site,
  title: 'Browse the record',
  description: 'Explore the supplied groups of records.',
  route: '/test-index',
  assets: { 'styles.css': 'styles.test.css' },
  groups: [
    { heading: 'By sector', description: 'Find a sector.', links: [
      { label: 'Healthcare', href: '/sector/healthcare/', count: 1234 },
      { label: 'Education', href: '/sector/education/' },
    ] },
    { heading: 'By year', links: [
      { label: '2026', href: '/breaches/2026/', count: '0' },
      { label: '2025', href: '/breaches/2025/', count: 12 },
    ] },
  ],
  ...overrides,
});

const main = (html) => /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)[1];

test('browse renderer produces a complete page using supplied metadata and assets', () => {
  const html = render(context());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Browse the record — BreachBook<\/title>/);
  assert.match(html, /<h1>Browse the record<\/h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/breachbook.org\/test-index\/"/);
  assert.match(html, /href="\/assets\/styles.test.css"/);
  assert.match(html, /Skip to content/);
  assert.doesNotThrow(() => guardPage('/test-index', html));
  assert.doesNotMatch(html, /<script|\sstyle=|\son\w+=/i);
});

test('groups, links and optional counts preserve supplied order without mutation', () => {
  const ctx = context();
  const original = structuredClone(ctx);
  const html = main(render(ctx));
  assert.ok(html.indexOf('By sector') < html.indexOf('By year'));
  assert.ok(html.indexOf('Healthcare') < html.indexOf('Education'));
  assert.ok(html.indexOf('2026') < html.indexOf('2025'));
  assert.match(html, /1,234<span class="sr-only"> entries/);
  assert.match(html, /class="browse-count">0<span/);
  assert.equal((html.match(/class="browse-count"/g) || []).length, 3);
  assert.deepEqual(ctx, original);
});

test('heading IDs are unique even when supplied headings repeat or look like IDs', () => {
  const group = { heading: 'main', links: [{ label: 'Record', href: '/' }] };
  const html = render(context({ groups: [group, group, { ...group, heading: 'browse-group-1' }] }));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['browse-group-1', 'browse-group-2', 'browse-group-3']) {
    assert.ok(html.includes(`aria-labelledby="${id}"`));
    assert.ok(html.includes(`<h2 id="${id}">`));
  }
});

test('all supplied content and metadata attributes are escaped', () => {
  const payload = '\"><script>alert(1)</script>&';
  const html = render(context({
    title: payload,
    description: payload,
    route: '/test"<>&',
    site: { ...config.site, language: 'en"<>', name: payload, tagline: payload },
    assets: { 'styles.css': 'style"<>.css' },
    groups: [{ heading: payload, description: payload, links: [{ label: payload, href: '/test/?a="<>&b=1', count: payload }] }],
  }));
  assert.doesNotMatch(html, /<script|class="browse-count"/i);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.match(html, /href="\/test\/\?a=&quot;&lt;&gt;&amp;b=1"/);
  assert.match(html, /lang="en&quot;&lt;&gt;"/);
  assert.match(html, /href="\/assets\/style&quot;&lt;&gt;.css"/);
  assert.doesNotThrow(() => guardPage('/test', html));
});

test('unsafe or non-local links are omitted rather than activated', () => {
  const hrefs = [
    'javascript:alert(1)', 'data:text/html,bad', 'https://elsewhere.example/path',
    '//elsewhere.example', '/\\elsewhere.example', '\\elsewhere.example',
    '/\n/elsewhere.example', '/\t/elsewhere.example', '/\u0000evil',
    '/%2felsewhere.example', '/%5celsewhere.example', '/%255celsewhere.example',
    '/%0aelsewhere.example', '/%250delsewhere.example', ' /local/',
    '/malformed%zz', 'relative/path', '#fragment', '', null,
  ];
  for (const href of hrefs) {
    const html = main(render(context({ groups: [{ heading: 'Unsafe', links: [{ label: 'Unsafe target', href }] }] })));
    assert.match(html, /No browse links are available yet/, String(href));
    assert.doesNotMatch(html, /<a |browse-group-|Unsafe target/);
  }
});

test('root-relative links retain query parameters, fragments and escaped labels', () => {
  const hrefs = ['/', '/sector/healthcare/', '/breaches/2026/?sort=new&limit=25#records', '/rights/california%2Dlaw/'];
  const html = main(render(context({ groups: [{ heading: 'Links', links: hrefs.map((href) => ({ label: href, href })) }] })));
  assert.equal((html.match(/<a href=/g) || []).length, hrefs.length);
  assert.match(html, /href="\/breaches\/2026\/\?sort=new&amp;limit=25#records"/);
});

test('counts are never fabricated from invalid values', () => {
  for (const count of [undefined, null, '', ' ', 'not known', -1, 1.5, Infinity, NaN, false, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
    const html = main(render(context({ groups: [{ heading: 'Records', links: [{ label: 'Record', href: '/', count }] }] })));
    assert.doesNotMatch(html, /browse-count/);
    assert.match(html, /href="\/"/);
  }
});

test('empty groups and malformed entries are omitted; no usable groups yields an empty state', () => {
  const groups = [null, {}, { heading: 'Empty', links: [] }, { heading: 'No links' }, { heading: ' ', links: [{ label: 'Record', href: '/' }] }, { heading: 'Invalid', links: [null, {}, { label: '', href: '/' }] }];
  const html = main(render(context({ groups })));
  assert.match(html, /No browse links are available yet/);
  assert.doesNotMatch(html, /<section|<ul|browse-groups/);
  assert.match(render(context({ groups: [] })), /empty-state/);
  assert.match(render(context({ groups: undefined })), /empty-state/);
  assert.match(render(context({ groups: null })), /empty-state/);
  assert.match(render(context({ groups: {} })), /empty-state/);
  const mixed = main(render(context({ groups: [...groups, context().groups[0]] })));
  assert.equal((mixed.match(/<section/g) || []).length, 1);
  assert.match(mixed, /By sector/);
});

test('page routes must be supplied, local, and canonicalized without duplicate slashes', () => {
  for (const route of [undefined, '//external.example', 'javascript:evil', '/test?query=1', '/test#fragment']) {
    assert.throws(() => render(context({ route })), /local route/);
  }
  assert.match(render(context({ route: '/test-index/' })), /canonical" href="https:\/\/breachbook.org\/test-index\/"/);
  assert.throws(() => render(context({ site: { ...config.site, origin: 'javascript:bad' } })), /HTTP\(S\)/);
});

test('browse index stays outside production routing, navigation and build wiring', () => {
  assert.ok(config.routes.every((route) => route.template !== 'browse-index' && !route.path.startsWith('/browse')));
  const build = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');
  const layout = fs.readFileSync(path.join(__dirname, 'layout.js'), 'utf8');
  assert.doesNotMatch(build, /browse-index|\/browse/);
  assert.doesNotMatch(layout, /href="\/browse/);
});
