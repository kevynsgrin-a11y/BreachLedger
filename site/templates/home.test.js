// Home page template (/). Untested before round 3.
//
// The home page makes two claims the rest of the site does not: it caps the
// recent table at 25 rows, and it states coverage scope on the front page
// whenever a single sector supplies every published record. Both are pinned
// here, along with the "not disclosed" rendering rules the table shares with
// breach-table.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { render } = require('./home');
const { site } = require('../../ue.config');

const ctx = (over = {}) => ({ site, breaches: [], litigation: [], assets: {}, ...over });

const breach = (over = {}) => ({
  slug: 'acme-corp-2026-01',
  entity_name: 'Acme Corp',
  sector: 'healthcare',
  notification_date: '2026-01-15',
  records_affected: 1000,
  severity_score: 40,
  ...over,
});

const litigation = (over = {}) => ({
  case_name: 'In re Acme Data Litigation',
  claim_deadline: '2026-06-30',
  official_claim_url: 'https://example-claims.test/acme',
  administrator_name: 'Acme Settlement Admin',
  ...over,
});

test('the home page renders an empty state rather than an empty table', () => {
  const html = render(ctx());
  assert.match(html, /No breach records are published yet\./);
  assert.doesNotMatch(html, /<tbody>/);
});

test('at most 25 breaches are listed, newest first', () => {
  const breaches = Array.from({ length: 40 }, (_, i) =>
    breach({ slug: `b-${i}`, entity_name: `Entity ${i}`, notification_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` })
  );
  const html = render(ctx({ breaches }));
  const rows = [...html.matchAll(/<tr>\n<td><a href="\/breach\//g)].length;
  assert.equal(rows, 25, 'the recent table must be capped at 25 rows');
  assert.match(html, /The 25 most recently reported breaches on the record/);
});

test('the capped list is the newest 25, not the first 25 of the input', () => {
  const breaches = [
    breach({ slug: 'newest', entity_name: 'Newest Co', notification_date: '2026-09-09' }),
    ...Array.from({ length: 30 }, (_, i) =>
      breach({ slug: `old-${i}`, entity_name: `Old ${i}`, notification_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` })
    ),
  ];
  const html = render(ctx({ breaches }));
  assert.match(html, /Newest Co/);
  assert.doesNotMatch(html, /Old 29/);
});

test('a disclosed record count is formatted, and an estimated one is marked', () => {
  const html = render(
    ctx({
      breaches: [
        breach({ slug: 'exact', entity_name: 'Exact Co', records_affected: 1234567 }),
        breach({ slug: 'est', entity_name: 'Est Co', records_affected: 500, records_affected_is_est: true }),
      ],
    })
  );
  assert.match(html, /1,234,567/);
  assert.doesNotMatch(html, /1,234,567 \(est\.\)/, 'an exact count must not be marked estimated');
  assert.match(html, /500 \(est\.\)/);
});

test('an undisclosed record count says so, and an undisclosed score is left blank', () => {
  const html = render(ctx({ breaches: [breach({ records_affected: null, severity_score: null })] }));
  assert.match(html, /not disclosed/);
  assert.doesNotMatch(html, /null/, 'a null value must never be printed');
});

test('only settlements that are genuinely open are listed', () => {
  const html = render(
    ctx({
      litigation: [
        litigation({ case_name: 'Open Case' }),
        // Missing one of the two fields that make a claim actionable: neither
        // may be advertised as open.
        litigation({ case_name: 'No Deadline', claim_deadline: null }),
        litigation({ case_name: 'No URL', official_claim_url: null }),
      ],
    })
  );
  assert.match(html, /Open Case/);
  assert.doesNotMatch(html, /No Deadline/);
  assert.doesNotMatch(html, /No URL/);
});

test('no open settlements renders the empty state that disclaims claims', () => {
  const html = render(ctx({ litigation: [litigation({ claim_deadline: null })] }));
  assert.match(html, /No settlements are open yet\./);
  assert.doesNotMatch(html, /<tbody>/);
});

test('a single-sector record is disclosed as such on the front page', () => {
  const html = render(ctx({ breaches: [breach({ sector: 'healthcare' })] }));
  assert.match(html, /Coverage today is healthcare only/);
  assert.match(html, /is not yet comprehensive across sectors\./);
});

test('a multi-sector record makes no single-sector coverage claim', () => {
  const html = render(
    ctx({ breaches: [breach({ sector: 'healthcare' }), breach({ slug: 'b2', sector: 'financial' })] })
  );
  assert.doesNotMatch(html, /Coverage today is/);
});

test('records with no sector at all make no coverage claim rather than claiming nothing', () => {
  const html = render(ctx({ breaches: [breach({ sector: null })] }));
  assert.doesNotMatch(html, /Coverage today is/);
});

test('a hostile entity name is escaped, not injected', () => {
  const html = render(ctx({ breaches: [breach({ entity_name: '<script>alert(1)</script>' })] }));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('the front page is the canonical root and describes the record once', () => {
  const html = render(ctx({ breaches: [breach()] }));
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/">/);
  assert.match(html, /<title>BreachBook — A public record of disclosed U\.S\. data breaches<\/title>/);
  assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1, 'exactly one canonical URL');
});
