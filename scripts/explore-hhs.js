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
// Usage: node scripts/explore-hhs.js

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

async function main() {
  const jar = new CookieJar();

  const front = await politeFetch(FRONT_PAGE, { raw: true, jar });
  report('FRONT PAGE', front.body);

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
