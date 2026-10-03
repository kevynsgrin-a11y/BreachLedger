// Severity rubric template (/severity). Untested before round 3.
//
// The rubric page is the site's published promise that a score is reproducible
// rather than invented: it prints the formula, the data-class weights, and all
// three modifier bands. These tests render the real packages/severity/rubric.json
// and the real seed data-classes.json, so a change to the scoring data that
// stopped being visible on this page would fail here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { render } = require('./severity');
const { escapeHtml } = require('./markdown');
const rubric = require('../../packages/severity/rubric.json');
const { classes } = require('../../packages/schema/seed/data-classes.json');
const { site } = require('../../ue.config');

const ctx = (over = {}) => ({ site, rubric, dataClasses: classes, assets: {}, ...over });

test('the page publishes the rubric version it was rendered from', () => {
  const html = render(ctx());
  assert.match(html, new RegExp(`Severity rubric, version ${rubric.version}`));
  assert.match(html, new RegExp(`<title>Severity rubric v${rubric.version} — BreachBook</title>`));
});

test('the scoring formula is shown, so a score is never a bare number', () => {
  const html = render(ctx());
  assert.ok(html.includes(rubric.formula), 'the published formula must appear verbatim on the page');
});

test('every data class in the seed is published with its weight', () => {
  const html = render(ctx());
  for (const c of classes) {
    assert.ok(html.includes(escapeHtml(c.label)), `${c.code} is missing from the published weights`);
  }
});

test('data classes are listed heaviest weight first', () => {
  const html = render(ctx());
  const positions = classes
    .slice()
    .sort((a, b) => b.severity_weight - a.severity_weight)
    .map((c) => html.indexOf(escapeHtml(c.label)));
  assert.ok(!positions.includes(-1), 'every data class should appear on the page');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i], 'weights are not in descending order');
  }
});

test('a permanence value reads as prose rather than as a raw token', () => {
  const html = render(ctx());
  assert.ok(html.includes('semi-permanent'), 'semi_permanent should render as semi-permanent');
  assert.ok(!html.includes('semi_permanent>'), 'the raw underscore token should not be published');
});

test('every modifier band of the real rubric is published, with its points', () => {
  const html = render(ctx());
  for (const band of rubric.scale_modifier.bands) {
    assert.ok(html.includes(escapeHtml(band.label)), `scale band "${band.label}" is not published`);
  }
  for (const band of rubric.remediation_gap_modifier.bands) {
    // Underscores become spaces for readability, then the cell is escaped —
    // "months < 12" publishes as "months &lt; 12".
    const rendered = escapeHtml(band.condition.replace(/_/g, ' '));
    assert.ok(html.includes(rendered), `remediation band "${band.condition}" is not published`);
  }
});

test('the open-ended lag band reads as a range rather than as "null"', () => {
  const html = render(ctx());
  const open = rubric.notification_lag_modifier.bands.find((b) => b.max_days === null);
  assert.ok(open, 'the rubric should have an open-ended lag band');
  assert.ok(html.includes(`over ${open.min_days - 1} days`), 'the open band must be expressed as a range');
  assert.doesNotMatch(html, />null</, 'a null bound must never be printed');
});

test('the four components and their caps are all stated', () => {
  const html = render(ctx());
  assert.ok(html.includes(`capped at ${rubric.data_class_subtotal.cap}`));
  assert.ok(html.includes(`scale modifier (0&ndash;${rubric.scale_modifier.max})`));
  assert.ok(html.includes(`remediation gap modifier (0&ndash;${rubric.remediation_gap_modifier.max})`));
  assert.ok(html.includes(`notification lag modifier (0&ndash;${rubric.notification_lag_modifier.max})`));
});

test('the page states the rubric is editorial policy, not a government source', () => {
  const html = render(ctx());
  assert.match(html, /editorial policy, not a government source/);
});

test('a hostile data-class label is escaped, not injected', () => {
  const html = render(
    ctx({
      dataClasses: [
        { code: 'x', label: '<script>alert(1)</script>', permanence: 'permanent', severity_weight: 1 },
      ],
    })
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a hostile rubric version is escaped, not injected', () => {
  const html = render(ctx({ rubric: { ...rubric, version: '<script>alert(1)</script>' } }));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /Severity rubric, version &lt;script&gt;/);
});

test('the rubric page lives at /severity and is indexable', () => {
  const html = render(ctx());
  assert.match(html, /<link rel="canonical" href="https:\/\/breachbook\.org\/severity\/">/);
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
});
