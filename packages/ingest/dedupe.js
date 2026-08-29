// Dedupe stage (spec section 4). The same breach frequently appears in
// HHS + Maine + CA + WA. Match rule: normalized entity name AND overlapping
// date window (+/-45 days on notification_date). On match:
//   - merge into one canonical breach row
//   - union states_notified and data_classes arrays
//   - take MAX of records_affected
//   - append ALL source rows — never delete a source row during merge
//
// Two decisions the spec leaves open, settled here and documented because a
// rule whose reason is missing is a rule someone will overturn the first time
// it is inconvenient:
//
// 1. THE WINDOW IS ANCHORED, NOT CHAINED. A candidate matches a cluster when it
//    falls within 45 days of that cluster's ANCHOR (the earliest notification
//    date seen for it), never merely within 45 days of some other member. A
//    chained reading would let A(day 0)+B(day 40)+C(day 80)+... walk a cluster
//    across an unbounded span, silently collapsing a decade of distinct filings
//    by one hospital chain into a single record. Anchoring bounds any cluster
//    to a 45-day span forward of its anchor. Merging two genuinely distinct
//    breaches is worse than leaving two rows that a human can later merge:
//    the first destroys a fact, the second only delays one.
//
// 2. A MISSING notification_date NEVER MATCHES. The window cannot be evaluated
//    without both dates, and "unknown" is not "equal". Such records pass
//    through untouched rather than merging on name alone — a large entity
//    (one health system, many separate filings) would otherwise collapse.
//
// Sparse-field fill: state AG filings routinely carry fields HHS does not
// publish (discovery_date, breach_vector, remediation_offered). On merge the
// first non-null value wins for those fields, which is the whole point of
// merging across sources. Fields already set on the canonical row are never
// overwritten, so a merge can add facts but never silently change one.

const MATCH_WINDOW_DAYS = 45;
const DAY_MS = 86400000;

// Fields where a later source may supply a value the canonical row lacks.
// Deliberately excludes entity_name, slug, and id: identity is not merged.
const FILLABLE_FIELDS = [
  'sector',
  'breach_start_date',
  'breach_end_date',
  'discovery_date',
  'breach_vector',
  'remediation_offered',
  'entity_aliases',
];

function parseDay(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Reject calendar-invalid dates (2025-02-30) rather than rolling them over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function union(a, b) {
  return [...new Set([...asArray(a), ...asArray(b)])];
}

/**
 * Does `record` belong to the cluster anchored at `anchorDay` for the same
 * normalized entity name? Both dates must be present and calendar-valid.
 */
function withinWindow(anchorDay, record) {
  const day = parseDay(record.notification_date);
  if (day === null || anchorDay === null) return false;
  return Math.abs(day - anchorDay) <= MATCH_WINDOW_DAYS * DAY_MS;
}

/**
 * Find an existing cluster `record` should merge into.
 * @param {object} record
 * @param {Map<string, Array<{anchorDay:number, record:object}>>} clustersByName
 * @returns {object|null} the canonical record to merge into, or null
 */
function findDuplicate(record, clustersByName) {
  const name = record.entity_name_normalized;
  if (!name) return null;
  const day = parseDay(record.notification_date);
  if (day === null) return null; // decision 2: unknown date never matches
  const clusters = clustersByName.get(name) || [];
  for (const cluster of clusters) {
    if (withinWindow(cluster.anchorDay, record)) return cluster.record;
  }
  return null;
}

/**
 * Merge `incoming` into `canonical` in place, per the contract above.
 * Never drops a source row; never overwrites an existing non-null field.
 */
function mergeInto(canonical, incoming) {
  canonical.states_notified = union(canonical.states_notified, incoming.states_notified);
  canonical.data_classes = union(canonical.data_classes, incoming.data_classes);

  const a = Number(canonical.records_affected);
  const b = Number(incoming.records_affected);
  const aOk = canonical.records_affected != null && Number.isFinite(a);
  const bOk = incoming.records_affected != null && Number.isFinite(b);
  if (bOk && (!aOk || b > a)) {
    canonical.records_affected = b;
    // The estimate flag travels with the number it describes.
    canonical.records_affected_is_est = incoming.records_affected_is_est ?? 0;
  }

  // Append ALL source rows. Never delete a source row during merge.
  canonical.sources = [...asArray(canonical.sources), ...asArray(incoming.sources)];

  for (const field of FILLABLE_FIELDS) {
    if (canonical[field] == null && incoming[field] != null) {
      canonical[field] = incoming[field];
    }
  }

  // Keep the earliest notification_date as the record's own: it is the first
  // date on which this breach entered the public record.
  const canonDay = parseDay(canonical.notification_date);
  const inDay = parseDay(incoming.notification_date);
  if (inDay !== null && (canonDay === null || inDay < canonDay)) {
    canonical.notification_date = incoming.notification_date;
  }
  return canonical;
}

/**
 * Collapse cross-source duplicates.
 * Input records are never mutated; merged results are fresh objects.
 * @param {Array<object>} records
 * @returns {Array<object>} deduplicated records, input order preserved
 */
function dedupe(records) {
  if (!Array.isArray(records)) throw new TypeError('dedupe: expected an array of records');

  const clustersByName = new Map();
  const kept = [];

  for (const record of records) {
    const canonical = findDuplicate(record, clustersByName);
    if (canonical) {
      mergeInto(canonical, record);
      continue;
    }
    // Fresh object so callers' inputs are never mutated by a later merge.
    const copy = {
      ...record,
      states_notified: asArray(record.states_notified),
      data_classes: asArray(record.data_classes),
      sources: asArray(record.sources),
    };
    kept.push(copy);
    const name = copy.entity_name_normalized;
    if (name) {
      const day = parseDay(copy.notification_date);
      // Only dated records anchor a cluster; undated ones can never be matched
      // into (decision 2), so they need no cluster entry.
      if (day !== null) {
        if (!clustersByName.has(name)) clustersByName.set(name, []);
        clustersByName.get(name).push({ anchorDay: day, record: copy });
      }
    }
  }

  return kept;
}

module.exports = { dedupe, findDuplicate, mergeInto, MATCH_WINDOW_DAYS };
