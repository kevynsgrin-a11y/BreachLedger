#!/usr/bin/env node
// Ingestion orchestrator. Pipeline stages (spec section 4):
//   fetch -> normalize -> entity resolve -> dedupe -> validate -> score -> write
//
// Phase 0 policy: ingestion is NOT implemented yet. This orchestrator exists so
// the pipeline shape, source registry, and loud-failure behavior are fixed from
// day one. Running it exits non-zero — it must never pretend to have ingested.

const SOURCES = [
  { id: 'hhs_ocr', module: './sources/hhs-ocr.js', phase: 1 },
  { id: 'maine_ag', module: './sources/maine-ag.js', phase: 2 },
  { id: 'ca_ag', module: './sources/ca-ag.js', phase: 2 },
  { id: 'wa_ag', module: './sources/wa-ag.js', phase: 2 },
  { id: 'tx_ag', module: './sources/tx-ag.js', phase: 3 },
  { id: 'sec_8k', module: './sources/sec-8k.js', phase: 3 },
  { id: 'courtlistener', module: './sources/courtlistener.js', phase: 4 },
];

function main() {
  console.error('ingest: not implemented (Phase 0 scaffold). Sources registered:');
  for (const s of SOURCES) console.error(`  ${s.id.padEnd(14)} ${s.module} (Phase ${s.phase})`);
  console.error('A source that 404s at run time must fail the run loudly, never skip silently.');
  process.exit(1);
}

main();

module.exports = { SOURCES };
