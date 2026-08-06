const test = require('node:test');
const assert = require('node:assert');
const { render } = require('./breach-detail');

const dataClasses = require('../../packages/schema/seed/data-classes.json').classes;
const dataClassMap = Object.fromEntries(dataClasses.map((c) => [c.code, c]));

const baseCtx = {
  site: { name: 'BreachBook', tagline: 'A public record of disclosed U.S. data breaches', origin: 'https://breachbook.org', language: 'en-US' },
  assets: { 'styles.css': 'styles.abc.css' },
  buildPhase: 1,
  dataClassMap,
  sourceLabels: { hhs_ocr: 'HHS OCR breach portal' },
  litigation: [],
};

const breach = {
  id: 'b1',
  slug: 'contoso-health-2025-03',
  entity_name: 'Contoso Health Network',
  sector: 'healthcare',
  notification_date: '2025-03-14',
  discovery_date: '2025-01-02',
  records_affected: 250000,
  records_affected_is_est: 0,
  breach_vector: 'hacking',
  data_classes_parsed: ['ssn', 'medical'],
  states_notified_parsed: [],
  remediation_offered_parsed: null,
};

const sources = [
  { source_type: 'hhs_ocr', source_url: 'https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf', retrieved_at: '2026-08-06' },
];

function renderOne(overrides = {}, srcs = sources) {
  return render({ ...baseCtx, breach: { ...breach, ...overrides }, sources: srcs });
}

test('renders all nine required blocks in spec order', () => {
  const html = renderOne();
  // Match the section headings themselves — the site nav also contains the word
  // "Sources", so a bare substring search would compare against the wrong node.
  const order = [
    '<h2>Severity score</h2>',
    '<h2>What was exposed</h2>',
    '<h2>Records affected</h2>',
    '<h2>Timeline</h2>',
    '<h2>Remediation offered by the entity</h2>',
    '<h2>States notified</h2>',
    '<h2>Litigation</h2>',
    '<h2>Sources</h2>',
  ];
  let last = -1;
  for (const heading of order) {
    const at = html.indexOf(heading);
    assert.ok(at > -1, `missing block: ${heading}`);
    assert.ok(at > last, `block out of order: ${heading}`);
    last = at;
  }
  // Entity name heading precedes every section; corrections link closes the page.
  assert.ok(html.indexOf('<h1>') < html.indexOf('<h2>Severity score</h2>'));
  assert.ok(html.indexOf('corrections-link') > html.indexOf('<h2>Sources</h2>'));
});

test('severity is shown with its component breakdown and rubric version, never bare', () => {
  const html = renderOne();
  // ssn 30 + medical 22 = 52; 250k -> 9; 71-day lag -> 3.
  // Remediation contributes 0, not 10: HHS does not report it, and rubric v1.1
  // does not penalize an entity for a gap in the government record.
  assert.match(html, /64 out of 100/);
  assert.match(html, /rubric v1\.1/);
  assert.match(html, /sev-64/);
  assert.match(html, /not reported by this source/);
  assert.match(html, /Data classes exposed/);
  assert.match(html, /Notification lag/);
  assert.match(html, /71 days elapsed/);
});

test('records affected is formatted, and estimates are marked', () => {
  assert.match(renderOne(), /250,000 individuals/);
  assert.match(renderOne({ records_affected_is_est: 1 }), /\(estimated\)/);
  assert.match(renderOne({ records_affected: null }), /Not disclosed in the source record/);
});

test('undisclosed fields say so rather than rendering blank or fabricating', () => {
  const html = renderOne({ discovery_date: null, breach_start_date: null });
  assert.match(html, /not disclosed/);
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('null<'));
});

test('missing remediation is reported as absent from the record, not as none offered', () => {
  const html = renderOne();
  assert.match(html, /does not report remediation/);
  assert.match(html, /does not mean none was/);
});

test('source block renders with a single source and shows retrieval date', () => {
  const html = renderOne();
  assert.match(html, /class="citations"/);
  assert.match(html, /HHS OCR breach portal/);
  assert.match(html, /retrieved August 6, 2026/);
});

test('data classes show permanence labels', () => {
  const html = renderOne();
  assert.match(html, /Social Security number/);
  assert.match(html, /permanent/);
});

test('links to sector hub and year archive use trailing slashes', () => {
  const html = renderOne();
  assert.match(html, /href="\/sector\/healthcare\/"/);
  assert.match(html, /href="\/breaches\/2025\/"/);
});

test('what-to-do link is withheld until phase 3', () => {
  assert.ok(!renderOne().includes('what-to-do'));
  const p3 = render({ ...baseCtx, buildPhase: 3, breach, sources });
  assert.match(p3, /what-to-do/);
});

test('entity names with HTML metacharacters are escaped', () => {
  const html = renderOne({ entity_name: 'Evil <script>alert(1)</script> & Co' });
  assert.ok(!html.includes('<script>alert'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; Co/);
});
