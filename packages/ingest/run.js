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

const hhsOcr = require('./sources/hhs-ocr');
const hhsPart2 = require('./sources/hhs-part2');
const { fetchAllViews, GRID_PAGE, PART2_GRID_PAGE } = require('./sources/hhs-ocr-fetch');

// Registered sources. Both are OCR portal grids sharing one application and one
// export mechanism; they differ in address, legal regime, and attribution.
const SOURCES = {
  hhs_ocr: { module: hhsOcr, gridPage: GRID_PAGE, label: 'HIPAA' },
  hhs_part2: { module: hhsPart2, gridPage: PART2_GRID_PAGE, label: '42 CFR Part 2' },
};
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
  // Coverage policy. 'all' (default) requires the archive view and fails
  // otherwise; 'current' permits a documented partial ingest of the recent
  // view only. Partial is acceptable ONLY because /sources states the exact
  // coverage -- what is forbidden is presenting a slice AS the whole record.
  const coverage = arg('coverage', 'all');

  const selected = SOURCES[sourceId];
  if (!selected) {
    throw new Error(
      `ingest: source '${sourceId}' is not implemented. Available: ${Object.keys(SOURCES).join(', ')}`
    );
  }
  const hhs = selected.module;
  console.error(`ingest: source ${sourceId} (${selected.label}) from ${selected.gridPage}`);

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
    views = await fetchAllViews({
      requireArchive: coverage !== 'current',
      gridPage: selected.gridPage,
      label: sourceId,
    });
    if (coverage === 'current') console.error('ingest: coverage=current (recent view only, documented on /sources)');
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
    // A zero-row export is either a listing that is genuinely empty or a
    // retrieval that broke, and those must not be conflated. The portal itself
    // settles it: an empty datatable renders "No records found." So an empty
    // export is accepted ONLY when the grid we exported from said so, and is a
    // hard failure otherwise.
    //
    // This is not hypothetical. OCR's 42 CFR Part 2 listing carried no records
    // at all when it was first ingested -- a real state of the government
    // record, correctly published as an empty listing rather than as an error.
    if (!rows.length) {
      if (!v.gridReportsEmpty) {
        throw new Error(
          `ingest: view ${v.view} contained zero data rows and the grid did not report itself ` +
            'as empty — refusing to proceed on an unexplained empty export'
        );
      }
      console.error(`ingest: view ${v.view} is empty, and the portal grid confirms it holds no records`);
    }

    for (const row of rows) {
      const { record, source } = hhs.normalizeRow(row, {
        retrievedAt: v.retrieved_at,
        checksum: v.checksum,
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

  // --- current published state -------------------------------------------
  // Read BEFORE slugs are assigned, because a published slug is frozen and
  // this is where the frozen value comes from. Always read, including on a dry
  // run: a preview whose "would insert" count is computed against an empty
  // table reports every record as new and none as unchanged, which is exactly
  // the reassurance a preview must not give. This is a read; safe in every mode.
  const existingRows = d1Query('SELECT * FROM breaches', remote);
  const existingBreaches = new Map(existingRows.map((r) => [r.id, r]));
  const existingSources = new Set(
    d1Query('SELECT breach_id, source_type, source_url FROM sources', remote).map(
      (s) => `${s.breach_id}|${s.source_type}|${s.source_url}`
    )
  );

  // --- slugs -------------------------------------------------------------
  // A slug is a permanent public URL. Records already in the database keep
  // theirs verbatim; only new records mint one, and only from what is free.
  const existingSlugById = new Map([...existingBreaches].map(([id, row]) => [id, row.slug]));
  assignSlugs(valid, { stableKey: (r) => r.id, existingSlugById });

  // --- write -------------------------------------------------------------
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
    delete rec.slug_namespace; // consumed by assignSlugs; not a column
  }

  // A slug is a permanent public URL and the column is UNIQUE. assignSlugs can
  // only disambiguate within one process, and sources are ingested by separate
  // processes, so a slug already owned by a DIFFERENT record in D1 has to be
  // caught here. Left to SQLite it would surface mid-write, after earlier
  // batches had already been committed, leaving a half-ingested source behind.
  const slugOwner = new Map();
  for (const [id, row] of existingBreaches) if (row.slug) slugOwner.set(row.slug, id);
  const stolen = valid.filter((r) => slugOwner.has(r.slug) && slugOwner.get(r.slug) !== r.id);
  if (stolen.length) {
    throw new Error(
      `ingest: ${stolen.length} record(s) would take a URL already belonging to a different record. ` +
        'Refusing to write, because a slug is a permanent public URL.\n' +
        stolen
          .slice(0, 10)
          .map((r) => `  - /breach/${r.slug} wanted by ${r.id} (${r.entity_name}), held by ${slugOwner.get(r.slug)}`)
          .join('\n')
    );
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
