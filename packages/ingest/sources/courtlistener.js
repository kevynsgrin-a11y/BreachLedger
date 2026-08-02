// CourtListener REST v4 — Phase 4. Docket tracking for the litigation table.
// Format: JSON API. Requires a free API token (COURTLISTENER_TOKEN secret).
// Endpoint (verify against docs/SOURCES.md before every run):
//   https://www.courtlistener.com/api/rest/v4/
// The run must fail loudly on auth/404 errors, never skip (spec section 4).

const SOURCE_TYPE = 'courtlistener';
const ENDPOINT = 'https://www.courtlistener.com/api/rest/v4/';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: integration lands in Phase 4`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 4, fetchRaw };
