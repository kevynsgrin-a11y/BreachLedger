// HHS Office for Civil Rights — 42 CFR Part 2 breach report.
//
// Added to the OCR portal in February 2026, alongside the long-standing HIPAA
// report. Part 2 governs records of substance use disorder treatment held by
// federally assisted "Part 2 programs". It is a separate legal regime from
// HIPAA with its own breach reporting, and OCR publishes it as a separate
// listing at its own address.
//
// Structurally the grid is the same application as the HIPAA one — same
// PrimeFaces datatable, same four exporters, same under-investigation/archive
// TabView — so retrieval reuses the HIPAA machinery wholesale and only the
// address and the source attribution differ.
//
// WHAT WE ASSERT ABOUT THE DATA, AND WHY
//
// data_classes is ['medical'] and nothing more, on the same tautological
// footing as the HIPAA source: the Part 2 breach reporting duty is triggered by
// breaches of Part 2 records, and Part 2 records ARE substance use disorder
// treatment records — health information by definition. So 'medical' follows
// from the rule that put the record on the portal, rather than being inferred
// from any field.
//
// We deliberately do NOT mint a distinct "substance use disorder" data class.
// The severity rubric is published and versioned, and inventing a new weighted
// class here would silently change scores across the corpus. The regime is
// instead recorded as provenance and surfaced as context on the page, so a
// reader can see that a record comes from the Part 2 listing without the
// severity math being quietly altered underneath them.

const hhs = require('./hhs-ocr');
const { PART2_GRID_PAGE } = require('./hhs-ocr-fetch');

const SOURCE_TYPE = 'hhs_part2';
const PORTAL_URL = PART2_GRID_PAGE;

/**
 * Normalize one Part 2 row.
 *
 * Delegates to the HIPAA normalizer, which handles the shared schema, then
 * re-attributes the source and records the regime. If the Part 2 export turns
 * out to use different column names, the shared parser throws naming both the
 * expected and the found headers — a loud failure that tells us the real
 * schema, rather than a quiet one that yields a table of nulls.
 */
function normalizeRow(row, opts = {}) {
  const { record, source } = hhs.normalizeRow(row, { ...opts, sourceUrl: PORTAL_URL });

  source.source_type = SOURCE_TYPE;
  source.source_url = PORTAL_URL;

  // Distinguish this record's id from a HIPAA record for the same entity and
  // date. They are separate filings under separate rules and must not collide.
  record.id = hhs.stableId(`part2:${record.entity_name_normalized}`, record.notification_date);
  record._regime = '42 CFR Part 2';

  return { record, source };
}

module.exports = {
  SOURCE_TYPE,
  PORTAL_URL,
  phase: 1,
  normalizeRow,
  parse: hhs.parse,
  REQUIRED_COLUMNS: hhs.REQUIRED_COLUMNS,
  ALL_COLUMNS: hhs.ALL_COLUMNS,
};
