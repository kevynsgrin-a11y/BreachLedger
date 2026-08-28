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
  assert.ok(breachRows([]).includes('empty-state'));
});
