// Sector hub template (/sector/<sector>). Untested before round 3.
//
// The hub carries an explicit claim in its own source: the counts it prints
// describe the whole sector, not the shard on screen, so a reader on page 3 is
// not told the sector is three rows long. That, the sector label map, and the
// canonical-path rules are what these tests pin.

const test = require('node:test');
const assert = require('node:assert/strict');

const { render, SECTOR_LABEL } = require('./sector-hub');
const { PAGE_SIZE } = require('./breach-table');
const { site } = require('../../ue.config');

const ctx = (over = {}) => ({
  site,
  sector: 'healthcare',
  breaches: [],
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

test('a known sector renders its human label, not its slug', () => {
  const html = render(ctx({ sector: 'financial' }));
  assert.match(html, /<h1>Financial services breaches<\/h1>/);
});

test('every sector in the label map renders, and none render as a raw slug', () => {
  for (const [sector, label] of Object.entries(SECTOR_LABEL)) {
    const html = render(ctx({ sector }));
    assert.match(html, new RegExp(`<h1>${label} breaches</h1>`), `${sector} did not render as "${label}"`);
  }
});

test('an unmapped sector falls back to its own name instead of rendering empty', () => {
  const html = render(ctx({ sector: 'aerospace' }));
  assert.match(html, /<h1>aerospace breaches<\/h1>/);
});

test('counts describe the whole sector, not just the visible shard', () => {
  const breaches = Array.from({ length: PAGE_SIZE + 5 }, (_, i) =>
    breach({ slug: `b-${i}`, entity_name: `Entity ${i}`, notification_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` })
  );
  const html = render(ctx({ breaches, page: 2 }));
  assert.match(
    html,
    new RegExp(`${PAGE_SIZE + 5} breaches on the record in this sector\\.`),
    'the sector total must not shrink to the visible page'
  );
});

test('only records that disclose a count are totalled', () => {
  const html = render(
    ctx({
      breaches: [
        breach({ slug: 'a', records_affected: 2000 }),
        breach({ slug: 'b', records_affected: null }),
        breach({ slug: 'c', records_affected: 1000 }),
      ],
    })
  );
  assert.match(html, /The 2 records that disclose a count total 3,000 individuals affected\./);
  assert.doesNotMatch(html, /disclose a count total 2,000/);
});

test('the disclosure sentence is omitted when nothing discloses a count', () => {
  const html = render(ctx({ breaches: [breach({ records_affected: null })] }));
  assert.doesNotMatch(html, /disclose a count/);
});

test('page 1 keeps the bare sector path as the canonical URL', () => {
  const html = render(ctx({ breaches: [breach()] }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/sector\/healthcare\/">/);
  assert.match(html, /<title>Healthcare data breaches — BreachBook<\/title>/);
});

test('shards past page 1 get their own path and page number', () => {
  const breaches = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => breach({ slug: `b-${i}` }));
  const html = render(ctx({ breaches, page: 2 }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/sector\/healthcare\/2\/">/);
  assert.match(html, /page 2 of 2/);
});

test('an out-of-range page is clamped to the last shard, not left empty', () => {
  const html = render(ctx({ breaches: [breach()], page: 42 }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/sector\/healthcare\/">/);
  assert.doesNotMatch(html, /page 42/);
});

test('the pluralized count agrees with the number of records', () => {
  assert.match(render(ctx({ breaches: [breach()] })), /1 breach on the record/);
  assert.match(render(ctx({ breaches: [breach(), breach({ slug: 'z' })] })), /2 breaches on the record/);
});

test('every record is reachable across the shards exactly once', () => {
  const breaches = Array.from({ length: PAGE_SIZE + 7 }, (_, i) =>
    breach({ slug: `b-${i}`, entity_name: `Entity ${i}`, notification_date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}` })
  );
  const seen = new Set();
  for (const p of [1, 2]) {
    for (const m of render(ctx({ breaches, page: p })).matchAll(/href="\/breach\/([^/"]+)\/"/g)) {
      assert.ok(!seen.has(m[1]), `${m[1]} appeared on more than one shard`);
      seen.add(m[1]);
    }
  }
  assert.equal(seen.size, breaches.length);
});

test('an empty sector renders the shared empty state, not a broken table', () => {
  const html = render(ctx({ breaches: [] }));
  assert.match(html, /0 breaches on the record in this sector\./);
  assert.match(html, /No breaches are on the record here yet\./);
  assert.doesNotMatch(html, /<tbody>/);
});

test('a hostile sector is escaped in the visible text, not injected', () => {
  const html = render(ctx({ sector: '<script>alert(1)</script>' }));
  assert.match(html, /<h1>&lt;script&gt;alert\(1\)&lt;\/script&gt; breaches<\/h1>/);
  assert.doesNotMatch(html, /<h1><script>/);
  assert.doesNotMatch(html, /<h1>[^<]*<script>alert/);
});

test('the hub links back to the full record and to the methodology page', () => {
  const html = render(ctx({ breaches: [breach()] }));
  assert.match(html, /<a href="\/">All sectors<\/a>/);
  assert.match(html, /<a href="\/sources\/">How this record is compiled<\/a>/);
});
