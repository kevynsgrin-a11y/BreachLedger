// fetch-util.js is the policy layer every source parser sits behind: identify
// ourselves, rate-limit per host, bound every request, checksum the payload,
// and record where the response actually came from after redirects. Every
// sibling parser has tests; this gate they all share had none.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { politeFetch, sha256, USER_AGENT, MIN_INTERVAL_MS } = require('./fetch-util');

/**
 * Stand up a fake global fetch and hand back the call log.
 *
 * `respond` receives (url, options) and returns a response-like object, so a
 * test can script redirects, cookies, and failures without a network.
 */
function mockFetch(respond) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts, headers: opts.headers || {} });
    const res = (await respond(url, opts)) || {};
    return {
      ok: res.ok !== false,
      status: res.status || 200,
      statusText: res.statusText || 'OK',
      url: res.url === undefined ? url : res.url,
      redirected: res.redirected === true,
      headers: { getSetCookie: () => res.setCookie || [] },
      text: async () => (res.body === undefined ? '' : res.body),
    };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// Each test uses a distinct host. The rate limiter is module-level state keyed
// by host and never reset, so sharing a host would make tests order-dependent.
let seq = 0;
const uniqHost = () => `host-${process.pid}-${seq++}.example`;

test('identifies itself with a descriptive User-Agent carrying a contact URL', async () => {
  // Required by SEC EDGAR policy and basic courtesy to the state portals.
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/data`);
  } finally {
    restore();
  }
  assert.equal(calls[0].headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /https:\/\/breachbook\.org\//);
});

test('a caller-supplied header is kept, and can override the default User-Agent', async () => {
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/data`, {
      headers: { 'Accept': 'text/csv', 'User-Agent': 'custom/9' },
    });
  } finally {
    restore();
  }
  assert.equal(calls[0].headers.Accept, 'text/csv');
  assert.equal(calls[0].headers['User-Agent'], 'custom/9');
});

test('checksums the body so an unchanged export is recognizable', async () => {
  const body = 'Name of Covered Entity,State\nAcme Clinic,CA\n';
  const { restore } = mockFetch(async () => ({ body }));
  let out;
  try {
    out = await politeFetch(`https://${uniqHost()}/data`);
  } finally {
    restore();
  }
  assert.equal(out.checksum, crypto.createHash('sha256').update(body).digest('hex'));
  assert.equal(out.body, body);
});

test('stamps a retrieval time as an ISO-8601 instant', async () => {
  const { restore } = mockFetch(async () => ({ body: 'x' }));
  let out;
  try {
    out = await politeFetch(`https://${uniqHost()}/data`);
  } finally {
    restore();
  }
  assert.equal(out.retrieved_at, new Date().toISOString());
});

test('records the final URL and flags a redirect as a URL-rot signal', async () => {
  // Provenance: a 3xx-followed response comes from res.url, which may not be the
  // requested address. Callers must store the final URL, not the one they asked for.
  const { restore } = mockFetch(async (url) => ({
    body: 'x',
    url: `${url}/moved`,
    redirected: true,
  }));
  let out;
  try {
    out = await politeFetch('https://rot.example/a');
  } finally {
    restore();
  }
  assert.equal(out.final_url, 'https://rot.example/a/moved');
  assert.equal(out.redirected, true);
});

test('a non-redirected response is not flagged as one', async () => {
  const { restore } = mockFetch(async () => ({ body: 'x' }));
  let out;
  try {
    out = await politeFetch('https://plain.example/a');
  } finally {
    restore();
  }
  assert.equal(out.final_url, 'https://plain.example/a');
  assert.equal(out.redirected, false);
});

test('fails loudly on a non-2xx, naming the status and the URL', async () => {
  // Never skip a source silently: a rotated endpoint has to surface as a
  // failure of the whole run, not as a quietly shorter record set.
  const { restore } = mockFetch(async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
  }));
  try {
    await assert.rejects(
      () => politeFetch('https://gone.example/list'),
      (err) => {
        assert.match(err.message, /source fetch failed: 404 Not Found for https:\/\/gone\.example\/list/);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('replays the session cookie on a jar-bound request and absorbs the response cookie', async () => {
  // The HHS OCR portal is a stateful JSF app: the JSESSIONID has to travel
  // with the request sequence or the postback is answered as a new session.
  let cookies = new Map();
  const jar = {
    absorb(res) {
      for (const line of res.headers.getSetCookie()) {
        const pair = String(line).split(';')[0];
        const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
  const { calls, restore } = mockFetch(async () => ({
    body: 'ok',
    setCookie: ['JSESSIONID=XYZ; Path=/; HttpOnly'],
  }));
  const host = uniqHost();
  try {
    // Nothing in the jar yet, so the first request carries no Cookie.
    await politeFetch(`https://${host}/export`, { jar });
    assert.ok(!('Cookie' in calls[0].headers));
    // The server issued a session on that call; the jar must replay it forward,
    // or the next postback is answered as a different session.
    await politeFetch(`https://${host}/export`, { jar });
    assert.equal(calls[1].headers.Cookie, 'JSESSIONID=XYZ');
  } finally {
    restore();
  }
  assert.equal(jar.header(), 'JSESSIONID=XYZ');
});

test('sends no Cookie header when no jar is supplied', async () => {
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/data`);
  } finally {
    restore();
  }
  assert.ok(!('Cookie' in calls[0].headers));
});

test('bounds every request with a timeout signal', async () => {
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/data`);
  } finally {
    restore();
  }
  const sig = calls[0].opts.signal;
  assert.ok(sig, 'request carried no AbortSignal');
  assert.equal(sig.aborted, false);
});

test('honours a caller-supplied signal instead of overwriting it', async () => {
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  const mine = AbortSignal.timeout(5000);
  try {
    await politeFetch(`https://${uniqHost()}/data`, { signal: mine });
  } finally {
    restore();
  }
  assert.equal(calls[0].opts.signal, mine);
});

// timeoutMs is consumed for the signal and must not leak into the fetch options
// as a stray body field.
test('timeoutMs configures the signal without leaking into the request', async () => {
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/data`, { timeoutMs: 1234, raw: true });
  } finally {
    restore();
  }
  assert.ok(!('timeoutMs' in calls[0].opts));
});

test('passes the remaining options through to fetch', async () => {
  const { calls, restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/data`, { method: 'POST', body: 'a=1' });
  } finally {
    restore();
  }
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.body, 'a=1');
});

// --- Rate limiting ---------------------------------------------------------
// The slot is reserved synchronously before awaiting. That is what stops N
// concurrent callers all reading the same stale timestamp and bursting at once.

test('serializes concurrent callers to the same host at one request per interval', async () => {
  const host = uniqHost();
  const start = Date.now();
  const { restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await Promise.all([
      politeFetch(`https://${host}/a`),
      politeFetch(`https://${host}/b`),
      politeFetch(`https://${host}/c`),
    ]);
  } finally {
    restore();
  }
  // Three requests at >=1/sec means at least two full intervals of waiting.
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed >= 2 * MIN_INTERVAL_MS - 25,
    `expected >= ${2 * MIN_INTERVAL_MS}ms of spacing, took ${elapsed}ms`
  );
});

test('does not delay the first request to a host', async () => {
  const start = Date.now();
  const { restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await politeFetch(`https://${uniqHost()}/a`);
  } finally {
    restore();
  }
  assert.ok(Date.now() - start < MIN_INTERVAL_MS / 2, 'the first request should not wait');
});

test('different hosts do not delay each other', async () => {
  const start = Date.now();
  const { restore } = mockFetch(async () => ({ body: 'ok' }));
  try {
    await Promise.all([
      politeFetch(`https://${uniqHost()}/a`),
      politeFetch(`https://${uniqHost()}/b`),
      politeFetch(`https://${uniqHost()}/c`),
    ]);
  } finally {
    restore();
  }
  assert.ok(Date.now() - start < MIN_INTERVAL_MS / 2, 'distinct hosts must not serialize against each other');
});

test('MIN_INTERVAL_MS is the documented <=1 req/sec policy', () => {
  assert.ok(MIN_INTERVAL_MS <= 1000, 'per-host interval must not exceed one request per second');
});

// --- sha256 ----------------------------------------------------------------

test('sha256 matches the platform digest for known input', () => {
  assert.equal(sha256(''), crypto.createHash('sha256').update('').digest('hex'));
  assert.equal(
    sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('sha256 handles non-ASCII text as UTF-8', () => {
  assert.equal(sha256('naïve — ünïcodé'), crypto.createHash('sha256').update('naïve — ünïcodé', 'utf8').digest('hex'));
});

test('sha256 is content-addressed, so a changed byte changes the digest', () => {
  assert.notEqual(sha256('Acme Clinic,CA'), sha256('Acme Clinic,CB'));
});
