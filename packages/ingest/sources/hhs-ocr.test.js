const test = require('node:test');
const assert = require('node:assert');
const hhs = require('./hhs-ocr');

const ROW = {
  'Name of Covered Entity': 'Contoso Health Network, Inc.',
  State: 'TX',
  'Covered Entity Type': 'Healthcare Provider',
  'Individuals Affected': '250000',
  'Breach Submission Date': '03/14/2025',
  'Type of Breach': 'Hacking/IT Incident',
  'Location of Breached Information': 'Network Server',
  'Business Associate Present': 'No',
};

const OPTS = { retrievedAt: '2026-08-06T00:00:00.000Z', checksum: 'abc' };

test('converts MM/DD/YYYY to ISO and rejects impossible dates', () => {
  assert.equal(hhs.toIsoDate('03/14/2025'), '2025-03-14');
  assert.equal(hhs.toIsoDate('3/4/2025'), '2025-03-04');
  assert.equal(hhs.toIsoDate('02/30/2025'), null); // calendar-invalid
  assert.equal(hhs.toIsoDate(''), null);
  assert.equal(hhs.toIsoDate(null), null);
});

test('parses individuals affected, tolerating thousands separators', () => {
  assert.equal(hhs.parseCount('250000'), 250000);
  assert.equal(hhs.parseCount('1,234'), 1234);
  assert.equal(hhs.parseCount(''), null);
  assert.equal(hhs.parseCount('unknown'), null);
  assert.equal(hhs.parseCount('-5'), null);
});

test('maps the breach-type vocabulary onto the canonical enum', () => {
  assert.equal(hhs.mapVector('Hacking/IT Incident'), 'hacking');
  assert.equal(hhs.mapVector('Theft'), 'loss');
  assert.equal(hhs.mapVector('Loss'), 'loss');
  assert.equal(hhs.mapVector('Improper Disposal'), 'improper_disposal');
  assert.equal(hhs.mapVector('Unauthorized Access/Disclosure'), 'insider');
  assert.equal(hhs.mapVector('Other'), 'unknown');
  assert.equal(hhs.mapVector(''), 'unknown');
});

test('compound breach types resolve by precedence, not by order', () => {
  assert.equal(hhs.mapVector('Theft, Hacking/IT Incident'), 'hacking');
  assert.equal(hhs.mapVector('Hacking/IT Incident, Theft'), 'hacking');
  assert.equal(hhs.mapVector('Loss, Improper Disposal'), 'improper_disposal');
});

test('unrecognized vocabulary is surfaced rather than silently called unknown', () => {
  const unknown = new Set();
  assert.equal(hhs.mapVector('Quantum Exfiltration', unknown), 'unknown');
  assert.deepEqual([...unknown], ['Quantum Exfiltration']);
});

test('ids are stable across runs and distinct across records', () => {
  const a = hhs.normalizeRow(ROW, OPTS).record;
  const b = hhs.normalizeRow({ ...ROW }, { ...OPTS, retrievedAt: 'later', checksum: 'different' }).record;
  assert.equal(a.id, b.id, 'id must not depend on when it was fetched');
  const other = hhs.normalizeRow({ ...ROW, 'Breach Submission Date': '04/14/2025' }, OPTS).record;
  assert.notEqual(a.id, other.id);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
});

test('entity name variants converge to one id via normalization', () => {
  const a = hhs.normalizeRow(ROW, OPTS).record;
  const b = hhs.normalizeRow({ ...ROW, 'Name of Covered Entity': 'CONTOSO HEALTH NETWORK INC' }, OPTS).record;
  assert.equal(a.id, b.id);
});

test('data classes assert only what HIPAA makes tautological', () => {
  const { record } = hhs.normalizeRow(ROW, OPTS);
  assert.deepEqual(JSON.parse(record.data_classes), ['medical']);
});

test('fields HHS does not report are left null, never guessed', () => {
  const { record } = hhs.normalizeRow(ROW, OPTS);
  assert.equal(record.discovery_date, null);
  assert.equal(record.breach_start_date, null);
  assert.equal(record.breach_end_date, null);
  assert.equal(record.remediation_offered, null);
  // The entity's own state is NOT the set of states notified.
  assert.deepEqual(JSON.parse(record.states_notified), []);
  assert.equal(record._hhs.state, 'TX');
});

test('source row carries provenance for reprocessing', () => {
  const { source } = hhs.normalizeRow(ROW, OPTS);
  assert.equal(source.source_type, 'hhs_ocr');
  assert.match(source.source_url, /^https:\/\/ocrportal\.hhs\.gov\//);
  assert.equal(source.retrieved_at, OPTS.retrievedAt);
  assert.equal(source.checksum, 'abc');
  assert.equal(JSON.parse(source.raw_payload)['Name of Covered Entity'], ROW['Name of Covered Entity']);
});

test('blank individuals-affected yields null rather than zero', () => {
  const { record } = hhs.normalizeRow({ ...ROW, 'Individuals Affected': '' }, OPTS);
  assert.equal(record.records_affected, null);
});

test('parse() rejects a CSV whose required columns were renamed', () => {
  assert.throws(
    () => hhs.parse('Entity,State\nAcme,CA\n'),
    /CSV schema changed.*Name of Covered Entity/s
  );
});

test('parse() accepts a well-formed export including quoted commas', () => {
  const csv =
    'Name of Covered Entity,State,Covered Entity Type,Individuals Affected,Breach Submission Date,Type of Breach,Location of Breached Information\n' +
    '"Smith, Jones and Associates, P.C.",TX,Healthcare Provider,1200,03/14/2025,Theft,Paper/Films\n';
  const { rows } = hhs.parse(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Name of Covered Entity'], 'Smith, Jones and Associates, P.C.');
  const { record } = hhs.normalizeRow(rows[0], OPTS);
  assert.equal(record.entity_name_normalized, 'smith jones and associates');
  assert.equal(record.breach_vector, 'loss');
});

test('captures the multi-value location list without substring confusion', () => {
  const { record } = hhs.normalizeRow(
    { ...ROW, 'Location of Breached Information': 'Other, Other Portable Electronic Device' },
    OPTS
  );
  assert.deepEqual(record._hhs.locations, ['Other', 'Other Portable Electronic Device']);
  for (const loc of record._hhs.locations) assert.ok(hhs.LOCATIONS.has(loc), `unknown location ${loc}`);
});

test('captures the OCR web description when the archive supplies one', () => {
  const narrative = 'A hacker gained access to the network server containing protected health information.';
  const { record } = hhs.normalizeRow({ ...ROW, 'Web Description': narrative }, OPTS);
  assert.equal(record._hhs.web_description, narrative);
  const blank = hhs.normalizeRow(ROW, OPTS).record;
  assert.equal(blank._hhs.web_description, null);
});

test('all eight documented location atoms are recognized', () => {
  const atoms = ['Network Server','Email','Paper/Films','Laptop','Other','Desktop Computer','Electronic Medical Record','Other Portable Electronic Device'];
  assert.equal(hhs.LOCATIONS.size, 8);
  for (const a of atoms) assert.ok(hhs.LOCATIONS.has(a), a);
});

test('archive rows with blank vocabulary fields degrade to unknown, not to a crash', () => {
  const { record } = hhs.normalizeRow(
    { ...ROW, 'Type of Breach': '', 'Location of Breached Information': '', 'Covered Entity Type': '', 'Individuals Affected': '' },
    OPTS
  );
  assert.equal(record.breach_vector, 'unknown');
  assert.equal(record.records_affected, null);
  assert.deepEqual(record._hhs.locations, []);
});
