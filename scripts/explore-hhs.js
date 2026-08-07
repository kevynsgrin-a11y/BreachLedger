#!/usr/bin/env node
// Discovery probe for the HHS OCR portal.
//
// The archived breach records are not reachable from the report grid: it has
// no archive command and links only to the portal home page. The remaining
// candidate is the "Show Advanced Options" panel, which is presumed to reveal
// a filter form. This script expands it and prints a COMPLETE inventory of the
// form controls that appear, so the archive's real selector can be identified
// from output rather than guessed at.
//
// It is read-only: it fetches and reports, and never writes to D1 or the site.
//
// Usage: node scripts/explore-hhs.js            (HIPAA report)
//        node scripts/explore-hhs.js --part2   (42 CFR Part 2 report)

const { politeFetch } = require('../packages/ingest/fetch-util');
const jsf = require('../packages/ingest/sources/hhs-jsf');
const { CookieJar, GRID_PAGE, FRONT_PAGE } = require('../packages/ingest/sources/hhs-ocr-fetch');

/** Every form control on a page: inputs, selects with their options, textareas. */
function inventoryControls(html) {
  const out = [];

  const inputRe = /<input\b[^>]*>/gi;
  let m;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    const attr = (n) => {
      const r = new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
      return r ? r[1] : null;
    };
    const type = (attr('type') || 'text').toLowerCase();
    if (type === 'hidden') continue; // reported separately
    out.push(`input[${type}] name=${attr('name')} id=${attr('id')} value=${JSON.stringify(attr('value'))}`);
  }

  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((m = selectRe.exec(html))) {
    const attrs = m[1];
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const opts = [...m[2].matchAll(/<option\b[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi)]
      .map((o) => `${o[1]}="${o[2].replace(/<[^>]*>/g, '').trim()}"`);
    out.push(`select name=${name ? name[1] : null} id=${id ? id[1] : null} options=[${opts.join(', ')}]`);
  }

  // PrimeFaces renders selects as styled divs with a hidden input plus a
  // <ul> of items, so plain <select> scanning can miss them entirely.
  const pfRe = /<div\b[^>]*class\s*=\s*["'][^"']*ui-selectonemenu[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/div>/gi;
  while ((m = pfRe.exec(html))) {
    const items = [...m[1].matchAll(/<li\b[^>]*data-label\s*=\s*["']([^"']*)["']/gi)].map((i) => i[1]);
    if (items.length) out.push(`primefaces-selectonemenu items=[${items.join(', ')}]`);
  }

  return out;
}

function report(label, html) {
  console.log(`\n=== ${label} (${html.length} bytes) ===`);
  const hidden = jsf.extractHiddenInputs(html);
  console.log(`hidden fields: ${Object.keys(hidden).join(', ') || '(none)'}`);
  console.log('JSF commands:');
  for (const c of jsf.listCommandCandidates(html)) {
    console.log(`  - ${c.commandId} label="${c.label}"${c.isCsv ? '  [CSV EXPORTER]' : ''}`);
  }
  console.log('linked .jsf pages:');
  for (const l of jsf.linkedPages(html)) console.log(`  - ${l}`);
  console.log('form controls:');
  const controls = inventoryControls(html);
  if (!controls.length) console.log('  (none)');
  for (const c of controls) console.log(`  - ${c}`);
  // Anything mentioning the concepts we are hunting for.
  const hits = [];
  const re = /[^<>]{0,90}(?:archive|archiv|under investigation|resolved|closed|date range|breach date|posted)[^<>]{0,90}/gi;
  let m;
  while ((m = re.exec(html)) && hits.length < 20) hits.push(m[0].replace(/\s+/g, ' ').trim());
  console.log(`text mentioning archive / investigation / date range (${hits.length}):`);
  for (const h of hits) console.log(`  - ${h}`);
}

// Candidate addresses for the Part 2 grid. The HIPAA grid is breach_report_hip.jsf
// and its filing wizard is wizard_breach_hip.jsf, so the portal clearly uses a
// suffix convention; these are the plausible Part 2 spellings. Probing them
// directly is cheaper and far more definitive than debugging JSF routing, and
// at one request per second it is well within polite use.
const PART2_CANDIDATES = [
  'breach_report_part2.jsf',
  'breach_report_p2.jsf',
  'breach_report_pt2.jsf',
  'breach_report_part_2.jsf',
  'breach_report_sud.jsf',
  'breach_report_42cfr.jsf',
  'part2_breach_report.jsf',
  'breach_report_part2_frontpage.jsf',
];

const BASE_DIR = 'https://ocrportal.hhs.gov/ocr/breach/';

async function probeCandidates(jar) {
  console.log('\n=== CANDIDATE URL PROBE ===');
  for (const name of PART2_CANDIDATES) {
    const url = BASE_DIR + name;
    try {
      const res = await politeFetch(url, { raw: true, jar });
      const commands = jsf.listCommandCandidates(res.body);
      const csv = jsf.findCsvExportCommand(res.body);
      const isGrid = Boolean(csv) || /reportResultTable/i.test(res.body);
      console.log(
        `  ${name}: OK ${res.body.length} bytes, final=${res.final_url}, ` +
          `commands=${commands.length}, csvExporter=${csv || 'none'}, looksLikeGrid=${isGrid}`
      );
      if (isGrid) report(`CANDIDATE GRID ${name}`, res.body);
    } catch (err) {
      console.log(`  ${name}: ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
}

async function main() {
  const target = (process.argv.includes('--part2') ? 'part2' : 'hipaa');
  const jar = new CookieJar();

  const front = await politeFetch(FRONT_PAGE, { raw: true, jar });
  report('FRONT PAGE', front.body);

  if (target === 'part2') {
    // The Part 2 report has no known URL; it is reached from the front page by
    // the command a human would click. Find it by label, never by a generated id.
    const label = /42 CFR Part 2 Breach Reports/i;
    const cmd = jsf.findCommandMatching(front.body, label);
    if (!cmd) {
      console.log('\nno "View 42 CFR Part 2 Breach Reports" command on the front page');
      console.log('commands present:');
      for (const c of jsf.listCommandCandidates(front.body)) console.log(`  - ${c.commandId} label="${c.label}"`);
      return;
    }
    await probeCandidates(jar);

    const hidden = jsf.extractHiddenInputs(front.body);
    const action = new URL(jsf.extractFormAction(front.body) || FRONT_PAGE, FRONT_PAGE).toString();
    console.log(`\nnavigating to the Part 2 report via ${cmd} ...`);
    for (const enc of jsf.commandEncodings(hidden, cmd)) {
      const res = await politeFetch(action, {
        raw: true, jar, method: 'POST', body: enc.body,
        headers: { 'Content-Type': enc.contentType },
      });
      if (jsf.looksLikeCsv(res.body)) { console.log(`  [${enc.name}] returned CSV, skipping`); continue; }
      // Report the final URL too: that is how we learn the Part 2 grid's address.
      console.log(`  [${enc.name}] final URL: ${res.final_url || '(not reported)'} redirected=${res.redirected}`);
      report(`PART 2 NAV RESULT [${enc.name}]`, res.body);
      console.log(`  [${enc.name}] done; continuing so every encoding reports its landing URL`);
    }
    return;
  }

  const grid = await politeFetch(GRID_PAGE, { raw: true, jar });
  report('REPORT GRID (default view)', grid.body);

  // Expand "Show Advanced Options" and inventory whatever it reveals.
  const hidden = jsf.extractHiddenInputs(grid.body);
  const advanced = jsf.findCommandMatching(grid.body, /advanced/i);
  if (!advanced) {
    console.log('\nno "Advanced Options" command found on the grid; nothing further to expand');
    return;
  }
  console.log(`\nexpanding advanced options via ${advanced} ...`);
  const action = new URL(jsf.extractFormAction(grid.body) || GRID_PAGE, GRID_PAGE).toString();

  for (const enc of jsf.commandEncodings(hidden, advanced)) {
    const res = await politeFetch(action, {
      raw: true,
      jar,
      method: 'POST',
      body: enc.body,
      headers: { 'Content-Type': enc.contentType },
    });
    if (jsf.looksLikeCsv(res.body)) {
      console.log(`  [${enc.name}] returned CSV, not a page — skipping`);
      continue;
    }
    report(`GRID WITH ADVANCED OPTIONS EXPANDED [${enc.name}]`, res.body);
    // One decoded response is enough; further encodings would just repeat it.
    if (res.body.length !== grid.body.length) break;
    console.log(`  [${enc.name}] response identical in size to the unexpanded grid; trying next encoding`);
  }
}

main().catch((err) => {
  console.error(`explore FAILED: ${err.message}`);
  process.exit(1);
});
