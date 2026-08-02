// Shared fetch policy for all source parsers (spec sections 4 and 11):
// identify ourselves, rate-limit per host, checksum payloads, fail loudly.

const crypto = require('crypto');

// Descriptive User-Agent with a contact URL — required by SEC EDGAR policy and
// basic courtesy toward state AG portals. Getting IP-banned is an expensive,
// avoidable mistake.
const USER_AGENT = 'BreachLedgerBot/1.0 (+https://breachledger.example/sources; public-records ingest)';

const MIN_INTERVAL_MS = 1000; // <=1 req/sec per host
const lastRequestAt = new Map();

async function politeFetch(url, options = {}) {
  const host = new URL(url).host;
  const last = lastRequestAt.get(host) || 0;
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());

  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
  });
  if (!res.ok) {
    // Fail loudly on rotated/removed endpoints — never skip a source silently.
    throw new Error(`source fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  const body = await res.text();
  return { body, checksum: sha256(body), retrieved_at: new Date().toISOString() };
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

module.exports = { politeFetch, sha256, USER_AGENT };
