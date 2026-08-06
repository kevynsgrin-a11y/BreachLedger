const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, parseRows } = require('./csv');

test('parses quoted fields containing commas', () => {
  const { rows } = parseCsv('Name,State\n"Smith, Jones and Associates, P.C.",TX\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Name, 'Smith, Jones and Associates, P.C.');
  assert.equal(rows[0].State, 'TX');
});

test('handles escaped quotes and embedded newlines', () => {
  const { rows } = parseCsv('Name,Note\n"The ""Big"" Clinic","line one\nline two"\n');
  assert.equal(rows[0].Name, 'The "Big" Clinic');
  assert.equal(rows[0].Note, 'line one\nline two');
});

test('handles CRLF line endings and a UTF-8 BOM', () => {
  const { rows, headers } = parseCsv('﻿Name,State\r\nAcme,CA\r\n');
  assert.deepEqual(headers, ['Name', 'State']);
  assert.equal(rows[0].Name, 'Acme');
});

test('parses final row when file lacks a trailing newline', () => {
  const { rows } = parseCsv('Name,State\nAcme,CA');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].State, 'CA');
});

test('missing required column throws with both expected and found headers', () => {
  assert.throws(
    () => parseCsv('Entity,State\nAcme,CA\n', { required: ['Name of Covered Entity'] }),
    /CSV schema changed.*Name of Covered Entity.*Found.*Entity/s
  );
});

test('unterminated quote throws rather than silently truncating', () => {
  assert.throws(() => parseCsv('Name\n"never closed\n'), /unterminated quoted field/);
});

test('row with wrong field count throws', () => {
  assert.throws(() => parseCsv('A,B,C\n1,2\n'), /expected 3 fields, got 2/);
});

test('blank trailing lines are ignored', () => {
  const { rows } = parseCsv('A,B\n1,2\n\n\n');
  assert.equal(rows.length, 1);
});

test('empty quoted field is preserved as empty string', () => {
  const rows = parseRows('a,"",c');
  assert.deepEqual(rows, [['a', '', 'c']]);
});
