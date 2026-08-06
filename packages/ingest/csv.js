// RFC 4180 CSV parser. Dependency-free, because the ingest runs in
// constrained environments and a CSV parser is not worth a supply-chain risk.
//
// Handles: quoted fields, embedded commas, embedded newlines, escaped quotes
// (""), CRLF or LF line endings, and a UTF-8 BOM. Government exports contain
// all of these — entity names in the HHS data routinely include commas
// ("Smith, Jones and Associates, P.C.").

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse CSV text into an array of string arrays.
 * Throws on a quoted field that is never closed, rather than silently
 * truncating the file.
 */
function parseRows(text) {
  const s = stripBom(String(text));
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let fieldWasQuoted = false;

  while (i < s.length) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { inQuotes = true; fieldWasQuoted = true; i++; continue; }

    if (c === ',') { row.push(field); field = ''; fieldWasQuoted = false; i++; continue; }

    if (c === '\r' || c === '\n') {
      // Consume CRLF as one terminator.
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      // Skip blank lines produced by trailing newlines.
      if (!(row.length === 1 && row[0] === '' && !fieldWasQuoted)) rows.push(row);
      row = []; field = ''; fieldWasQuoted = false; i++; continue;
    }

    field += c; i++;
  }

  if (inQuotes) {
    throw new Error('CSV parse failed: unterminated quoted field (truncated or malformed download)');
  }
  // Flush the final field/row when the file does not end with a newline.
  if (field !== '' || row.length || fieldWasQuoted) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '' && !fieldWasQuoted)) rows.push(row);
  }
  return rows;
}

/**
 * Parse CSV into objects keyed by header name.
 * `required` is a list of header names that must be present; a missing one
 * throws, so an upstream schema change fails the run loudly instead of
 * silently producing rows full of undefined.
 */
function parseCsv(text, { required = [] } = {}) {
  const rows = parseRows(text);
  if (!rows.length) throw new Error('CSV parse failed: file is empty');
  const headers = rows[0].map((h) => h.trim());

  const missing = required.filter((r) => !headers.includes(r));
  if (missing.length) {
    throw new Error(
      `CSV schema changed: missing expected column(s) ${missing.map((m) => JSON.stringify(m)).join(', ')}. ` +
        `Found: ${headers.map((h) => JSON.stringify(h)).join(', ')}`
    );
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // A short row is a real anomaly worth surfacing, not padding silently.
    if (cells.length !== headers.length) {
      if (cells.every((c) => c === '')) continue; // tolerate blank lines
      throw new Error(
        `CSV parse failed at data row ${r}: expected ${headers.length} fields, got ${cells.length}`
      );
    }
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = cells[c].trim();
    out.push(obj);
  }
  return { headers, rows: out };
}

module.exports = { parseCsv, parseRows };
