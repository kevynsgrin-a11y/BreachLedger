-- Migration 0001: canonical breach table (spec section 3).
CREATE TABLE breaches (
  id                        TEXT PRIMARY KEY,        -- uuid
  slug                      TEXT UNIQUE NOT NULL,
  entity_name               TEXT NOT NULL,
  entity_name_normalized    TEXT NOT NULL,           -- lowercased, suffix-stripped
  entity_aliases            TEXT,                    -- JSON array
  sector                    TEXT,                    -- healthcare|financial|retail|education|government|tech|other
  breach_start_date         TEXT,                    -- ISO 8601
  breach_end_date           TEXT,
  discovery_date            TEXT,
  notification_date         TEXT,
  records_affected          INTEGER,
  records_affected_is_est   INTEGER DEFAULT 0,
  data_classes              TEXT NOT NULL,           -- JSON array of data_classes.code
  states_notified           TEXT,                    -- JSON array of 2-letter codes
  remediation_offered       TEXT,                    -- JSON: {type, provider, months, enrollment_deadline}
  breach_vector             TEXT,                    -- hacking|insider|loss|improper_disposal|unknown
  severity_score            INTEGER,
  severity_rubric_version   TEXT,
  status                    TEXT DEFAULT 'published',-- draft|published|corrected|retracted
  first_seen_at             TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX idx_breaches_notification ON breaches(notification_date DESC);
CREATE INDEX idx_breaches_entity ON breaches(entity_name_normalized);
CREATE INDEX idx_breaches_sector ON breaches(sector);
CREATE INDEX idx_breaches_severity ON breaches(severity_score DESC);
