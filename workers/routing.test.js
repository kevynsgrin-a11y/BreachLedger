// Worker request/response shaping: URL routing, query handling, method and header
// independence, error responses, and JSON envelopes.
//
// Nothing here talks to the network or a D1/KV binding. The api and alerts
// workers are HTTP front doors whose whole surface is "given a Request, what
// Response comes back", so they are driven with the runtime's own Request and
// Response and read back through them. ingest-cron is driven through
// `scheduled`, where the contract is that every cron pattern throws rather than
// returning quietly -- a silent no-op would look like a healthy pipeline.
//
// These are stubs on purpose (the workers are INERT, see README "Build phases"),
// so the tests pin the contract that exists today: which paths answer, which
// status and envelope each one returns, and that nothing invents a route.

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// The worker sources are ES modules, but the repo is `type: commonjs` and Node
// refuses to resolve a bare `import()` of an ambiguous .js file ("Unexpected
// token 'export'"). Loading each source as a real ES module over a data: URL
// evaluates the actual file on disk -- no transformed copy, so these tests
// cannot drift from the worker they claim to cover.
const loadWorker = async (name) => {
  const src = readFileSync(join(__dirname, name, 'src', 'index.js'), 'utf8');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  return mod.default;
};

const ORIGIN = 'https://breachbook.org';

/**
 * Drive a worker's `fetch` with a real Request. `target` may be a path or an
 * absolute URL; `init` is passed straight through so a test can vary method and
 * headers without a bespoke helper per case.
 */
const call = (worker, target, init) =>
  worker.fetch(new Request(new URL(target, ORIGIN).href, init), {}, {});

/** Read a Response down to the shape under test: status, content-type, JSON body. */
const envelope = async (res) => ({
  status: res.status,
  type: res.headers.get('content-type'),
  body: await res.json(),
});

// --- api worker: the route table -------------------------------------------

test('api: /api/health answers 200 with the service envelope', async () => {
  const api = await loadWorker('api');
  assert.deepEqual(await envelope(await call(api, '/api/health')), {
    status: 200,
    type: 'application/json',
    body: { ok: true, service: 'breachbook-api' },
  });
});

test('api: /api/deadlines is an explicit 501 stub, not an empty 200', async () => {
  const api = await loadWorker('api');
  // An unimplemented feed must report as unimplemented. A 200 here would be an
  // empty deadline list, which reads downstream as "no deadlines exist".
  assert.deepEqual(await envelope(await call(api, '/api/deadlines')), {
    status: 501,
    type: 'application/json',
    body: { error: 'settlement deadline feed lands in Phase 4' },
  });
});

test('api: /api/subscribe is a 501 stub that names the double opt-in constraint', async () => {
  const api = await loadWorker('api');
  const res = await call(api, '/api/subscribe');
  const { status, body } = await envelope(res);
  assert.equal(status, 501);
  // The message is the only place the constraint is recorded for anyone who
  // finds this route before Phase 5 exists. Keep it named.
  assert.match(body.error, /Phase 5/);
  assert.match(body.error, /double opt-in required/);
});

test('api: an unknown path is a 404 JSON error, not a bare Response', async () => {
  const api = await loadWorker('api');
  assert.deepEqual(await envelope(await call(api, '/api/nope')), {
    status: 404,
    type: 'application/json',
    body: { error: 'not found' },
  });
});

test('api: every response is JSON, including the error paths', async () => {
  const api = await loadWorker('api');
  for (const target of ['/api/health', '/api/deadlines', '/api/subscribe', '/api/nope']) {
    const res = await call(api, target);
    assert.equal(res.headers.get('content-type'), 'application/json', `${target} is not JSON`);
    await res.json(); // throws if the body is not parseable JSON
  }
});

// --- routing: path is the only thing that selects a route -------------------

test('api: routing keys on the path, so the origin does not change the answer', async () => {
  const api = await loadWorker('api');
  const local = await call(api, 'http://localhost:8787/api/health');
  assert.deepEqual(await envelope(local), {
    status: 200,
    type: 'application/json',
    body: { ok: true, service: 'breachbook-api' },
  });
});

test('api: a near-miss path does not alias a live route', async () => {
  const api = await loadWorker('api');
  // A trailing slash, a case difference, and a percent-encoded segment must all
  // miss. Aliasing them would widen the live surface beyond what is served.
  for (const target of ['/api/health/', '/API/health', '/api/%68ealth', '/api/healthz']) {
    assert.equal((await call(api, target)).status, 404, `${target} should not route`);
  }
});

// --- query strings ----------------------------------------------------------

test('api: a query string is ignored when routing but never invents a route', async () => {
  const api = await loadWorker('api');
  const health = await call(api, '/api/health?x=1&y=2');
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()), { ok: true, service: 'breachbook-api' });

  assert.equal((await call(api, '/api/nope?x=1')).status, 404);
});

test('api: malformed query params fail closed on the unimplemented routes', async () => {
  const api = await loadWorker('api');
  // Undecodable percent-escapes and junk values. None of these are read today,
  // and the point is that they cannot promote a stub into a success: the feed
  // still reports 501 rather than serving a filtered-looking deadline list.
  const junk = ['?limit=%E0%A4%A', '?from=%%%', '?%GG=1', '?limit=notanumber&offset=-1'];
  for (const qs of junk) {
    const res = await call(api, `/api/deadlines${qs}`);
    assert.equal(res.status, 501, `${qs} should not reach a 200`);
    await res.json();
  }
  // The same junk on a 404 path stays a 404.
  assert.equal((await call(api, `/api/nope${junk[0]}`)).status, 404);
});

// --- methods and headers ----------------------------------------------------

test('api: the route table is method-independent -- no method is rejected', async () => {
  const api = await loadWorker('api');
  // Pins the contract as it stands: this worker routes on path alone and
  // applies no method gate, so GET and POST on a path are the same response.
  const expected = { ok: true, service: 'breachbook-api' };
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const res = await call(api, '/api/health', { method });
    assert.equal(res.status, 200, `${method} /api/health`);
    assert.deepEqual(await res.json(), expected, `${method} /api/health envelope`);
  }
  // A non-GET on an unknown path is still a 404, not a 200 or a 501.
  assert.equal((await call(api, '/api/nope', { method: 'POST' })).status, 404);
});

test('api: request headers do not negotiate the response', async () => {
  const api = await loadWorker('api');
  // There is no content negotiation: a browser asking for HTML still gets the
  // JSON envelope, so no path can be talked into serving a different shape.
  const res = await call(api, '/api/health', { headers: { accept: 'text/html' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { ok: true, service: 'breachbook-api' });
});

test('api: the stub surface needs no bindings', async () => {
  const api = await loadWorker('api');
  // No route reaches for env.DB or env.HOT yet. Passing nothing at all must not
  // throw, so a missing binding surfaces only once a route actually uses it.
  const res = await api.fetch(new Request(new URL('/api/deadlines', ORIGIN).href));
  assert.equal(res.status, 501);
  assert.equal((await api.fetch(new Request(new URL('/api/health', ORIGIN).href))).status, 200);
});

// --- alerts worker ----------------------------------------------------------

test('alerts: every path is one 501 stub with the Phase 5 envelope', async () => {
  const alerts = await loadWorker('alerts');
  // Deliberately a catch-all, not a route table with a 404: the worker refuses
  // the whole surface until double opt-in and unsubscribe exist.
  for (const target of ['/', '/api/alerts', '/api/subscribe', '/nope']) {
    assert.deepEqual(await envelope(await call(alerts, target)), {
      status: 501,
      type: 'application/json',
      body: { error: 'alerts land in Phase 5' },
    });
  }
});

test('alerts: the stub is method- and header-independent', async () => {
  const alerts = await loadWorker('alerts');
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const res = await call(alerts, '/api/alerts/unsubscribe', { method });
    assert.equal(res.status, 501, `${method} unsubscribe`);
    assert.deepEqual(await res.json(), { error: 'alerts land in Phase 5' });
  }
});

// --- ingest-cron scheduled events -------------------------------------------

test('ingest-cron: each declared cron throws instead of resolving quietly', async () => {
  const cron = await loadWorker('ingest-cron');
  await assert.rejects(
    () => cron.scheduled({ cron: '0 6 * * *' }, {}, {}),
    /daily ingest not implemented \(lands Phase 1, hhs-ocr first\)/
  );
  await assert.rejects(
    () => cron.scheduled({ cron: '0 * * * *' }, {}, {}),
    /settlement-deadline KV refresh not implemented \(lands Phase 4\)/
  );
});

test('ingest-cron: an unrecognized cron pattern is refused by name', async () => {
  const cron = await loadWorker('ingest-cron');
  // The name is in the message on purpose: a typo in [triggers].crons has to be
  // diagnosable from the failure alone.
  await assert.rejects(
    () => cron.scheduled({ cron: '*/5 * * * *' }, {}, {}),
    (err) => {
      assert.match(err.message, /unrecognized cron pattern/);
      // The offending pattern is echoed verbatim so a typo in
      // [triggers].crons is diagnosable from the failure alone.
      assert.ok(err.message.includes('*/5 * * * *'), 'the offending pattern is not named');
      return true;
    }
  );
});

test('ingest-cron: a malformed event fails closed rather than being ignored', async () => {
  const cron = await loadWorker('ingest-cron');
  // A missing or empty cron must still throw. `undefined` reaching the default
  // branch and being swallowed is exactly the silent no-op this worker exists
  // to prevent.
  for (const event of [{}, { cron: '' }, { cron: null }]) {
    await assert.rejects(
      () => cron.scheduled(event, {}, {}),
      /unrecognized cron pattern/,
      `event ${JSON.stringify(event)} resolved instead of throwing`
    );
  }
});

test('ingest-cron: the throw happens before any binding is touched', async () => {
  const cron = await loadWorker('ingest-cron');
  // env and ctx omitted entirely: failing loudly cannot depend on D1 or KV.
  await assert.rejects(() => cron.scheduled({ cron: '0 6 * * *' }), /not implemented/);
});
