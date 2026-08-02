// ingest-cron worker. Two schedules (spec section 1):
//   "0 6 * * *"  daily full ingest across all registered sources (Phase 1+)
//   "0 * * * *"  hourly settlement-deadline refresh into KV (Phase 4+)
// Phase 0 policy: not implemented. Fail loudly — a silent no-op cron would look
// like a healthy pipeline while ingesting nothing.

export default {
  async scheduled(event, env, ctx) {
    switch (event.cron) {
      case '0 6 * * *':
        throw new Error('ingest-cron: daily ingest not implemented (lands Phase 1, hhs-ocr first)');
      case '0 * * * *':
        throw new Error('ingest-cron: settlement-deadline KV refresh not implemented (lands Phase 4)');
      default:
        throw new Error(`ingest-cron: unrecognized cron pattern ${event.cron}`);
    }
  },
};
