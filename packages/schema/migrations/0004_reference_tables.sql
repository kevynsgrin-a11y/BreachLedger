-- Migration 0004: seeded reference tables (spec section 3).
CREATE TABLE data_classes (
  code             TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  permanence       TEXT NOT NULL,  -- permanent|semi_permanent|rotatable
  severity_weight  INTEGER NOT NULL,
  remediation_ids  TEXT NOT NULL   -- JSON array of remediation_modules.slug
);

CREATE TABLE remediation_modules (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  applies_to      TEXT NOT NULL,   -- JSON array of data_classes.code
  jurisdiction    TEXT DEFAULT 'US',
  priority        INTEGER NOT NULL,-- render order, 1 = do this first
  body_md         TEXT NOT NULL,
  source_url      TEXT NOT NULL,   -- authority for the instructions
  last_verified   TEXT NOT NULL
);

CREATE TABLE state_rights (
  state_code                  TEXT PRIMARY KEY,
  state_name                  TEXT NOT NULL,
  notification_deadline_days  INTEGER,
  ssn_triggers_notice         INTEGER,
  free_credit_freeze          INTEGER,
  mandated_monitoring_months  INTEGER,
  ag_report_threshold         INTEGER,
  statute_citation            TEXT NOT NULL,
  statute_url                 TEXT NOT NULL,
  last_verified               TEXT NOT NULL
);
