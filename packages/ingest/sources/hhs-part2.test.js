const test = require('node:test');
const assert = require('node:assert');
const part2 = require('./hhs-part2');
const hhs = require('./hhs-ocr');
const { breachSlug } = require('../slug');

// The Part 2 export, exactly as the live portal serves it: eight columns, no
// "Covered Entity Type", and two headers arriving as serialized JSF components
// because their column headers are composite facets. Captured 2026-08-07.
const LIVE_HEADER =
  '"javax.faces.component.UIPanel@3c159259","State","Individuals Affected",' +
  '"Breach Submission Date","Type of Breach","Location of Breached Information",' +
  '"javax.faces.component.UIPanel@212d68cf","Web Description"';

const ROW = 'Riverbend Recovery Services,OR,4200,05/14/2026,Hacking/IT Incident,Network Server,No,';

test('the Part 2 export has eight columns, not the HIPAA export nine', () => {
  assert.equal(part2.ALL_COLUMNS.length, 8);
  assert.equal(hhs.ALL_COLUMNS.length, 9);
  // The HIPAA covered-entity taxonomy has no Part 2 equivalent, so the column
  // is absent upstream rather than empty.
  assert.ok(!part2.ALL_COLUMNS.includes('Covered Entity Type'));
  assert.ok(hhs.ALL_COLUMNS.includes('Covered Entity Type'));
});

test('repairs the two serialized headers using the names read off the rendered grid', () => {
  const { headers, rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  assert.deepEqual(headers, part2.ALL_COLUMNS);
  assert.equal(rows[0]['Name of Part 2 Program'], 'Riverbend Recovery Services');
  assert.equal(rows[0]['Qualified Service Organization Present'], 'No');
});

test('never repairs a Part 2 export into HIPAA column names', () => {
  const { headers } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  assert.ok(!headers.includes('Name of Covered Entity'));
  assert.ok(!headers.includes('Business Associate Present'));
});

test('the HIPAA parser rejects a Part 2 export rather than mislabelling it', () => {
  // Guards the reverse mistake: parsing Part 2 rows against the HIPAA layout
  // would record a Part 2 program as a HIPAA covered entity.
  assert.throws(() => hhs.parse(`${LIVE_HEADER}\n${ROW}\n`), /CSV schema changed/);
});

test('a differing Part 2 schema fails loudly, naming the headers actually found', () => {
  assert.throws(
    () => part2.parse('Name of Program,State\nRiverbend,OR\n'),
    /CSV schema changed.*Name of Part 2 Program.*Found.*Name of Program/s
  );
});

test('normalizes a row, attributing it to the Part 2 listing', () => {
  const { rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  const { record, source } = part2.normalizeRow(rows[0], { retrievedAt: 'T', checksum: 'c' });

  assert.equal(record.entity_name, 'Riverbend Recovery Services');
  assert.equal(record.notification_date, '2026-05-14');
  assert.equal(record.records_affected, 4200);
  assert.equal(source.source_type, 'hhs_part2');
  assert.match(source.source_url, /breach_report_part2\.jsf$/);
});

test('records no entity type, because the Part 2 export has no such column', () => {
  const { rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  const { record } = part2.normalizeRow(rows[0], {});
  assert.equal(record._hhs.entity_type, null);
});

test('records the qualified service organization under its own name, not as a business associate', () => {
  const { rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  const { record } = part2.normalizeRow(rows[0], {});
  assert.equal(record._hhs.associate_present_column, 'Qualified Service Organization Present');
  assert.equal(record._hhs.associate_present, 'No');
});

test('raw_payload preserves the portal own column names, never invented ones', () => {
  const { rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  const { source } = part2.normalizeRow(rows[0], {});
  const payload = JSON.parse(source.raw_payload);
  assert.ok('Name of Part 2 Program' in payload);
  assert.ok(!('Name of Covered Entity' in payload));
});

test('data_classes stays medical; no new weighted class is minted', () => {
  const { rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  const { record } = part2.normalizeRow(rows[0], {});
  assert.deepEqual(JSON.parse(record.data_classes), ['medical']);
});

// --- Separation from HIPAA filings ----------------------------------------
// One organization can file under both rules. Those are two filings, and they
// must stay two records at two permanent URLs.

const HIPAA_HEADER = hhs.ALL_COLUMNS.join(',');
const HIPAA_ROW = 'Riverbend Recovery Services,OR,Healthcare Provider,4200,05/14/2026,Hacking/IT Incident,Network Server,No,';

function bothFilings() {
  const p2 = part2.normalizeRow(part2.parse(`${LIVE_HEADER}\n${ROW}\n`).rows[0], {});
  const hp = hhs.normalizeRow(hhs.parse(`${HIPAA_HEADER}\n${HIPAA_ROW}\n`).rows[0], {});
  return { p2: p2.record, hipaa: hp.record };
}

test('the same organization and date under two rules gets two distinct ids', () => {
  const { p2, hipaa } = bothFilings();
  assert.notEqual(p2.id, hipaa.id);
});

test('and two distinct permanent URLs', () => {
  // A numeric disambiguator would not do: the two filings are ingested by
  // separate processes, so which one won the bare slug would depend on which
  // source happened to run first.
  const { p2, hipaa } = bothFilings();
  const a = breachSlug(p2.entity_name, p2.notification_date, p2.slug_namespace);
  const b = breachSlug(hipaa.entity_name, hipaa.notification_date, hipaa.slug_namespace);
  assert.notEqual(a, b);
  assert.equal(b, 'riverbend-recovery-services-2026-05');
  assert.equal(a, 'riverbend-recovery-services-part2-2026-05');
});

test('the regime is carried on the source row, which is what reaches the database', () => {
  // Not on the record: d1-writer builds from an explicit column list, so a
  // field invented on the record object would be dropped silently and any
  // page that claimed to show it would show nothing.
  const { rows } = part2.parse(`${LIVE_HEADER}\n${ROW}\n`);
  const { record, source } = part2.normalizeRow(rows[0], {});
  assert.equal(source.source_type, 'hhs_part2');
  assert.equal(record._regime, undefined);
});
