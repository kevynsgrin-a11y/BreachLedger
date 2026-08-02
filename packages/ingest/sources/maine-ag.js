// Maine Attorney General breach notifications — Phase 2, best state source.
// Format: HTML list plus PDF copies of actual notification letters.
// Endpoint (verify against docs/SOURCES.md before every run):
//   https://www.maine.gov/ag/consumer/identity_theft/
// The run must fail loudly on a 404, never skip (spec section 4).

const SOURCE_TYPE = 'maine_ag';
const ENDPOINT = 'https://www.maine.gov/ag/consumer/identity_theft/';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: parser lands in Phase 2`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 2, fetchRaw };
