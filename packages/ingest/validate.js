// Validation stage (spec section 4): reject any record missing entity_name,
// notification_date, or >=1 source. Rejects are logged for manual review,
// never silently dropped.

const fs = require('fs');
const path = require('path');

const rubric = require('../severity/rubric.json');
const { parseIsoDate } = require('../severity/score');
const KNOWN_DATA_CLASSES = new Set(Object.keys(rubric.data_class_subtotal.weights));
const REJECT_LOG = path.join(__dirname, '..', '..', 'docs', 'ingest-rejects.log');

/**
 * Validate a normalized breach record (with its source rows attached as
 * record.sources). Returns { ok: true } or { ok: false, reasons: string[] }.
 */
function validate(record) {
  const reasons = [];
  if (!record.entity_name || !String(record.entity_name).trim()) {
    reasons.push('missing entity_name');
  }
  if (!record.notification_date) {
    reasons.push('missing notification_date');
  }
  // Dates must be well-formed, calendar-valid ISO dates — Date.parse would
  // silently roll 2025-02-30 into March, scoring a lag no source reported.
  for (const field of ['notification_date', 'discovery_date', 'breach_start_date', 'breach_end_date']) {
    if (record[field] != null && Number.isNaN(parseIsoDate(record[field]))) {
      reasons.push(`invalid ${field} '${record[field]}'`);
    }
  }
  if (record.records_affected != null) {
    const n = record.records_affected;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      reasons.push(`records_affected must be a non-negative integer or null, got '${n}'`);
    }
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    reasons.push('zero source rows');
  }
  if (!Array.isArray(record.data_classes)) {
    reasons.push('data_classes is not an array');
  } else {
    for (const code of record.data_classes) {
      if (!KNOWN_DATA_CLASSES.has(code)) reasons.push(`unknown data class '${code}'`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/** Append a rejected record to the manual-review log. Never silent. */
function logReject(record, reasons, now = new Date().toISOString()) {
  const line = JSON.stringify({ at: now, reasons, entity_name: record.entity_name || null, record });
  fs.appendFileSync(REJECT_LOG, line + '\n');
}

module.exports = { validate, logReject, KNOWN_DATA_CLASSES };
