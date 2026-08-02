// Texas Attorney General data breach reports — Phase 3, fills coverage gaps.
// Format: HTML list.
// Endpoint (verify against docs/SOURCES.md before every run):
//   https://oag.texas.gov/consumer-protection/data-breach-reporting
// The run must fail loudly on a 404, never skip (spec section 4).

const SOURCE_TYPE = 'tx_ag';
const ENDPOINT = 'https://oag.texas.gov/consumer-protection/data-breach-reporting';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: parser lands in Phase 3`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 3, fetchRaw };
