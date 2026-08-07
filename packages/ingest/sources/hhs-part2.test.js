const test = require('node:test');
const assert = require('node:assert');
const part2 = require('./hhs-part2');
const hhs = require('./hhs-ocr');

const ROW = {
  'Name of Covered Entity': 'Riverbend Recovery Services',
  State: 'OR',
  'Covered Entity Type': 'Healthcare Provider',
  'Individuals Affected': '4200',
  'Breach Submission Date': '05/09/2026',
  'Type of Breach': 'Hacking/IT Incident',
  'Location of Breached Information': 'Network Server',
  'Business Associate Present': 'No',
};
const OPTS = { retrievedAt: '2026-08-07T00:00:00.000Z', checksum: 'p2' };

test('attributes the record to the Part 2 listing, not the HIPAA one', () => {
  const { source } = part2.normalizeRow(ROW, OPTS);
  assert.equal(source.source_type, 'hhs_part2');
  assert.match(source.source_url, /breach_report_part2\.jsf$/);
});

test('a Part 2 record never collides with a HIPAA record for the same entity and date', () => {
  const p2 = part2.normalizeRow(ROW, OPTS).record;
  const hipaa = hhs.normalizeRow(ROW, OPTS).record;
  assert.notEqual(p2.id, hipaa.id, 'separate filings under separate rules must be separate records');
  assert.match(p2.id, /^[0-9a-f-]{36}$/);
});

test('Part 2 ids are stable across runs', () => {
  const a = part2.normalizeRow(ROW, OPTS).record;
  const b = part2.normalizeRow({ ...ROW }, { ...OPTS, retrievedAt: 'later', checksum: 'other' }).record;
  assert.equal(a.id, b.id);
});

test('asserts only the medical data class, on the same tautological footing as HIPAA', () => {
  const { record } = part2.normalizeRow(ROW, OPTS);
  assert.deepEqual(JSON.parse(record.data_classes), ['medical']);
});

test('records the regime so a page can show it without altering severity math', () => {
  const { record } = part2.normalizeRow(ROW, OPTS);
  assert.equal(record._regime, '42 CFR Part 2');
  // The severity inputs must be untouched by the regime marker.
  assert.equal(record.records_affected, 4200);
  assert.equal(record.breach_vector, 'hacking');
});

test('fields the portal does not publish stay null here too', () => {
  const { record } = part2.normalizeRow(ROW, OPTS);
  assert.equal(record.discovery_date, null);
  assert.equal(record.remediation_offered, null);
  assert.deepEqual(JSON.parse(record.states_notified), []);
});

test('a differing Part 2 schema fails loudly, naming the headers actually found', () => {
  assert.throws(
    () => part2.parse('Name of Part 2 Program,State\nRiverbend,OR\n'),
    /CSV schema changed.*Name of Covered Entity.*Found.*Name of Part 2 Program/s
  );
});
