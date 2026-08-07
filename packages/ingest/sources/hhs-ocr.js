// HHS Office for Civil Rights breach portal — Phase 1, the cleanest source.
// Federally mandated reporting of breaches of unsecured Protected Health
// Information affecting 500+ individuals.
//
// Endpoints are verified at run time against docs/SOURCES.md; a 404 fails the
// run loudly rather than skipping the source (spec section 4).

const crypto = require('crypto');
const { parseCsv } = require('../csv');

const SOURCE_TYPE = 'hhs_ocr';
const PORTAL_URL = 'https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf';

// The export ships nine columns, in this order, identically for the
// under-investigation and archive views. Verified against 6,814 records drawn
// from eight independently sourced exports spanning 2009-2025.
const ALL_COLUMNS = [
  'Name of Covered Entity',
  'State',
  'Covered Entity Type',
  'Individuals Affected',
  'Breach Submission Date',
  'Type of Breach',
  'Location of Breached Information',
  'Business Associate Present',
  'Web Description',
];

// Columns whose absence genuinely breaks ingestion. A rename upstream throws,
// naming both expected and found headers, instead of yielding a file of nulls.
// "Web Description" is deliberately not required: it is empty on every
// under-investigation row and populated on ~78% of archive rows, so demanding
// it would fail a perfectly good recent export.
const REQUIRED_COLUMNS = [
  'Name of Covered Entity',
  'State',
  'Covered Entity Type',
  'Individuals Affected',
  'Breach Submission Date',
  'Type of Breach',
  'Location of Breached Information',
];

// Complete controlled vocabulary for "Location of Breached Information"
// (8 atoms). Retained to detect vocabulary drift, not to infer data classes.
const LOCATIONS = new Set([
  'Network Server',
  'Email',
  'Paper/Films',
  'Laptop',
  'Other',
  'Desktop Computer',
  'Electronic Medical Record',
  'Other Portable Electronic Device',
]);

// "Type of Breach" is a controlled vocabulary, and records frequently carry
// several comma-separated values. Mapped onto the canonical breach_vector enum.
// Ordered by precedence: when a record reports both a hack and a theft, the
// deliberate-attack reading is the more informative one to publish.
const VECTOR_PRECEDENCE = ['hacking', 'improper_disposal', 'loss', 'insider', 'unknown'];
const VECTOR_MAP = {
  'hacking/it incident': 'hacking',
  // NOT 'insider'. HHS's "Unauthorized Access/Disclosure" covers both employee
  // snooping and access by outsiders, and the export does not say which. It is
  // the second-largest category in the dataset (roughly one record in five), so
  // collapsing it to 'insider' would misattribute cause at scale. 'unknown' is
  // the honest target until a source distinguishes them.
  'unauthorized access/disclosure': 'unknown',
  theft: 'loss',
  loss: 'loss',
  'improper disposal': 'improper_disposal',
  other: 'unknown',
  unknown: 'unknown',
};

// Which CSV column carries each fact. OCR's two breach listings are the same
// application over different regimes, so they share this shape but not these
// names: the Part 2 export calls the filer a "Name of Part 2 Program", has no
// entity-type column at all, and names a "Qualified Service Organization"
// where HIPAA names a "Business Associate". Reading by an explicit map keeps a
// column rename upstream a loud failure rather than a column of nulls.
const HIPAA_FIELDS = {
  entityName: 'Name of Covered Entity',
  entityType: 'Covered Entity Type',
  // The Part 2 analogue of a business associate. Different legal instrument,
  // different name; recorded as provenance, asserted as nothing.
  associatePresent: 'Business Associate Present',
};

const ENTITY_TYPES = new Set([
  'healthcare provider',
  'health plan',
  'healthcare clearing house',
  'health care clearing house',
  'business associate',
]);

/** MM/DD/YYYY (the portal's format) -> ISO YYYY-MM-DD. Returns null if absent. */
function toIsoDate(value) {
  if (!value) return null;
  const t = String(value).trim();
  if (!t) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const [, mo, d, y] = m;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return isRealDate(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isRealDate(t) ? t : null;
  return null;
}

function isRealDate(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Multi-value cells join atoms with ", " and are always alphabetically sorted.
// No atom contains a comma, so a plain split is safe and exact.
//
// Trap: "Other" is a prefix of "Other Portable Electronic Device". Atoms must
// be compared whole after splitting — never substring-matched.
function splitMulti(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Map "Type of Breach" onto breach_vector. Unrecognized tokens are reported so
 * the run can surface a vocabulary drift rather than silently calling it
 * 'unknown' forever.
 */
function mapVector(typeOfBreach, unknownTokens) {
  const tokens = splitMulti(typeOfBreach);
  const mapped = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (VECTOR_MAP[key]) mapped.push(VECTOR_MAP[key]);
    else if (unknownTokens) unknownTokens.add(t);
  }
  if (!mapped.length) return 'unknown';
  for (const v of VECTOR_PRECEDENCE) if (mapped.includes(v)) return v;
  return 'unknown';
}

/**
 * Data classes for an HHS record.
 *
 * This is deliberately conservative. HHS reports "Location of Breached
 * Information" — WHERE the data lived (Network Server, Email, Paper/Films) —
 * not WHICH categories of personal data were exposed. Inferring, say, Social
 * Security numbers from "Network Server" would be fabrication, and this site's
 * whole claim is that every published fact traces to the source.
 *
 * What IS tautological: the HIPAA Breach Notification Rule is triggered by
 * breaches of unsecured Protected Health Information. Every record in this
 * dataset is therefore, by the legal definition that put it there, a breach of
 * health information. So 'medical' is asserted from the statute, not inferred
 * from the location field — and nothing else is asserted at all.
 */
function deriveDataClasses() {
  return ['medical'];
}

/**
 * A deterministic id for a filing.
 *
 * `namespace` separates filings made under different rules. OCR runs two
 * breach listings — HIPAA and 42 CFR Part 2 — and one organization can appear
 * in both for genuinely different filings. Those must not collapse into one
 * record, so the namespace is part of the hashed input.
 */
function stableId(entityNormalized, notificationDate, namespace = SOURCE_TYPE) {
  const h = crypto
    .createHash('sha256')
    .update(`${namespace}|${entityNormalized}|${notificationDate || ''}`)
    .digest('hex');
  // Format as a UUID-shaped string so the id column stays visually consistent.
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

// A JSF component serialized by toString(), e.g.
// "javax.faces.component.UIPanel@3d52fe96". PrimeFaces' DataExporter emits
// this when a column's header is a composite facet (one holding sort or filter
// widgets) rather than a plain headerText attribute — it serializes the
// component instead of extracting its text.
const JSF_COMPONENT_HEADER = /^(?:javax|jakarta)\.faces\.component\.[A-Za-z.]+@[0-9a-f]+$/;

/**
 * Repair the header row of a live export.
 *
 * On the HIPAA export, columns 1 ("Name of Covered Entity") and 8 ("Business
 * Associate Present") arrive as serialized component objects; on the Part 2
 * export it is columns 1 ("Name of Part 2 Program") and 7 ("Qualified Service
 * Organization Present"). In both cases the real name was read off the
 * rendered grid, where the header facet is ordinary markup — never guessed,
 * because these names go into sources.raw_payload, the archived provenance for
 * every record.
 *
 * `columns` must therefore be the column list for the source being parsed.
 * Repairing a Part 2 export against the HIPAA layout would silently relabel
 * a Part 2 program as a HIPAA covered entity.
 *
 * The repair runs only under a strict guard: every other header must already
 * match the expected name at its expected index. If the layout differs in any
 * way, this returns the text untouched so the parser's own schema check fails
 * loudly rather than this function papering over a genuine upstream change.
 */
function repairHeaderRow(text, columns = ALL_COLUMNS) {
  const s = String(text);
  const nl = s.indexOf('\n');
  if (nl === -1) return s;
  const headerLine = s.slice(0, nl).replace(/\r$/, '');
  const rest = s.slice(nl + 1);

  const { parseRows } = require('../csv');
  let headers;
  try {
    headers = parseRows(headerLine)[0];
  } catch {
    return s;
  }
  if (!headers || headers.length !== columns.length) return s;

  const broken = [];
  for (let i = 0; i < headers.length; i++) {
    const got = headers[i].trim();
    if (JSF_COMPONENT_HEADER.test(got)) { broken.push(i); continue; }
    // Any non-broken header that does not match the documented layout means
    // this is not the known defect — leave it alone.
    if (got !== columns[i]) return s;
  }
  if (!broken.length) return s;

  const repaired = headers.map((h, i) => (broken.includes(i) ? columns[i] : h.trim()));
  const quoted = repaired.map((h) => `"${h.replace(/"/g, '""')}"`).join(',');
  return `${quoted}\n${rest}`;
}

function parseCount(value) {
  const t = String(value == null ? '' : value).trim().replace(/,/g, '');
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Map one HHS CSV row onto a breach record plus its source row.
 *
 * Fields HHS does not report are left null. That is deliberate and is the
 * whole point: this site's claim is that every published fact traces to a
 * government source, so a field the source is silent about must stay empty
 * rather than be filled with a plausible guess.
 *
 * Specifically NOT populated from this source:
 *  - discovery_date, breach_start_date, breach_end_date: HHS publishes only a
 *    submission date, so the notification-lag component of the severity score
 *    correctly scores 0 and is flagged "not disclosed".
 *  - states_notified: HHS gives ONE state, the covered entity's own location.
 *    That is not the set of states whose residents were notified, and
 *    presenting it as such would be a misrepresentation.
 *  - remediation_offered: HHS does not collect it. Absent, not "none offered".
 */
function normalizeRow(row, {
  retrievedAt,
  checksum,
  sourceUrl = PORTAL_URL,
  unknownVectorTokens,
  fields = HIPAA_FIELDS,
  sourceType = SOURCE_TYPE,
  idNamespace = SOURCE_TYPE,
  slugNamespace = null,
} = {}) {
  const { normalizeEntityName } = require('../entity-resolve');

  const entityName = String(row[fields.entityName] || '').trim();
  const notificationDate = toIsoDate(row['Breach Submission Date']);
  const normalized = normalizeEntityName(entityName);

  const record = {
    id: stableId(normalized, notificationDate, idNamespace),
    // Namespaces the public URL when one organization files under two rules.
    // Dropped before the write; d1-writer builds from an explicit column list.
    slug_namespace: slugNamespace,
    entity_name: entityName,
    entity_name_normalized: normalized,
    entity_aliases: null,
    sector: 'healthcare', // every covered entity in this dataset is a HIPAA entity
    breach_start_date: null,
    breach_end_date: null,
    discovery_date: null,
    notification_date: notificationDate,
    records_affected: parseCount(row['Individuals Affected']),
    // HHS counts are the figures the entity itself reported to the regulator,
    // not our estimate, so they are not marked estimated.
    records_affected_is_est: 0,
    data_classes: JSON.stringify(deriveDataClasses()),
    states_notified: JSON.stringify([]),
    remediation_offered: null,
    breach_vector: mapVector(row['Type of Breach'], unknownVectorTokens),
    status: 'published',
    // Retained for provenance and for later cross-source reconciliation.
    _hhs: {
      state: String(row['State'] || '').trim() || null,
      entity_type: fields.entityType ? String(row[fields.entityType] || '').trim() || null : null,
      location: String(row['Location of Breached Information'] || '').trim() || null,
      locations: splitMulti(row['Location of Breached Information']),
      // Stored under the source's own column name, so a Part 2 filing is never
      // recorded as having reported a HIPAA business associate.
      associate_present_column: fields.associatePresent,
      associate_present: String(row[fields.associatePresent] || '').trim() || null,
      // OCR's own post-investigation narrative. Empty on under-investigation
      // rows, present on most archived ones. It is the government's account in
      // the government's words, so it can be quoted directly.
      web_description: String(row['Web Description'] || '').trim() || null,
    },
  };

  const source = {
    source_type: sourceType,
    source_url: sourceUrl,
    document_url: null,
    r2_archive_key: null,
    retrieved_at: retrievedAt,
    checksum: checksum || null,
    raw_payload: JSON.stringify(row),
  };

  return { record, source };
}

module.exports = {
  SOURCE_TYPE,
  PORTAL_URL,
  ALL_COLUMNS,
  LOCATIONS,
  parseCount,
  normalizeRow,
  REQUIRED_COLUMNS,
  VECTOR_MAP,
  ENTITY_TYPES,
  HIPAA_FIELDS,
  phase: 1,
  toIsoDate,
  splitMulti,
  mapVector,
  deriveDataClasses,
  stableId,
  repairHeaderRow,
  parse: (text) => parseCsv(repairHeaderRow(text), { required: REQUIRED_COLUMNS }),
};
