// SEC EDGAR 8-K Item 1.05 (material cybersecurity incidents) — Phase 3.
// Low volume, high value: public-company material incidents.
// Format: EDGAR full-text search API (JSON).
// Endpoints (verify against docs/SOURCES.md before every run):
//   UI:  https://efts.sec.gov/LATEST/search-index?q=... (via https://www.sec.gov/edgar/search/)
// SEC policy REQUIRES a descriptive User-Agent identifying the requester —
// packages/ingest/fetch-util.js sets it globally. Do not fetch EDGAR without it.
// The run must fail loudly on a 404, never skip (spec section 4).

const SOURCE_TYPE = 'sec_8k';
const ENDPOINT = 'https://efts.sec.gov/LATEST/search-index?q=%22Item%201.05%22&forms=8-K';

async function fetchRaw() {
  throw new Error(`${SOURCE_TYPE}: parser lands in Phase 3`);
}

module.exports = { SOURCE_TYPE, ENDPOINT, phase: 3, fetchRaw };
