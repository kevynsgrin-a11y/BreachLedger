-- Migration 0003: litigation and settlements (spec section 3).
CREATE TABLE litigation (
  id                     TEXT PRIMARY KEY,
  breach_id              TEXT REFERENCES breaches(id),
  case_name              TEXT NOT NULL,
  docket_number          TEXT,
  court                  TEXT,
  courtlistener_id       TEXT,
  filed_date             TEXT,
  status                 TEXT,     -- filed|consolidated|proposed|preliminary_approval|final_approval|closed
  settlement_fund_usd    INTEGER,
  claim_deadline         TEXT,
  optout_deadline        TEXT,
  final_approval_hearing TEXT,
  administrator_name     TEXT,
  official_claim_url     TEXT,     -- MUST be the administrator's domain, never ours
  payout_structure       TEXT,     -- JSON
  proof_required         INTEGER,
  updated_at             TEXT NOT NULL
);
CREATE INDEX idx_litigation_deadline ON litigation(claim_deadline);
CREATE INDEX idx_litigation_breach ON litigation(breach_id);
