#!/usr/bin/env node
// Build-time D1 export. Dumps the canonical store to site/data/*.json, which
// site/build.js reads to generate the static site.
//
// The export comes from D1 rather than from the ingest run's in-memory state,
// so what the site publishes is exactly what the database holds — including
// records merged by earlier runs or from other sources.
//
// Usage: node scripts/export-data.js [--remote]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site', 'data');
const DB = 'breachledger';
const remote = process.argv.includes('--remote');

function query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, remote ? '--remote' : '--local', '--json', '--command', sql],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['inherit', 'pipe', 'inherit'] }
  );
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`unexpected wrangler output: ${out.slice(0, 400)}`);
  return JSON.parse(out.slice(start))[0]?.results || [];
}

// Paginate: a single D1 response has a size ceiling, and the breach table will
// pass 5,000 rows once the full archive is ingested.
function queryAll(table, orderBy, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = query(`SELECT * FROM ${table} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const breaches = queryAll('breaches', 'notification_date DESC, id');
  // raw_payload is provenance for reprocessing, not page content; excluding it
  // keeps the build input from ballooning by an order of magnitude.
  const sources = queryAll('sources', 'breach_id').map(({ raw_payload, ...rest }) => rest);
  const litigation = queryAll('litigation', 'id');

  fs.writeFileSync(path.join(OUT, 'breaches.json'), JSON.stringify(breaches));
  fs.writeFileSync(path.join(OUT, 'sources.json'), JSON.stringify(sources));
  fs.writeFileSync(path.join(OUT, 'litigation.json'), JSON.stringify(litigation));

  const orphans = breaches.filter((b) => !sources.some((s) => s.breach_id === b.id)).length;
  console.error(
    `export: ${breaches.length} breaches, ${sources.length} sources, ${litigation.length} litigation ` +
      `(${remote ? 'remote' : 'local'})${orphans ? ` — WARNING ${orphans} breaches have no source and will not render` : ''}`
  );
}

main();
