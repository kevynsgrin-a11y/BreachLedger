// HHS Office for Civil Rights — 42 CFR Part 2 breach report.
//
// A second breach listing, separate from the long-standing HIPAA one. Part 2
// governs records of substance use disorder treatment held by federally
// assisted "Part 2 programs". It is its own legal regime with its own
// reporting duty, and OCR publishes it as its own listing at its own address.
//
// Structurally the grid is the same application as the HIPAA one — same
// PrimeFaces datatable, same four exporters, same under-investigation/archive
// TabView — so retrieval reuses the HIPAA machinery. The SCHEMA is not the
// same, and that difference was measured, not assumed.
//
// THE SCHEMA, AND HOW WE KNOW IT
//
// The Part 2 export ships EIGHT columns, not the HIPAA export's nine: it has
// no "Covered Entity Type" column, because the HIPAA covered-entity taxonomy
// does not apply to Part 2 programs.
//
// Two of the eight arrive from the exporter as serialized JSF components
// ("javax.faces.component.UIPanel@...") rather than as text — the same
// PrimeFaces defect the HIPAA export has, at columns 1 and 7. The exporter
// cannot tell us what those columns are called, so their names were read off
// the RENDERED GRID, where the header facets are ordinary markup, by
// scripts/probe-part2-schema.js. That probe ran the same extraction against
// the HIPAA grid as a control and recovered all nine known HIPAA names
// exactly, which is what makes its Part 2 output trustworthy.
//
// The names are "Name of Part 2 Program" and "Qualified Service Organization
// Present". A qualified service organization is the Part 2 analogue of a
// HIPAA business associate — a different legal instrument under a different
// rule, so it is recorded under its own name and asserted as nothing.
//
// WHAT WE ASSERT ABOUT THE DATA, AND WHY
//
// data_classes is ['medical'] and nothing more, on the same tautological
// footing as the HIPAA source: the Part 2 breach reporting duty is triggered
// by breaches of Part 2 records, and Part 2 records ARE substance use disorder
// treatment records — health information by definition. So 'medical' follows
// from the rule that put the record on the portal, rather than being inferred
// from any field.
//
// We deliberately do NOT mint a distinct "substance use disorder" data class.
// The severity rubric is published and versioned, and inventing a new weighted
// class here would silently change scores across the corpus. It would also be
// a stigma judgement rendered as arithmetic — the site asserting that this
// diagnosis is worse to expose than any other — which the government record
// does not say and we are in no position to add. Worse, it would only be
// detectable from WHICH LISTING published the row, so a hospital reporting an
// identical incident under HIPAA would score lower than a standalone program
// reporting it under Part 2: the number would stop measuring the breach and
// start measuring the filer's corporate structure.
//
// The regime is recorded as provenance instead, on the source row, and is
// surfaced on the page from there.

const hhs = require('./hhs-ocr');
const { parseCsv } = require('../csv');
const { PART2_GRID_PAGE } = require('./hhs-ocr-fetch');

const SOURCE_TYPE = 'hhs_part2';
const PORTAL_URL = PART2_GRID_PAGE;

// Read off the rendered grid on 2026-08-07; see the note above. Order matches
// the export, which matches the on-screen column order.
const ALL_COLUMNS = [
  'Name of Part 2 Program',
  'State',
  'Individuals Affected',
  'Breach Submission Date',
  'Type of Breach',
  'Location of Breached Information',
  'Qualified Service Organization Present',
  'Web Description',
];

// As with HIPAA, "Web Description" is not required: OCR fills it in after an
// investigation closes, so demanding it would fail a perfectly good export of
// open cases. "Qualified Service Organization Present" is not required either
// — it is provenance we record but assert nothing from, and requiring it would
// turn a cosmetic upstream rename into a failed ingest.
const REQUIRED_COLUMNS = [
  'Name of Part 2 Program',
  'State',
  'Individuals Affected',
  'Breach Submission Date',
  'Type of Breach',
  'Location of Breached Information',
];

const FIELDS = {
  entityName: 'Name of Part 2 Program',
  // The Part 2 export has no entity-type column at all. Null, not guessed:
  // there is no Part 2 equivalent of the HIPAA covered-entity taxonomy.
  entityType: null,
  associatePresent: 'Qualified Service Organization Present',
};

/**
 * Normalize one Part 2 row.
 *
 * Delegates to the shared HHS normalizer, telling it which columns carry which
 * facts, and how to namespace the identifiers. Part 2 records take their own
 * id and slug namespace so that a Part 2 filing and a HIPAA filing by the same
 * organization on the same date stay two records at two URLs. They are separate
 * filings under separate rules, and a numeric disambiguator would not do: which
 * one won the bare URL would depend on which source happened to run first, and
 * these URLs are permanent.
 */
function normalizeRow(row, opts = {}) {
  return hhs.normalizeRow(row, {
    ...opts,
    sourceUrl: PORTAL_URL,
    fields: FIELDS,
    sourceType: SOURCE_TYPE,
    idNamespace: SOURCE_TYPE,
    slugNamespace: 'part2',
  });
}

module.exports = {
  SOURCE_TYPE,
  PORTAL_URL,
  phase: 1,
  normalizeRow,
  FIELDS,
  REQUIRED_COLUMNS,
  ALL_COLUMNS,
  // Parsed against the PART 2 column list. Passing the HIPAA list here would
  // relabel a Part 2 program as a HIPAA covered entity during header repair.
  parse: (text) => parseCsv(hhs.repairHeaderRow(text, ALL_COLUMNS), { required: REQUIRED_COLUMNS }),
};
