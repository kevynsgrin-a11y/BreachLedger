// HHS Office for Civil Rights breach portal — Phase 1, the cleanest source.
// Federally mandated reporting of healthcare breaches affecting >=500 people.
// Format: CSV export from the portal. ~5,000+ historical records.
// Endpoint (verify against docs/SOURCES.md before every run — portals rotate):
//   https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf
// The run must fail loudly on a 404, never skip (spec section 4).

const SOURCE_TYPE = 'hhs_ocr';
const ENDPOINT = 'https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: parser lands in Phase 1`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 1, fetchRaw };
