// California Attorney General breach list — Phase 2, second-best state source.
// Format: HTML table plus sample notification letters. CA-specific rights hooks.
// Endpoint (verify against docs/SOURCES.md before every run):
//   https://oag.ca.gov/privacy/databreach/list
// The run must fail loudly on a 404, never skip (spec section 4).

const SOURCE_TYPE = 'ca_ag';
const ENDPOINT = 'https://oag.ca.gov/privacy/databreach/list';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: parser lands in Phase 2`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 2, fetchRaw };
