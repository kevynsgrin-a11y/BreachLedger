// SQL literal escaping shared by the seed loader and the ingest writer.
//
// SQLite (and therefore D1) has exactly one escape rule for string literals:
// a single quote is doubled. Backslash is NOT an escape character, so no
// backslash handling is needed or correct here. This was verified by executing
// hostile payloads against a real SQLite engine during the Phase 0 audit.

function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

module.exports = { sqlLiteral };
