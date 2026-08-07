#!/usr/bin/env node
// Read-only schema probe for the HHS OCR 42 CFR Part 2 breach report.
//
// A dry run against the live portal established that the Part 2 export has a
// DIFFERENT schema from the HIPAA export: eight columns rather than nine, with
// "Covered Entity Type" absent, and two headers arriving as serialized JSF
// components ("javax.faces.component.UIPanel@...") rather than as text.
//
// The exporter cannot tell us what those two columns are called. Guessing
// their names would put fabricated column headings into sources.raw_payload,
// which is the archived provenance for every record. So this probe reads the
// names off the RENDERED GRID, where the header facets are real markup.
//
// It runs the same extraction against the HIPAA grid first, as a CONTROL: if
// the method reproduces the nine HIPAA column names we already have verified
// against 6,814 records, then its Part 2 output can be trusted. If the control
// fails, nothing else the probe prints should be believed.
//
// It also settles two other open questions:
//   - whether the Part 2 export is genuinely empty (the dry run returned 208
//     bytes, which is exactly the header row plus a newline), by dumping the
//     raw bytes rather than inferring from a length
//   - whether breach_report_part2.jsf redirects anywhere, by reporting
//     final_url and redirected
//
// Writes nothing: no D1, no deploy, no site.

const { politeFetch } = require('../packages/ingest/fetch-util');
const jsf = require('../packages/ingest/sources/hhs-jsf');
const { CookieJar, fetchAllViews, GRID_PAGE, PART2_GRID_PAGE } = require('../packages/ingest/sources/hhs-ocr-fetch');
const { ALL_COLUMNS } = require('../packages/ingest/sources/hhs-ocr');

/** Strip tags and decode the handful of entities the portal actually emits. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Column headings as RENDERED, in document order.
 *
 * PrimeFaces puts a plain column title in <span class="ui-column-title">. A
 * column with a header facet — which is exactly why those two columns serialize
 * badly in the CSV — puts arbitrary markup in the <th> instead. So we report
 * both: the span when there is one, and the full text of the <th> either way.
 */
function headerCells(html) {
  // The results grid is the first <thead> containing ui-column-title.
  const theadRe = /<thead\b[^>]*>([\s\S]*?)<\/thead>/gi;
  let thead = null;
  let m;
  while ((m = theadRe.exec(html))) {
    if (/ui-column-title|ui-state-default/i.test(m[1])) { thead = m[1]; break; }
  }
  if (!thead) return null;

  const cells = [];
  const thRe = /<th\b([^>]*)>([\s\S]*?)<\/th>/gi;
  while ((m = thRe.exec(thead))) {
    const attrs = m[1];
    const inner = m[2];
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const titleSpan = /<span\b[^>]*class\s*=\s*["'][^"']*ui-column-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(inner);
    cells.push({
      id: id ? id[1] : null,
      columnTitle: titleSpan ? textOf(titleSpan[1]) : null,
      fullText: textOf(inner),
      // Sorting/filtering controls carry their own text; keep the raw markup
      // available at a bounded length so a surprising cell can be inspected.
      rawExcerpt: inner.replace(/\s+/g, ' ').trim().slice(0, 240),
    });
  }
  return cells;
}

/** PrimeFaces "no rows" markup, and whatever the paginator claims. */
function emptinessSignals(html) {
  const out = {};
  const empty = /<tr\b[^>]*ui-datatable-empty-message[^>]*>([\s\S]*?)<\/tr>/i.exec(html);
  out.emptyMessage = empty ? textOf(empty[1]) : null;
  const paginator = /<span\b[^>]*class\s*=\s*["'][^"']*ui-paginator-current[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
  out.paginatorText = paginator ? textOf(paginator[1]) : null;
  // Data rows carry ui-widget-content and a data-ri (row index) attribute.
  out.dataRowCount = (html.match(/\bdata-ri\s*=\s*["']\d+["']/gi) || []).length;
  // The portal states a total near the grid on both reports.
  const hits = [];
  const re = /[^<>]{0,80}(?:records? found|no records|total of|showing)[^<>]{0,80}/gi;
  let m;
  while ((m = re.exec(html)) && hits.length < 8) hits.push(textOf(m[0]));
  out.countText = hits;
  return out;
}

function reportGrid(label, url, res) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${label}`);
  console.log(`${'='.repeat(72)}`);
  console.log(`requested : ${url}`);
  console.log(`final_url : ${res.final_url}`);
  console.log(`redirected: ${res.redirected}`);
  console.log(`bytes     : ${res.body.length}`);
  console.log(`csvCommand: ${jsf.findCsvExportCommand(res.body) || 'none'}`);

  // Does the page say what regime it covers? A positive identity check.
  const mentionsPart2 = /42\s*CFR\s*Part\s*2|Part 2 Cases|Part 2 Program/i.test(res.body);
  const mentionsHipaa = /HIPAA|Covered Entity/i.test(res.body);
  console.log(`mentions "42 CFR Part 2": ${mentionsPart2}`);
  console.log(`mentions "HIPAA"/"Covered Entity": ${mentionsHipaa}`);

  const cells = headerCells(res.body);
  console.log(`\n-- rendered column headings (${cells ? cells.length : 'NO THEAD FOUND'}) --`);
  if (cells) {
    cells.forEach((c, i) => {
      console.log(`  [${i}] columnTitle=${JSON.stringify(c.columnTitle)}`);
      console.log(`       fullText=${JSON.stringify(c.fullText)}`);
      console.log(`       id=${c.id}`);
      if (!c.columnTitle) console.log(`       raw=${c.rawExcerpt}`);
    });
  }

  const e = emptinessSignals(res.body);
  console.log(`\n-- emptiness signals --`);
  console.log(`  emptyMessage : ${JSON.stringify(e.emptyMessage)}`);
  console.log(`  paginatorText: ${JSON.stringify(e.paginatorText)}`);
  console.log(`  dataRowCount : ${e.dataRowCount}`);
  for (const t of e.countText) console.log(`  countText    : ${JSON.stringify(t)}`);
  return cells;
}

function controlPassed(cells) {
  if (!cells) return false;
  const titles = cells.map((c) => c.columnTitle || c.fullText);
  // The control passes only if every documented HIPAA column name is recovered,
  // in order. Anything less and the extraction method is not trustworthy.
  if (titles.length !== ALL_COLUMNS.length) return false;
  return ALL_COLUMNS.every((name, i) => titles[i] === name);
}

async function main() {
  console.log('Read-only probe. Nothing is written to D1 or the site.\n');

  // --- CONTROL: the HIPAA grid, whose column names we already know ---------
  const hipaaJar = new CookieJar();
  const hipaa = await politeFetch(GRID_PAGE, { raw: true, jar: hipaaJar });
  const hipaaCells = reportGrid('CONTROL — HIPAA grid (known schema)', GRID_PAGE, hipaa);

  const ok = controlPassed(hipaaCells);
  console.log(`\n-- CONTROL RESULT --`);
  console.log(`  expected: ${JSON.stringify(ALL_COLUMNS)}`);
  console.log(`  recovered: ${JSON.stringify(hipaaCells ? hipaaCells.map((c) => c.columnTitle || c.fullText) : null)}`);
  console.log(`  CONTROL ${ok ? 'PASSED — the extraction reproduces the verified HIPAA names' : 'FAILED — do NOT trust the Part 2 headings below'}`);

  // --- SUBJECT: the Part 2 grid -------------------------------------------
  const part2Jar = new CookieJar();
  const part2 = await politeFetch(PART2_GRID_PAGE, { raw: true, jar: part2Jar });
  reportGrid('SUBJECT — 42 CFR Part 2 grid', PART2_GRID_PAGE, part2);

  // --- The exports themselves, byte for byte ------------------------------
  console.log(`\n${'='.repeat(72)}`);
  console.log('PART 2 CSV EXPORTS, VERBATIM');
  console.log(`${'='.repeat(72)}`);
  let views;
  try {
    views = await fetchAllViews({ requireArchive: false, gridPage: PART2_GRID_PAGE });
  } catch (err) {
    console.log(`fetchAllViews failed: ${err.message}`);
    return;
  }
  for (const v of views) {
    console.log(`\n--- view: ${v.view} (${v.csv.length} bytes, sha256 ${v.checksum.slice(0, 16)}) ---`);
    // Escaped, so line endings and any trailing whitespace are visible rather
    // than inferred. These payloads are small enough to print whole.
    console.log(JSON.stringify(v.csv));
    const lines = v.csv.split(/\r?\n/);
    console.log(`lines (incl. header): ${lines.length}; non-empty: ${lines.filter((l) => l.trim()).length}`);
    console.log(`DATA ROWS: ${Math.max(0, lines.filter((l) => l.trim()).length - 1)}`);
  }

  if (views.length === 2) {
    const identicalAfterHeader = views[0].csv.split('\n').slice(1).join('\n') === views[1].csv.split('\n').slice(1).join('\n');
    console.log(`\nunder_investigation and archive have identical DATA (post-header): ${identicalAfterHeader}`);
    console.log(`raw bodies byte-identical: ${views[0].csv === views[1].csv}`);
  }
}

main().catch((err) => {
  console.error(`probe FAILED: ${err.message}`);
  process.exit(1);
});
