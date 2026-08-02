// Washington Attorney General breach notifications — Phase 2.
// Format: HTML/dashboard. Good for cross-referencing record counts.
// Endpoint (verify against docs/SOURCES.md before every run):
//   https://www.atg.wa.gov/data-breach-notifications
// The run must fail loudly on a 404, never skip (spec section 4).

const SOURCE_TYPE = 'wa_ag';
const ENDPOINT = 'https://www.atg.wa.gov/data-breach-notifications';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: parser lands in Phase 2`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 2, fetchRaw };
