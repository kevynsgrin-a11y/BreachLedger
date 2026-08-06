// api worker: deadline freshness (KV-backed settlement countdowns, Phase 4)
// and subscription endpoints (Phase 5). Static pages never depend on this
// worker to render — it only augments them.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/api/health':
        return json({ ok: true, service: 'breachbook-api' });
      case '/api/deadlines':
        return json({ error: 'settlement deadline feed lands in Phase 4' }, 501);
      case '/api/subscribe':
        return json({ error: 'alert subscriptions land in Phase 5 (double opt-in required)' }, 501);
      default:
        return json({ error: 'not found' }, 404);
    }
  },
};
