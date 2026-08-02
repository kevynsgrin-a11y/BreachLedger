// Dedupe stage (spec section 4). The same breach frequently appears in
// HHS + Maine + CA + WA. Match rule: normalized entity name AND overlapping
// date window (+/-45 days on notification_date). On match:
//   - merge into one canonical breach row
//   - union states_notified and data_classes arrays
//   - take MAX of records_affected
//   - append ALL source rows — never delete a source row during merge
//
// Implementation lands in Phase 2 alongside the state AG parsers; the merge
// contract is fixed here so parsers are written against it from the start.

const MATCH_WINDOW_DAYS = 45;

function dedupe() {
  throw new Error('dedupe: implementation lands in Phase 2');
}

module.exports = { dedupe, MATCH_WINDOW_DAYS };
