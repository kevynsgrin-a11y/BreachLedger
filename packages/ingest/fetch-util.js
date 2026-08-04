// Shared fetch policy for all source parsers (spec sections 4 and 11):
// identify ourselves, rate-limit per host, bound every request with a timeout,
// checksum payloads, record the final URL after redirects, fail loudly.

const crypto = require('crypto');

// Descriptive User-Agent with a contact URL — required by SEC EDGAR policy and
// basic courtesy toward state AG portals. Getting IP-banned is an expensive,
// avoidable mistake. The contact URL must stay reachable and carry a way to
// reach us; /sources is that page.
const USER_AGENT = 'BreachBookBot/1.0 (+https://breachbook.org/sources; public-records ingest)';

const MIN_INTERVAL_MS = 1000; // <=1 req/sec per host
const DEFAULT_TIMEOUT_MS = 30_000;

// Per-host schedule of the next allowed request time. The slot is reserved
// SYNCHRONOUSLY before awaiting, so N concurrent callers serialize at 1/sec
// instead of all reading the same stale timestamp and bursting together.
const nextSlotAt = new Map();

async function politeFetch(url, options = {}) {
  const host = new URL(url).host;
  const now = Date.now();
  const slot = Math.max(now, (nextSlotAt.get(host) || 0));
  nextSlotAt.set(host, slot + MIN_INTERVAL_MS);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));

  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const res = await fetch(url, {
    ...fetchOptions,
    signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT, ...(fetchOptions.headers || {}) },
  });
  if (!res.ok) {
    // Fail loudly on rotated/removed endpoints — never skip a source silently.
    throw new Error(`source fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  const body = await res.text();
  return {
    body,
    checksum: sha256(body),
    retrieved_at: new Date().toISOString(),
    // Provenance: a 3xx-followed response comes from res.url, which may differ
    // from the requested source_url. Callers must record final_url (and treat
    // redirected=true as a URL-rot signal worth surfacing in docs/SOURCES.md).
    final_url: res.url || url,
    redirected: res.redirected === true,
  };
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

module.exports = { politeFetch, sha256, USER_AGENT, MIN_INTERVAL_MS };
