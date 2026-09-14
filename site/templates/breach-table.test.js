const test = require('node:test');
const assert = require('node:assert/strict');

const { breachRows, paginate, pager, pageCount, pagePath, PAGE_SIZE } = require('./breach-table');

const many = (n) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `breach-${i}`,
    entity_name: `Entity ${i}`,
    sector: 'healthcare',
    notification_date: '2026-01-01',
    records_affected: 100 + i,
    severity_score: 25,
  }));

test('pageCount never returns zero, even for an empty set', () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(1), 1);
  assert.equal(pageCount(PAGE_SIZE), 1);
  assert.equal(pageCount(PAGE_SIZE + 1), 2);
});

test('paginate slices the requested page and the last page is partial', () => {
  const items = many(PAGE_SIZE + 5);
  assert.equal(paginate(items, 1).length, PAGE_SIZE);
  assert.equal(paginate(items, 2).length, 5);
  assert.equal(paginate(items, 1)[0].slug, 'breach-0');
  assert.equal(paginate(items, 2)[0].slug, `breach-${PAGE_SIZE}`);
});

test('paginate clamps a bad page number to the first page', () => {
  const items = many(10);
  assert.equal(paginate(items, 0).length, 10);
  assert.equal(paginate(items, -3).length, 10);
});

test('every record appears exactly once across all pages', () => {
  const items = many(457);
  const seen = new Set();
  for (let p = 1; p <= pageCount(items.length); p++) {
    for (const b of paginate(items, p)) {
      assert.ok(!seen.has(b.slug), `${b.slug} appeared on more than one page`);
      seen.add(b.slug);
    }
  }
  assert.equal(seen.size, 457, 'no record may be dropped by pagination');
});

test('page 1 keeps the bare path so a hub canonical URL never moves', () => {
  assert.equal(pagePath('/sector/healthcare/', 1), '/sector/healthcare/');
  assert.equal(pagePath('/sector/healthcare/', 2), '/sector/healthcare/2/');
});

test('a single page emits no pager at all', () => {
  assert.equal(pager('/sector/healthcare/', 1, 1), '');
});

test('the first page offers next but not previous', () => {
  const html = pager('/sector/healthcare/', 1, 5);
  assert.ok(html.includes('rel="next"'));
  assert.ok(!html.includes('rel="prev"'));
  assert.ok(html.includes('Page 1 of 5'));
});

test('the last page offers previous but not next', () => {
  const html = pager('/sector/healthcare/', 5, 5);
  assert.ok(html.includes('rel="prev"'));
  assert.ok(!html.includes('rel="next"'));
});

test('a middle page links both directions and back to the first', () => {
  const html = pager('/sector/healthcare/', 3, 5);
  assert.ok(html.includes('href="/sector/healthcare/2/" rel="prev"'));
  assert.ok(html.includes('href="/sector/healthcare/4/" rel="next"'));
  assert.ok(html.includes('href="/sector/healthcare/"'), 'First link returns to the bare path');
});

test('the pager is a labelled navigation landmark', () => {
  assert.ok(pager('/sector/healthcare/', 2, 4).includes('aria-label="Pagination"'));
});

test('breachRows escapes entity names', () => {
  const html = breachRows([
    { slug: 'x', entity_name: '<script>alert(1)</script>', sector: 'healthcare', notification_date: '2026-01-01' },
  ]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('an undisclosed record count is labelled, not blank', () => {
  const html = breachRows([
    { slug: 'x', entity_name: 'Acme', sector: 'healthcare', notification_date: '2026-01-01', records_affected: null },
  ]);
  assert.ok(html.includes('not disclosed'));
});

test('an empty set renders the empty state rather than a headless table', () => {
  const html = breachRows([]);
  assert.ok(html.includes('empty-state'));
  assert.doesNotMatch(html, /<table|listing-legend|<svg/);
});

const { render: home } = require('./home');
const { render: sector } = require('./sector-hub');
const { render: year } = require('./year-archive');
const { guardPage } = require('../build');
const { site } = require('../../ue.config');

const row = (overrides = {}) => ({ ...many(1)[0], ...overrides });
const renderedRows = (html) => [...html.matchAll(/<tr class="listing-row listing-row--(\w+)">([\s\S]*?)<\/tr>/g)]
  .map((match) => ({ alignment: match[1], html: match[2] }));
const states = (html) => renderedRows(html).map((record) => record.alignment);

const alignmentRows = () => [
  row({ slug: 'standard', records_affected: 1000, notification_date: '2026-01-02' }),
  row({ slug: 'largest', records_affected: 10000000, notification_date: '2026-01-01' }),
  row({ slug: 'newest', records_affected: 1500, notification_date: '2026-01-03' }),
];

test('graphics classify largest, standard and newest without sorting or mutating rows', () => {
  const records = alignmentRows().map(Object.freeze);
  Object.freeze(records);
  const html = breachRows(records);
  assert.deepEqual(states(html), ['standard', 'largest', 'newest']);
  assert.deepEqual(renderedRows(html).map((r) => /href="\/breach\/([^/]+)/.exec(r.html)[1]), ['standard', 'largest', 'newest']);
  assert.equal((html.match(/class="listing-graphic-slot"/g) || []).length, 6);
  assert.equal((html.match(/class="listing-number num"/g) || []).length, 6);
  assert.match(html, /within the rows shown/);
  assert.match(html, /logarithmic scale from 500 to 10 million/);
  assert.match(html, /severity bars use 0–100/);
  assert.match(html, /Latest notification among rows shown; graphics aligned right/);
  assert.match(html, /Largest disclosed count among rows shown; graphics aligned left/);
});

test('all ties qualify and largest takes precedence over newest', () => {
  const rows = [
    row({ records_affected: 5000, notification_date: '2026-01-04' }),
    row({ records_affected: '5000', notification_date: '2026-01-01' }),
    row({ records_affected: 500, notification_date: '2026-01-04' }),
    row({ records_affected: 900, notification_date: '2026-01-04' }),
  ];
  assert.deepEqual(states(breachRows(rows)), ['largest', 'largest', 'newest', 'newest']);
  assert.deepEqual(states(breachRows([rows[0]])), ['largest']);
});

test('invalid and absent counts never become zero or win largest', () => {
  for (const value of [undefined, null, '', ' ', 'no count', '0x10', -1, '-1', Infinity, NaN, 'Infinity', true, false, [], {}]) {
    const html = breachRows([row({ records_affected: value, severity_score: null, notification_date: null })]);
    assert.deepEqual(states(html), ['standard'], `invalid count: ${String(value)}`);
    assert.match(html, /not disclosed/);
    assert.doesNotMatch(html, /<svg|listing-ruler-marker|listing-score-fill/);
  }
});

test('zero remains disclosed, numeric strings work, and estimates remain visible', () => {
  const html = breachRows([
    row({ records_affected: 0, severity_score: '0' }),
    row({ records_affected: ' 1234 ', records_affected_is_est: true, severity_score: '25.25' }),
  ]);
  assert.match(html, /class="listing-value">0<\/span>/);
  assert.match(html, /1,234 \(est\.\)/);
  assert.match(html, /25\.25 \/ 100/);
  assert.match(html, /listing-score-fill sev-25/);
  assert.match(html, /listing-score-fill sev-0/);
  assert.deepEqual(states(html), ['newest', 'largest']);
});

test('ruler endpoints, log midpoint and out-of-range counts keep exact values', () => {
  const cases = [
    [0, '4.00', 'Below 500'],
    [499, '4.00', 'Below 500'],
    [500, '4.00', null],
    [Math.sqrt(500 * 10000000), '60.00', null],
    [10000000, '116.00', null],
    [10000001, '116.00', 'Above 10 million'],
  ];
  for (const [count, position, note] of cases) {
    const html = breachRows([row({ records_affected: count })]);
    assert.ok(html.includes(`class="listing-ruler-marker" x1="${position}" y1="2" x2="${position}"`));
    assert.ok(html.includes(count.toLocaleString('en-US', { maximumFractionDigits: 20 })));
    if (note) assert.ok(html.includes(note));
    else assert.doesNotMatch(html, /listing-range-note/);
  }
});

test('severity validates its range and rounds only the graphic', () => {
  for (const score of [0, 100, '0', '100', 22.75]) {
    const html = breachRows([row({ severity_score: score })]);
    assert.ok(html.includes(`${Number(score)} / 100`));
    assert.ok(html.includes(`listing-score-fill sev-${Math.round(Number(score))}`));
  }
  for (const score of [null, undefined, '', ' ', -1, 101, Infinity, NaN, false, {}, 'invalid']) {
    const html = breachRows([row({ severity_score: score })]);
    assert.doesNotMatch(html, /listing-score-fill|listing-score-track/);
    assert.match(html, /class="sr-only">not disclosed/);
  }
});

test('only valid calendar dates can qualify as newest', () => {
  for (const date of [null, '', ' ', 'invalid', '2026-99-99', '2026-02-29', '2026-02-30', '2026-04-31', '2099-1-01', '2026-01-03T00:00:00Z']) {
    assert.deepEqual(states(breachRows([
      row({ records_affected: 10000, notification_date: '2026-01-01' }),
      row({ records_affected: 100, notification_date: date }),
      row({ records_affected: null, notification_date: '2026-01-02' }),
    ])), ['largest', 'standard', 'newest']);
  }
  assert.deepEqual(states(breachRows([
    row({ records_affected: null, notification_date: '2024-02-28' }),
    row({ records_affected: null, notification_date: '2024-02-29' }),
  ])), ['standard', 'newest']);
});

test('captions, headings, hidden graphics and keyboard-scrollable regions stay accessible', () => {
  const html = breachRows(alignmentRows(), { showSector: false, caption: 'A & B', dateHeading: 'Notification date', numericAlignment: 'left' });
  assert.match(html, /<caption class="sr-only">A &amp; B<\/caption>/);
  assert.match(html, /<th scope="col">Notification date<\/th>/);
  assert.doesNotMatch(html, /<th scope="col">Sector|listing-number num/);
  assert.match(html, /tabindex="0" role="region" aria-label="A &amp; B"/);
  assert.equal((html.match(/listing-graphic-slot" aria-hidden="true"/g) || []).length, 6);
  assert.equal((html.match(/focusable="false"/g) || []).length, 3);
});

test('all table text is escaped and encodings introduce no inline CSS or executable code', () => {
  const payload = '\"><script>alert(1)</script>';
  const html = breachRows([row({ slug: payload, entity_name: payload, sector: payload, notification_date: payload })], {
    caption: payload,
    dateHeading: payload,
    numericAlignment: payload,
  });
  assert.doesNotMatch(html, /<script|\sstyle=|\son\w+=/i);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.doesNotThrow(() => guardPage('/test', `<!doctype html><title>Test</title>${html}`));
});

test('homepage uses shared graphics while retaining its heading, alignment and 25-row limit', () => {
  const breaches = many(26).map((b, i) => Object.freeze({
    ...b,
    notification_date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    records_affected: i === 0 ? 10000000 : i + 500,
  }));
  Object.freeze(breaches);
  const html = home({ site, breaches, litigation: [] });
  const rows = renderedRows(html);
  assert.equal(rows.length, 25);
  assert.match(html, /The 25 most recently reported breaches/);
  assert.match(html, /<th scope="col">Notification date/);
  assert.doesNotMatch(rows.map((r) => r.html).join(''), /listing-number num|href="\/breach\/breach-0\//);
  assert.match(rows[0].html, /href="\/breach\/breach-25\//);
  assert.equal(rows[0].alignment, 'largest');
  assert.match(html, /Open settlements|Coverage today is healthcare only/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotThrow(() => guardPage('/', html));
});

test('homepage retains its custom empty state and leaves settlement tables unencoded', () => {
  const html = home({ site, breaches: [], litigation: [{ case_name: 'A case', claim_deadline: '2026-12-01', official_claim_url: 'https://example.org', administrator_name: 'Administrator' }] });
  assert.match(html, /No breach records are published yet/);
  assert.match(html, /See <a href="\/sources\/">sources and methodology/);
  assert.match(html, /Settlements with an open claim deadline/);
  assert.doesNotMatch(html, /breach-listing|listing-graphic/);
});

for (const [name, render, extra, path] of [
  ['sector', sector, { sector: 'healthcare' }, '/sector/healthcare/'],
  ['year', year, { year: '2026', years: ['2026', '2025'] }, '/breaches/2026/'],
]) {
  test(`${name} pages classify only the visible page without changing pagination`, () => {
    const breaches = many(PAGE_SIZE + 3).map((b, i) => Object.freeze({ ...b, records_affected: i === 0 ? 10000000 : 500 + i }));
    Object.freeze(breaches);
    const html = render({ site, breaches, ...extra, page: 2 });
    const rows = renderedRows(html);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.alignment), ['newest', 'newest', 'largest']);
    assert.match(rows[0].html, new RegExp(`href="/breach/breach-${PAGE_SIZE}/"`));
    assert.equal((html.match(/class="listing-number num"/g) || []).length, 6);
    assert.match(html, /<th scope="col">Reported/);
    assert.match(html, /page 2 of 2/);
    assert.ok(html.includes(`href="${path}" rel="prev"`));
    assert.ok(html.includes(`rel="canonical" href="${site.origin}${path}2/"`));
    assert.doesNotThrow(() => guardPage(`${path}2`, html));
  });
}
