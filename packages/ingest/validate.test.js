// validate.js decides whether a government record gets published. Every
// sibling stage in the ingest pipeline is tested; this one was not.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, KNOWN_DATA_CLASSES } = require('./validate');

function rec(overrides = {}) {
  return {
    entity_name: 'Acme Health',
    notification_date: '2026-01-15',
    records_affected: 1200,
    data_classes: ['medical'],
    sources: [{ source_type: 'hhs_ocr', source_url: 'https://ocrportal.hhs.gov/' }],
    ...overrides,
  };
}

test('a well-formed record passes', () => {
  assert.deepEqual(validate(rec()), { ok: true });
});

// The rule the README calls procedurally enforced: SQLite cannot express it.
test('rejects a record with zero sources', () => {
  const r = validate(rec({ sources: [] }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('zero source rows'));
});

test('rejects a record whose sources field is missing or not an array', () => {
  assert.equal(validate(rec({ sources: undefined })).ok, false);
  assert.equal(validate(rec({ sources: 'hhs' })).ok, false);
});

test('rejects a missing or blank entity_name', () => {
  assert.ok(validate(rec({ entity_name: '' })).reasons.includes('missing entity_name'));
  assert.ok(validate(rec({ entity_name: '   ' })).reasons.includes('missing entity_name'));
  assert.ok(validate(rec({ entity_name: null })).reasons.includes('missing entity_name'));
});

test('rejects a missing notification_date', () => {
  assert.ok(validate(rec({ notification_date: null })).reasons.includes('missing notification_date'));
});

// A calendar-invalid date must not roll over: Date.parse would turn
// 2025-02-30 into March 2, scoring a notification lag no source reported.
test('rejects a calendar-invalid date rather than rolling it over', () => {
  const r = validate(rec({ notification_date: '2025-02-30' }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("invalid notification_date '2025-02-30'")));
});

test('rejects a malformed date string', () => {
  assert.equal(validate(rec({ notification_date: 'March 2025' })).ok, false);
});

test('validates every optional date field, not just notification_date', () => {
  for (const field of ['discovery_date', 'breach_start_date', 'breach_end_date']) {
    const r = validate(rec({ [field]: '2025-13-01' }));
    assert.equal(r.ok, false, `${field} should be validated`);
    assert.ok(r.reasons.some((x) => x.includes(`invalid ${field}`)));
  }
});

test('a null optional date is allowed — absent is not invalid', () => {
  assert.deepEqual(
    validate(rec({ discovery_date: null, breach_start_date: null, breach_end_date: null })),
    { ok: true }
  );
});

test('accepts a leap day in a leap year and rejects one outside it', () => {
  assert.equal(validate(rec({ notification_date: '2024-02-29' })).ok, true);
  assert.equal(validate(rec({ notification_date: '2025-02-29' })).ok, false);
});

test('rejects a non-integer, negative, or string records_affected', () => {
  for (const bad of [-1, 1.5, '1200', NaN]) {
    const r = validate(rec({ records_affected: bad }));
    assert.equal(r.ok, false, `records_affected ${String(bad)} should be rejected`);
    assert.ok(r.reasons.some((x) => x.includes('records_affected')));
  }
});

test('a null records_affected is allowed — HHS does not always disclose one', () => {
  assert.deepEqual(validate(rec({ records_affected: null })), { ok: true });
});

test('zero records_affected is allowed', () => {
  assert.deepEqual(validate(rec({ records_affected: 0 })), { ok: true });
});

test('rejects a data class the rubric does not weight', () => {
  const r = validate(rec({ data_classes: ['medical', 'astrological_sign'] }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("unknown data class 'astrological_sign'")));
});

test('rejects data_classes that is not an array', () => {
  assert.ok(validate(rec({ data_classes: 'medical' })).reasons.includes('data_classes is not an array'));
});

test('an empty data_classes array is allowed — a source may not enumerate them', () => {
  assert.deepEqual(validate(rec({ data_classes: [] })), { ok: true });
});

test('every seeded data class is accepted by the validator', () => {
  for (const code of KNOWN_DATA_CLASSES) {
    assert.equal(validate(rec({ data_classes: [code] })).ok, true, `${code} should be known`);
  }
});

test('reports every reason at once, so one ingest run surfaces them all', () => {
  const r = validate({ entity_name: '', notification_date: null, sources: [], data_classes: 'no' });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.length >= 4, `expected several reasons, got ${JSON.stringify(r.reasons)}`);
});
