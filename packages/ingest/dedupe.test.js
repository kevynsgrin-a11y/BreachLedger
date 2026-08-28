const test = require('node:test');
const assert = require('node:assert/strict');

const { dedupe, MATCH_WINDOW_DAYS } = require('./dedupe');

function rec(overrides = {}) {
  return {
    entity_name: 'Acme Health',
    entity_name_normalized: 'acme health',
    notification_date: '2026-01-01',
    records_affected: 100,
    records_affected_is_est: 0,
    states_notified: ['ME'],
    data_classes: ['medical'],
    sources: [{ source_type: 'hhs_ocr' }],
    ...overrides,
  };
}

test('window constant matches the documented match rule', () => {
  assert.equal(MATCH_WINDOW_DAYS, 45);
});

test('merges two filings of the same breach inside the 45-day window', () => {
  const out = dedupe([
    rec(),
    rec({ notification_date: '2026-02-05', sources: [{ source_type: 'maine_ag' }] }), // +35d
  ]);
  assert.equal(out.length, 1);
});

test('keeps two filings outside the window separate', () => {
  const out = dedupe([rec(), rec({ notification_date: '2026-03-15' })]); // +73d
  assert.equal(out.length, 2);
});

test('a boundary filing exactly 45 days out still merges', () => {
  const out = dedupe([rec(), rec({ notification_date: '2026-02-15' })]); // +45d exactly
  assert.equal(out.length, 1);
});

test('46 days out does not merge', () => {
  const out = dedupe([rec(), rec({ notification_date: '2026-02-16' })]);
  assert.equal(out.length, 2);
});

test('different entities on the same date never merge', () => {
  const out = dedupe([rec(), rec({ entity_name_normalized: 'globex health' })]);
  assert.equal(out.length, 2);
});

test('unions states_notified and data_classes', () => {
  const [merged] = dedupe([
    rec({ states_notified: ['ME'], data_classes: ['medical'] }),
    rec({
      notification_date: '2026-01-20',
      states_notified: ['CA', 'ME'],
      data_classes: ['ssn'],
    }),
  ]);
  assert.deepEqual(merged.states_notified.sort(), ['CA', 'ME']);
  assert.deepEqual(merged.data_classes.sort(), ['medical', 'ssn']);
});

test('takes MAX of records_affected and carries its estimate flag', () => {
  const [merged] = dedupe([
    rec({ records_affected: 100, records_affected_is_est: 0 }),
    rec({ notification_date: '2026-01-20', records_affected: 250, records_affected_is_est: 1 }),
  ]);
  assert.equal(merged.records_affected, 250);
  assert.equal(merged.records_affected_is_est, 1);
});

test('a null records_affected never beats a real count', () => {
  const [merged] = dedupe([
    rec({ records_affected: null }),
    rec({ notification_date: '2026-01-20', records_affected: 77 }),
  ]);
  assert.equal(merged.records_affected, 77);
});

test('appends every source row and never drops one', () => {
  const [merged] = dedupe([
    rec({ sources: [{ source_type: 'hhs_ocr' }] }),
    rec({ notification_date: '2026-01-10', sources: [{ source_type: 'maine_ag' }] }),
    rec({ notification_date: '2026-01-15', sources: [{ source_type: 'ca_ag' }] }),
  ]);
  assert.equal(merged.sources.length, 3);
  assert.deepEqual(
    merged.sources.map((s) => s.source_type).sort(),
    ['ca_ag', 'hhs_ocr', 'maine_ag']
  );
});

test('fills a field the canonical record lacks but never overwrites one it has', () => {
  const [merged] = dedupe([
    rec({ discovery_date: null, breach_vector: 'hacking' }),
    rec({ notification_date: '2026-01-20', discovery_date: '2025-12-01', breach_vector: 'insider' }),
  ]);
  assert.equal(merged.discovery_date, '2025-12-01', 'missing field filled from the second source');
  assert.equal(merged.breach_vector, 'hacking', 'existing field must not be overwritten');
});

test('keeps the earliest notification_date as the record date', () => {
  const [merged] = dedupe([rec({ notification_date: '2026-02-01' }), rec({ notification_date: '2026-01-05' })]);
  assert.equal(merged.notification_date, '2026-01-05');
});

// Decision 1: the window is anchored, not chained.
test('does not chain-merge across an unbounded span', () => {
  const out = dedupe([
    rec({ notification_date: '2026-01-01' }),
    rec({ notification_date: '2026-02-05' }), // +35d from anchor -> merges
    rec({ notification_date: '2026-03-12' }), // +70d from anchor -> must NOT merge
  ]);
  assert.equal(out.length, 2, 'a chained window would have collapsed all three');
  assert.equal(out[0].notification_date, '2026-01-01');
  assert.equal(out[1].notification_date, '2026-03-12');
});

// Decision 2: a missing date never matches.
test('records with no notification_date never merge on name alone', () => {
  const out = dedupe([rec({ notification_date: null }), rec({ notification_date: null })]);
  assert.equal(out.length, 2);
});

test('a calendar-invalid date never matches', () => {
  const out = dedupe([rec(), rec({ notification_date: '2026-02-30' })]);
  assert.equal(out.length, 2);
});

test('does not mutate the input records', () => {
  const a = rec();
  const b = rec({ notification_date: '2026-01-20', states_notified: ['CA'], records_affected: 900 });
  const aBefore = JSON.stringify(a);
  const bBefore = JSON.stringify(b);
  dedupe([a, b]);
  assert.equal(JSON.stringify(a), aBefore);
  assert.equal(JSON.stringify(b), bBefore);
});

test('parses JSON-encoded array columns as they arrive from D1', () => {
  const [merged] = dedupe([
    rec({ states_notified: '["ME"]', data_classes: '["medical"]' }),
    rec({ notification_date: '2026-01-20', states_notified: '["CA"]', data_classes: '["ssn"]' }),
  ]);
  assert.deepEqual(merged.states_notified.sort(), ['CA', 'ME']);
  assert.deepEqual(merged.data_classes.sort(), ['medical', 'ssn']);
});

test('is order-independent in the number of records it yields', () => {
  const input = [
    rec({ notification_date: '2026-01-01', records_affected: 10 }),
    rec({ notification_date: '2026-01-20', records_affected: 20 }),
    rec({ entity_name_normalized: 'globex health', notification_date: '2026-01-01' }),
  ];
  const forward = dedupe(input);
  const reverse = dedupe([...input].reverse());
  assert.equal(forward.length, reverse.length);
  assert.equal(forward.length, 2);
});

test('an empty input yields an empty result', () => {
  assert.deepEqual(dedupe([]), []);
});

test('rejects a non-array input rather than silently returning nothing', () => {
  assert.throws(() => dedupe(null), TypeError);
});
