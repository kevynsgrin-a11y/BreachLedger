const test = require('node:test');
const assert = require('node:assert/strict');

const { render } = require('./state-rights');
const { render: renderIndex } = require('./state-rights-index');

const SITE = {
  name: 'BreachBook',
  tagline: 'A public record of disclosed U.S. data breaches',
  origin: 'https://breachbook.org',
  language: 'en-US',
};

const CT = {
  state_code: 'CT',
  state_name: 'Connecticut',
  notification_deadline_days: 60,
  ssn_triggers_notice: 1,
  free_credit_freeze: 1,
  mandated_monitoring_months: 24,
  ag_report_threshold: 1,
  statute_citation: 'Conn. Gen. Stat. § 36a-701b',
  statute_url: 'https://www.cga.ct.gov/current/pub/chap_669.htm',
  last_verified: '2026-08-02',
  _confidence: 'high',
  _notes: 'INTERNAL QA TRAIL: URL is the official cga.ct.gov chapter page; re-verified against PA 21-59.',
};

const AK = {
  state_code: 'AK',
  state_name: 'Alaska',
  notification_deadline_days: null,
  ssn_triggers_notice: 1,
  free_credit_freeze: 1,
  mandated_monitoring_months: null,
  ag_report_threshold: null,
  statute_citation: 'Alaska Stat. § 45.48.010',
  statute_url: 'https://www.akleg.gov/basis/statutes.asp#45.48.010',
  last_verified: '2026-08-02',
  _notes: 'INTERNAL QA TRAIL: no affirmative AG-notice duty.',
};

const build = (state, states = [CT, AK]) => render({ site: SITE, assets: {}, state, states });

test('reports the statutory deadline in days', () => {
  assert.ok(build(CT).includes('60 days'));
});

test('a null deadline is stated as a fact, never left blank', () => {
  const html = build(AK);
  assert.ok(/No fixed number of days appears in the statute/i.test(html));
});

test('a null monitoring requirement is stated rather than omitted', () => {
  assert.ok(/does not require the entity to provide identity theft monitoring/i.test(build(AK)));
});

test('a null AG threshold is stated as no general requirement', () => {
  assert.ok(/sets no general requirement to notify the attorney general/i.test(build(AK)));
});

test('an AG threshold of 1 reads as every qualifying breach, not "1 resident"', () => {
  const html = build(CT);
  assert.ok(/Every breach that requires notice to residents/i.test(html));
  assert.ok(!html.includes('threshold of 1 residents'));
});

// The seed stores thresholds as an inclusive lower bound and says so in its own
// notes ("recorded as at/above value"): a statute reading "more than 1,000" is
// stored as 1001. The page must render that boundary, not re-derive one.
test('a numeric AG threshold renders as an inclusive lower bound', () => {
  const html = build({ ...CT, ag_report_threshold: 500 });
  assert.ok(html.includes('500 or more residents'));
  assert.ok(!/more than 500/i.test(html), 'must not restate the figure as an exclusive bound');
});

test('a large threshold is thousands-separated', () => {
  assert.ok(build({ ...CT, ag_report_threshold: 1001 }).includes('1,001 or more residents'));
});

test('cites the statute and links to it', () => {
  const html = build(CT);
  assert.ok(html.includes('Conn. Gen. Stat.'));
  assert.ok(html.includes('https://www.cga.ct.gov/current/pub/chap_669.htm'));
});

test('shows the verification date', () => {
  assert.ok(build(CT).includes('last verified August 2, 2026'));
});

// The seed rows carry editorial working notes. They are not reader-facing and
// the seed loader does not write them to the database either.
test('never publishes the internal _notes or _confidence fields', () => {
  const html = build(CT);
  assert.ok(!html.includes('INTERNAL QA TRAIL'), '_notes must not reach the page');
  assert.ok(!html.includes('PA 21-59'), '_notes content must not reach the page');
  assert.ok(!/confidence/i.test(html), '_confidence must not reach the page');
});

test('carries the not-legal-advice disclaimer and uses no banned construction', () => {
  const html = build(CT);
  assert.ok(/not legal advice/i.test(html));
  assert.ok(/not a law firm/i.test(html));
  const lower = html.toLowerCase();
  for (const banned of ['you are entitled to', 'we can file for you', 'you should sue', 'you should ']) {
    assert.ok(!lower.includes(banned), `banned construction present: "${banned}"`);
  }
});

test('does not claim any organization broke the law', () => {
  const html = build(CT);
  assert.ok(
    /do not establish that any organization met or failed to meet them/i.test(html.replace(/\s+/g, ' ')),
    'the page must separate statutory duty from any finding of violation'
  );
});

test('canonical route uses the lowercased state code', () => {
  assert.ok(build(CT).includes('<link rel="canonical" href="https://breachbook.org/rights/ct/">'));
});

test('links to sibling jurisdictions but not to itself', () => {
  const html = build(CT);
  assert.ok(html.includes('/rights/ak/'));
  assert.ok(!html.includes('>Connecticut</a>'), 'must not link to the page being viewed');
});

test('index lists every jurisdiction with a link and a deadline column', () => {
  const html = renderIndex({ site: SITE, assets: {}, stateRights: [CT, AK] });
  assert.ok(html.includes('/rights/ct/'));
  assert.ok(html.includes('/rights/ak/'));
  assert.ok(html.includes('60 days'));
  assert.ok(html.includes('no fixed period'));
  assert.ok(html.includes('2 jurisdictions are'), 'states how many jurisdictions are recorded');
});

test('index reports how many jurisdictions set a fixed deadline', () => {
  const html = renderIndex({ site: SITE, assets: {}, stateRights: [CT, AK] });
  assert.ok(/1 set a fixed notification deadline/i.test(html));
});
