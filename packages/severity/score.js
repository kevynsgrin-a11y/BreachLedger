// Severity scoring engine. Pure function of a breach row + rubric.json.
// Always returns the component breakdown alongside the score — the rendering
// rule requires the math to be shown, never a bare number.

const rubric = require('./rubric.json');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Strict ISO date parse: accepts YYYY-MM-DD (optionally with a time suffix)
 * and rejects calendar-invalid dates (2025-02-30 must not silently roll over
 * to March 2 — a lag computed from a date that appeared in no source would be
 * presented as known). Returns epoch ms or NaN.
 */
function parseIsoDate(value) {
  if (typeof value !== 'string') return NaN;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const rt = new Date(t);
  if (rt.getUTCFullYear() !== y || rt.getUTCMonth() !== mo - 1 || rt.getUTCDate() !== d) return NaN;
  return t;
}

function dataClassSubtotal(dataClasses) {
  const weights = rubric.data_class_subtotal.weights;
  const parts = [];
  let sum = 0;
  for (const code of dataClasses || []) {
    const w = weights[code];
    if (w === undefined) continue; // unknown codes are a validation error upstream
    parts.push({ code, weight: w });
    sum += w;
  }
  return { raw: sum, capped: Math.min(sum, rubric.data_class_subtotal.cap), parts };
}

function scaleModifier(recordsAffected) {
  if (recordsAffected == null) {
    return { points: rubric.scale_modifier.unknown_records_points, band: 'not disclosed', unknown: true };
  }
  // Disclosed-but-invalid (negative, non-numeric) is distinct from undisclosed:
  // the breakdown must not claim "undisclosed" for data that is present but bad.
  if (typeof recordsAffected !== 'number' || !Number.isFinite(recordsAffected) || recordsAffected < 0) {
    return { points: 0, band: 'invalid value', unknown: true };
  }
  for (const band of rubric.scale_modifier.bands) {
    if (recordsAffected >= band.min && (band.max === null || recordsAffected < band.max)) {
      return { points: band.points, band: band.label, unknown: false };
    }
  }
  return { points: 0, band: 'invalid value', unknown: true };
}

function remediationGapModifier(remediationOffered) {
  // remediationOffered: parsed JSON {type, provider, months, enrollment_deadline} or null
  if (!remediationOffered || !remediationOffered.type || remediationOffered.type === 'none') {
    return { points: 10, band: 'no monitoring offered' };
  }
  const months = remediationOffered.months;
  if (months == null || typeof months !== 'number' || !Number.isFinite(months) || months < 0) {
    // Monitoring offered but duration unknown or invalid: treat as the
    // under-12-months band rather than rewarding missing data with 0.
    return { points: 5, band: 'monitoring offered, duration unknown', unknown: true };
  }
  if (months < 12) return { points: 5, band: 'under 12 months' };
  if (months < 24) return { points: 2, band: '12 to 23 months' };
  return { points: 0, band: '24 months or more' };
}

function notificationLagModifier(discoveryDate, notificationDate) {
  const unknown = { points: rubric.notification_lag_modifier.unknown_dates_points, days: null, unknown: true };
  if (!discoveryDate || !notificationDate) return unknown;
  const d = parseIsoDate(discoveryDate);
  const n = parseIsoDate(notificationDate);
  if (Number.isNaN(d) || Number.isNaN(n) || n < d) return unknown;
  const days = Math.round((n - d) / DAY_MS);
  // Band thresholds come from rubric.json so the published rubric and the
  // computed scores cannot silently desynchronize.
  for (const band of rubric.notification_lag_modifier.bands) {
    if (days >= band.min_days && (band.max_days === null || days <= band.max_days)) {
      return { points: band.points, days, unknown: false };
    }
  }
  return unknown;
}

/**
 * Score a breach. Input mirrors the breaches table row with JSON fields parsed:
 * { data_classes: string[], records_affected: number|null,
 *   remediation_offered: object|null, discovery_date, notification_date }
 * Returns { score, rubric_version, breakdown }.
 */
function score(breach) {
  const subtotal = dataClassSubtotal(breach.data_classes);
  const scale = scaleModifier(breach.records_affected);
  const gap = remediationGapModifier(breach.remediation_offered);
  const lag = notificationLagModifier(breach.discovery_date, breach.notification_date);

  const total = Math.min(100, subtotal.capped + scale.points + gap.points + lag.points);
  return {
    score: total,
    rubric_version: rubric.version,
    breakdown: {
      data_class_subtotal: subtotal,
      scale_modifier: scale,
      remediation_gap_modifier: gap,
      notification_lag_modifier: lag,
    },
  };
}

module.exports = { score, dataClassSubtotal, scaleModifier, remediationGapModifier, notificationLagModifier, parseIsoDate };
