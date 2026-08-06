#!/usr/bin/env node
// Ingestion orchestrator. Pipeline stages (spec section 4):
//   fetch -> normalize -> entity resolve -> dedupe -> validate -> score -> write
//
// Usage:
//   node packages/ingest/run.js --source hhs_ocr [--remote] [--dry-run]
//   node packages/ingest/run.js --source hhs_ocr --from-file export.csv
//
// --from-file exists so the pipeline can be exercised against a saved export
// without touching the government portal. --dry-run does everything except
// write to D1.
//
// Failure policy (spec sections 4 and 11): any source that cannot be retrieved
// or parsed FAILS THE RUN. A partial ingest that silently drops a source would
// publish an incomplete record set as though it were the complete government
// record, which is the worst outcome this project can produce.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const hhs = require('./sources/hhs-ocr');
const { fetchAllViews } = require('./sources/hhs-ocr-fetch');
const { validate, logReject } = require('./validate');
const { assignSlugs } = require('./slug');
const { buildStatements, batch } = require('./d1-writer');
const { score } = require('../severity/score');

const ROOT = path.join(__dirname, '..', '..');
const DB = 'breachledger';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['inherit', 'pipe', 'inherit'],
  });
}

function d1Query(sql, remote) {
  const out = wrangler(['d1', 'execute', DB, remote ? '--remote' : '--local', '--json', '--command', sql]);
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`unexpected wrangler output: ${out.slice(0, 400)}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results || [];
}

function d1File(sql, remote) {
  const tmp = path.join(ROOT, '.wrangler', `ingest-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, sql);
  try {
    wrangler(['d1', 'execute', DB, remote ? '--remote' : '--local', '--file', tmp]);
  } finally {
    fs.unlinkSync(tmp);
  }
}

async function main() {
  const sourceId = arg('source', 'hhs_ocr');
  const remote = Boolean(arg('remote', false));
  const dryRun = Boolean(arg('dry-run', false));
  const fromFile = arg('from-file', null);

  if (sourceId !== 'hhs_ocr') {
    throw new Error(`ingest: source '${sourceId}' is not implemented yet (Phase 1 covers hhs_ocr only)`);
  }

  // --- fetch -------------------------------------------------------------
  // Both portal views are required. "Under Investigation" holds only the last
  // ~24 months; the rest of the history is in "Archive". Publishing one view
  // alone would present a slice as the complete government record.
  let views;

  if (fromFile) {
    const text = fs.readFileSync(fromFile, 'utf8');
    views = [{
      view: 'file',
      csv: text,
      retrieved_at: new Date().toISOString(),
      checksum: require('crypto').createHash('sha256').update(text).digest('hex'),
    }];
    console.error(`ingest: reading ${fromFile} (${text.length} bytes) instead of fetching`);
  } else {
    console.error('ingest: driving the HHS OCR portal export sequence (both views)...');
    views = await fetchAllViews();
    for (const v of views) {
      console.error(
        `ingest: view ${v.view}: ${v.steps.bytes || v.csv.length} bytes via ${v.steps.path} path, ` +
          `${v.steps.encoding} encoding, command ${v.steps.csvCommand}`
      );
    }
  }

  // --- parse + normalize + entity resolve + dedupe -----------------------
  const unknownVectorTokens = new Set();
  const byId = new Map();
  let totalRows = 0;

  for (const v of views) {
    const { headers, rows } = hhs.parse(v.csv);
    totalRows += rows.length;
    console.error(`ingest: view ${v.view}: parsed ${rows.length} rows, ${headers.length} columns`);
    if (!rows.length) {
      throw new Error(`ingest: view ${v.view} contained zero data rows — refusing to proceed`);
    }

    for (const row of rows) {
      const { record, source } = hhs.normalizeRow(row, {
        retrievedAt: v.retrieved_at,
        checksum: v.checksum,
        sourceUrl: hhs.PORTAL_URL,
        unknownVectorTokens,
      });
      // Dedupe within and across views: an identical id means the same entity
      // reported on the same date. A record can legitimately appear in both
      // views around the 24-month boundary.
      const existing = byId.get(record.id);
      if (existing) {
        existing.records_affected = Math.max(existing.records_affected || 0, record.records_affected || 0) || null;
        // Prefer whichever view supplied OCR's narrative; the archive has it.
        if (!existing._hhs.web_description && record._hhs.web_description) {
          existing._hhs.web_description = record._hhs.web_description;
        }
        // One source row per (breach, source_type, url) — the writer dedupes,
        // but avoid queuing an obvious duplicate here.
        continue;
      }
      record.sources = [source];
      byId.set(record.id, record);
    }
  }
  console.error(`ingest: ${totalRows} rows across ${views.length} view(s) -> ${byId.size} distinct records`);
  if (unknownVectorTokens.size) {
    console.error(
      `ingest: WARNING unrecognized "Type of Breach" values (vocabulary drift): ${[...unknownVectorTokens].join(' | ')}`
    );
  }

  // --- validate ----------------------------------------------------------
  const candidates = [...byId.values()];
  const valid = [];
  let rejected = 0;
  for (const rec of candidates) {
    const checkable = { ...rec, data_classes: JSON.parse(rec.data_classes) };
    const result = validate(checkable);
    if (result.ok) valid.push(rec);
    else {
      rejected++;
      logReject(checkable, result.reasons);
    }
  }
  console.error(`ingest: ${valid.length} valid, ${rejected} rejected (see docs/ingest-rejects.log)`);

  // --- score -------------------------------------------------------------
  for (const rec of valid) {
    const s = score({
      data_classes: JSON.parse(rec.data_classes),
      records_affected: rec.records_affected,
      remediation_offered: rec.remediation_offered ? JSON.parse(rec.remediation_offered) : null,
      discovery_date: rec.discovery_date,
      notification_date: rec.notification_date,
    });
    rec.severity_score = s.score;
    rec.severity_rubric_version = s.rubric_version;
  }

  // --- slugs -------------------------------------------------------------
  assignSlugs(valid, { stableKey: (r) => r.id });

  // --- write -------------------------------------------------------------
  const existingRows = dryRun && !fromFile ? [] : d1Query('SELECT * FROM breaches', remote);
  const existingBreaches = new Map(existingRows.map((r) => [r.id, r]));
  const existingSources = new Set(
    d1Query('SELECT breach_id, source_type, source_url FROM sources', remote).map(
      (s) => `${s.breach_id}|${s.source_type}|${s.source_url}`
    )
  );

  const now = new Date().toISOString();
  for (const rec of valid) {
    for (const src of rec.sources) {
      src.id = require('crypto')
        .createHash('sha256')
        .update(`${rec.id}|${src.source_type}|${src.source_url}`)
        .digest('hex')
        .slice(0, 32);
    }
    delete rec._hhs; // provenance is preserved in sources.raw_payload
  }

  const { statements, stats } = buildStatements(valid, existingBreaches, existingSources, now);
  console.error(
    `ingest: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.sourcesAdded} source rows added`
  );

  if (dryRun) {
    console.error('ingest: --dry-run, no writes performed');
    return;
  }
  if (!statements.length) {
    console.error('ingest: nothing to write; database already matches the source');
    return;
  }

  const files = batch(statements, 400);
  files.forEach((sql, i) => {
    console.error(`ingest: applying batch ${i + 1}/${files.length}`);
    d1File(sql, remote);
  });
  console.error('ingest: complete');
}

main().catch((err) => {
  console.error(`ingest FAILED: ${err.message}`);
  process.exit(1);
});
