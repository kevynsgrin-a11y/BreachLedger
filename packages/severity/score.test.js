const test = require('node:test');
const assert = require('node:assert');
const { score } = require('./score');

test('full-stack breach: subtotal caps at 70, modifiers add, total caps at 100', () => {
  const r = score({
    data_classes: ['ssn', 'biometric', 'medical', 'financial_account'], // 30+30+22+25 = 107 -> cap 70
    records_affected: 25_000_000, // 15
    remediation_offered: { type: 'none' }, // 10, affirmatively none offered
    discovery_date: '2025-01-01',
    notification_date: '2025-06-01', // 151 days -> 5
  });
  assert.equal(r.breakdown.data_class_subtotal.raw, 107);
  assert.equal(r.breakdown.data_class_subtotal.capped, 70);
  assert.equal(r.breakdown.scale_modifier.points, 15);
  assert.equal(r.breakdown.remediation_gap_modifier.points, 10);
  assert.equal(r.breakdown.notification_lag_modifier.points, 5);
  assert.equal(r.score, 100);
  assert.equal(r.rubric_version, '1.1');
});

test('minor breach: name+email, small, prompt notice, 24mo monitoring', () => {
  const r = score({
    data_classes: ['name', 'email'], // 5
    records_affected: 800, // 0
    remediation_offered: { type: 'credit_monitoring', months: 24 }, // 0
    discovery_date: '2025-03-01',
    notification_date: '2025-03-20', // 19 days -> 0
  });
  assert.equal(r.score, 5);
});

test('scale bands are lower-inclusive, upper-exclusive', () => {
  const at = (n) => score({ data_classes: [], records_affected: n, remediation_offered: { type: 'credit_monitoring', months: 24 } }).breakdown.scale_modifier.points;
  assert.equal(at(999), 0);
  assert.equal(at(1000), 3);
  assert.equal(at(9999), 3);
  assert.equal(at(10000), 6);
  assert.equal(at(100000), 9);
  assert.equal(at(1000000), 12);
  assert.equal(at(10000000), 15);
});

test('lag bands match rubric: <=30 -> 0, 31-60 -> 2, 61-90 -> 3, >90 -> 5', () => {
  const lag = (d, n) => score({ data_classes: [], remediation_offered: { type: 'x', months: 24 }, discovery_date: d, notification_date: n }).breakdown.notification_lag_modifier.points;
  assert.equal(lag('2025-01-01', '2025-01-31'), 0); // 30 days
  assert.equal(lag('2025-01-01', '2025-02-01'), 2); // 31 days
  assert.equal(lag('2025-01-01', '2025-03-02'), 2); // 60 days
  assert.equal(lag('2025-01-01', '2025-03-03'), 3); // 61 days
  assert.equal(lag('2025-01-01', '2025-04-01'), 3); // 90 days
  assert.equal(lag('2025-01-01', '2025-04-02'), 5); // 91 days
});

test('unknown data scores 0 for scale and lag, and is flagged', () => {
  const r = score({ data_classes: ['ssn'], records_affected: null, remediation_offered: { type: 'x', months: 24 } });
  assert.equal(r.breakdown.scale_modifier.points, 0);
  assert.equal(r.breakdown.scale_modifier.unknown, true);
  assert.equal(r.breakdown.notification_lag_modifier.points, 0);
  assert.equal(r.breakdown.notification_lag_modifier.unknown, true);
  assert.equal(r.score, 30);
});

test('calendar-invalid dates are flagged unknown, not silently rolled over', () => {
  const r = score({ data_classes: [], remediation_offered: { type: 'x', months: 24 }, discovery_date: '2025-02-30', notification_date: '2025-03-15' });
  assert.equal(r.breakdown.notification_lag_modifier.unknown, true);
  assert.equal(r.breakdown.notification_lag_modifier.days, null);
});

test('disclosed-but-invalid records are flagged invalid, not "not disclosed"', () => {
  const bad = score({ data_classes: [], records_affected: -5, remediation_offered: { type: 'x', months: 24 } });
  assert.equal(bad.breakdown.scale_modifier.band, 'invalid value');
  assert.equal(bad.breakdown.scale_modifier.points, 0);
  const str = score({ data_classes: [], records_affected: '5000', remediation_offered: { type: 'x', months: 24 } });
  assert.equal(str.breakdown.scale_modifier.band, 'invalid value');
  const missing = score({ data_classes: [], records_affected: null, remediation_offered: { type: 'x', months: 24 } });
  assert.equal(missing.breakdown.scale_modifier.band, 'not disclosed');
});

test('negative monitoring months treated as unknown duration (5 points)', () => {
  const r = score({ data_classes: [], remediation_offered: { type: 'credit_monitoring', months: -3 } });
  assert.equal(r.breakdown.remediation_gap_modifier.points, 5);
  assert.equal(r.breakdown.remediation_gap_modifier.unknown, true);
});

test('remediation gap: unknown duration scores 5, 12-23 months scores 2', () => {
  const gap = (rem) => score({ data_classes: [], remediation_offered: rem }).breakdown.remediation_gap_modifier.points;
  assert.equal(gap(null), 0); // v1.1: source silent -> not assessable
  assert.equal(gap({ type: 'none' }), 10);
  assert.equal(gap({ type: 'credit_monitoring' }), 5);
  assert.equal(gap({ type: 'credit_monitoring', months: 11 }), 5);
  assert.equal(gap({ type: 'credit_monitoring', months: 12 }), 2);
  assert.equal(gap({ type: 'credit_monitoring', months: 23 }), 2);
  assert.equal(gap({ type: 'credit_monitoring', months: 24 }), 0);
});

test('v1.1: unreported remediation is not scored as none offered', () => {
  const silent = score({ data_classes: ['medical'], remediation_offered: null });
  assert.equal(silent.breakdown.remediation_gap_modifier.points, 0);
  assert.equal(silent.breakdown.remediation_gap_modifier.band, 'not reported by this source');
  assert.equal(silent.breakdown.remediation_gap_modifier.unknown, true);

  const none = score({ data_classes: ['medical'], remediation_offered: { type: 'none' } });
  assert.equal(none.breakdown.remediation_gap_modifier.points, 10);
  assert.equal(none.breakdown.remediation_gap_modifier.band, 'source reports none offered');

  // The difference is exactly the 10 points that HHS-only records used to carry.
  assert.equal(none.score - silent.score, 10);
});
