// alerts worker — Phase 5. Constraints fixed now, before any code exists:
//   - double opt-in enforced before any send
//   - one-click unsubscribe link in every send
//   - subscriber table stores email + preferences ONLY; no profiling
// The alerts list is the hedge against event-dependent traffic; it is built on
// schedule (days 59-70), not last.

export default {
  async fetch() {
    return new Response(JSON.stringify({ error: 'alerts land in Phase 5' }), {
      status: 501,
      headers: { 'content-type': 'application/json' },
    });
  },
};
