-- Migration 0002: sources (spec section 3).
-- Every breach row must have >=1 source row. A breach with zero sources must
-- never render — enforced at build time (site/build.js) and at validation
-- (packages/ingest/validate.js), since SQLite cannot express the constraint.
CREATE TABLE sources (
  id              TEXT PRIMARY KEY,
  breach_id       TEXT NOT NULL REFERENCES breaches(id),
  source_type     TEXT NOT NULL,   -- hhs_ocr|maine_ag|ca_ag|wa_ag|tx_ag|sec_8k|courtlistener
  source_url      TEXT NOT NULL,
  document_url    TEXT,            -- direct link to notification letter / filing
  r2_archive_key  TEXT,
  retrieved_at    TEXT NOT NULL,
  checksum        TEXT NOT NULL,   -- sha256 of raw payload, for change detection
  raw_payload     TEXT             -- JSON, for reprocessing without re-fetch
);
CREATE INDEX idx_sources_breach ON sources(breach_id);
