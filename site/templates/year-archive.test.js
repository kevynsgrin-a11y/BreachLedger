// Year archive template (/breaches/<year>). Untested before round 3.
//
// The behavior worth pinning here is the aggregation the page does before it
// renders: it sorts newest-first without mutating its input, totals only the
// records that actually disclose a count, and shards the list into real files.

const test = require('node:test');
const assert = require('node:assert/strict');

const { render } = require('./year-archive');
const { PAGE_SIZE } = require('./breach-table');
const { site } = require('../../ue.config');

const ctx = (over = {}) => ({
  site,
  year: '2026',
  breaches: [],
  years: [],
  assets: {},
  ...over,
});

const breach = (over = {}) => ({
  slug: 'acme-corp-2026-01',
  entity_name: 'Acme Corp',
  sector: 'healthcare',
  notification_date: '2026-01-15',
  records_affected: 1000,
  severity_score: 40,
  ...over,
});

test('a year page states the year, and only that year, in its heading', () => {
  const html = render(ctx({ breaches: [breach()], years: ['2026', '2025'] }));
  assert.match(html, /<h1>Breaches reported in 2026<\/h1>/);
  assert.doesNotMatch(html, /<h1>Breaches reported in 2025<\/h1>/);
});

test('records are listed newest first, and the input order is left alone', () => {
  const breaches = [
    breach({ slug: 'old', entity_name: 'Oldest', notification_date: '2026-01-01' }),
    breach({ slug: 'new', entity_name: 'Newest', notification_date: '2026-03-09' }),
    breach({ slug: 'mid', entity_name: 'Middle', notification_date: '2026-02-02' }),
  ];
  const order = breaches.map((b) => b.slug);
  const html = render(ctx({ breaches }));

  const at = (slug) => html.indexOf(slug);
  assert.ok(at('new') < at('mid') && at('mid') < at('old'), 'rows are not newest-first');
  assert.deepEqual(breaches.map((b) => b.slug), order, 'render mutated the caller array');
});

test('the total counts only records that disclose a count', () => {
  const html = render(
    ctx({
      breaches: [
        breach({ slug: 'a', records_affected: 2500 }),
        breach({ slug: 'b', records_affected: 1500 }),
        // Undisclosed: must contribute nothing and must not be counted as one
        // of the "records that disclose a count".
        breach({ slug: 'c', records_affected: null }),
      ],
    })
  );
  assert.match(html, /The 2 records that disclose a count total 4,000 individuals affected\./);
  assert.doesNotMatch(html, /4,500/);
});

test('with no disclosed counts the page omits the totals sentence entirely', () => {
  const html = render(ctx({ breaches: [breach({ records_affected: null })] }));
  assert.doesNotMatch(html, /disclose a count/);
  assert.match(html, /1 breach entered the public record in 2026\./);
});

test('the count sentence agrees in number with the breach count', () => {
  const html = render(ctx({ breaches: [breach({ records_affected: 10 })] }));
  assert.match(html, /The 1 record that disclose a count/, 'a single record reads as "1 record"');
});

test('other years are cross-linked, newest first, and the current year is omitted', () => {
  const html = render(ctx({ breaches: [breach()], years: ['2024', '2026', '2025'] }));
  const links = [...html.matchAll(/<a href="\/breaches\/(\d{4})\/">\d{4}<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(links, ['2025', '2024'], 'expected only the other years, newest first');
  assert.doesNotMatch(html, /href="\/breaches\/2026\/">2026<\/a>/);
});

test('a lone year renders no "Other years" heading', () => {
  const html = render(ctx({ breaches: [breach()], years: ['2026'] }));
  assert.doesNotMatch(html, /<h2>Other years<\/h2>/);
});

test('page 1 keeps the bare year path so the canonical URL never changes', () => {
  const html = render(ctx({ breaches: [breach()] }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/breaches\/2026\/">/);
  assert.match(html, /<title>Data breaches reported in 2026 — BreachBook<\/title>/);
});

test('each shard past page 1 is its own real file and says which one it is', () => {
  const breaches = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => breach({ slug: `b-${i}` }));
  const html = render(ctx({ breaches, page: 2 }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/breaches\/2026\/2\/">/);
  assert.match(html, /page 2 of 2/);
  assert.match(html, /Data breaches reported in 2026 — page 2/);
});

test('a page number beyond the last one is clamped rather than rendering empty', () => {
  const html = render(ctx({ breaches: [breach()], page: 99 }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/breaches\/2026\/">/);
  assert.doesNotMatch(html, /page 99/);
});

test('shards partition the year so no record is dropped or repeated', () => {
  const breaches = Array.from({ length: PAGE_SIZE + 3 }, (_, i) =>
    breach({ slug: `b-${i}`, entity_name: `Entity ${i}`, notification_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` })
  );
  const seen = new Set();
  for (const p of [1, 2]) {
    const html = render(ctx({ breaches, page: p }));
    for (const m of html.matchAll(/href="\/breach\/([^/"]+)\/"/g)) {
      assert.ok(!seen.has(m[1]), `${m[1]} appeared on more than one shard`);
      seen.add(m[1]);
    }
  }
  assert.equal(seen.size, breaches.length, 'every record should be reachable across the shards');
});

test('an empty year renders the shared empty state, not a broken table', () => {
  const html = render(ctx({ breaches: [] }));
  assert.match(html, /0 breaches entered the public record in 2026\./);
  assert.match(html, /No breaches are on the record here yet\./);
  assert.doesNotMatch(html, /<tbody>/, 'an empty year must not emit an empty table body');
});

test('a hostile year is escaped in the visible text, not injected', () => {
  // The year itself can never be hostile: site/build.js derives it as
  // notification_date.slice(0,4) and skips anything failing /^\d{4}$/, so only
  // four digits ever reach render(). This pins the escaping anyway, because the
  // template must not be the thing that depends on that upstream filter.
  const html = render(ctx({ year: '<script>alert(1)</script>', breaches: [breach()] }));
  assert.match(html, /<h1>Breaches reported in &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
  assert.doesNotMatch(html, /<h1>Breaches reported in <script>/);
  assert.doesNotMatch(html, /<h1>[^<]*<script>alert/);
});

test('records missing a date sort last rather than throwing', () => {
  const html = render(
    ctx({
      breaches: [
        breach({ slug: 'undated', entity_name: 'Undated', notification_date: null }),
        breach({ slug: 'dated', entity_name: 'Dated', notification_date: '2026-05-05' }),
      ],
    })
  );
  assert.ok(html.includes('Undated') && html.includes('Dated'));
  assert.ok(html.indexOf('Dated') < html.indexOf('Undated'));
});
