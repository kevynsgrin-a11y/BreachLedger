#!/usr/bin/env node
// Read-only discovery probe for the Phase 2 state Attorney General sources.
//
// Phase 1 taught the lesson this script exists to apply: the HHS archive was
// guessed at three times before a probe showed it was a PrimeFaces TabView, and
// the Part 2 column names were only safe to use because they were read off the
// page instead of inferred. So nothing here parses anything. It characterises
// each endpoint and prints what is actually there, and the parsers get written
// against that output.
//
// For each source it reports:
//   - what the server actually returned (status, final URL, redirect, type)
//   - what robots.txt says about the path we intend to fetch
//   - whether a machine-readable form exists (CSV / JSON / API), which would
//     make an HTML parser unnecessary
//   - the shape of any tables: headers, row count, and sample rows
//   - forms, because a search-driven listing needs a POST sequence like HHS did
//   - pagination, because a first page mistaken for the whole listing is
//     exactly the "slice published as the whole record" failure
//   - outbound links to notification letters (PDF and otherwise)
//
// Writes nothing: no D1, no deploy, no site.

const { politeFetch } = require('../packages/ingest/fetch-util');

const SOURCES = [
  { id: 'maine_ag', url: 'https://www.maine.gov/ag/consumer/identity_theft/' },
  { id: 'ca_ag', url: 'https://oag.ca.gov/privacy/databreach/list' },
  { id: 'wa_ag', url: 'https://www.atg.wa.gov/data-breach-notifications' },
];

// Paths worth trying for a machine-readable listing. A structured feed would
// remove the entire HTML-parsing risk surface, so it is worth eight requests to
// find out. Each is tried relative to the source's own origin.
const MACHINE_READABLE_CANDIDATES = {
  ca_ag: [
    '/privacy/databreach/list?download=csv',
    '/privacy/databreach/list.csv',
    '/privacy/databreach/list.json',
    '/api/databreach/list',
  ],
  wa_ag: [
    '/data-breach-notifications?format=json',
    '/data-breach-notifications.json',
    '/api/databreach',
    '/data-breach-notifications/export',
  ],
  maine_ag: [
    '/ag/consumer/identity_theft/index.json',
    '/ag/consumer/identity_theft/?format=csv',
  ],
};

function textOf(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every table, with its headers, row count, and a few sample rows. */
function tables(html) {
  const out = [];
  const tableRe = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const headers = [...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => textOf(h[1]));
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const sample = rows
      .slice(0, 4)
      .map((r) => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => textOf(c[1]).slice(0, 70)));
    out.push({
      classAttr: (/\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || null,
      id: (/\bid\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || null,
      headers,
      rowCount: rows.length,
      sample,
    });
  }
  return out;
}

function forms(html) {
  const out = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = formRe.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const attr = (n) => (new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs) || [])[1] || null;
    const inputs = [...body.matchAll(/<input\b([^>]*)>/gi)].map((i) => {
      const a = (n) => (new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(i[1]) || [])[1] || null;
      return `${a('type') || 'text'}:${a('name')}`;
    });
    const selects = [...body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)].map((s) => {
      const name = (/\bname\s*=\s*["']([^"']*)["']/i.exec(s[1]) || [])[1];
      const opts = [...s[2].matchAll(/<option\b[^>]*value\s*=\s*["']([^"']*)["']/gi)].map((o) => o[1]);
      return `select:${name}[${opts.slice(0, 12).join('|')}${opts.length > 12 ? ` …+${opts.length - 12}` : ''}]`;
    });
    out.push({ action: attr('action'), method: attr('method') || 'GET', inputs, selects });
  }
  return out;
}

/** Links, bucketed by what they look like they lead to. */
function links(html, baseUrl) {
  const all = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((a) => {
    let href = a[1];
    try { href = new URL(href, baseUrl).toString(); } catch { /* leave relative */ }
    return { href, text: textOf(a[2]).slice(0, 80) };
  });
  const pdf = all.filter((l) => /\.pdf(\?|$)/i.test(l.href));
  const pagination = all.filter((l) =>
    /[?&](page|p|start|offset)=/i.test(l.href) || /^(next|prev|previous|last|first|\d+|»|«)$/i.test(l.text.trim())
  );
  return { total: all.length, pdf, pagination, sample: all.slice(0, 25) };
}

/** Does robots.txt permit the path we intend to fetch? We claim it does. */
async function robotsFor(url) {
  const origin = new URL(url).origin;
  try {
    const res = await politeFetch(`${origin}/robots.txt`, { raw: true });
    const path = new URL(url).pathname;
    // Only the wildcard group matters to us; we send no other agent token.
    const lines = res.body.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
    let inStar = false;
    const rules = [];
    for (const line of lines) {
      const ua = /^user-agent:\s*(.*)$/i.exec(line);
      if (ua) { inStar = ua[1].trim() === '*'; continue; }
      const rule = /^(disallow|allow):\s*(.*)$/i.exec(line);
      if (rule && inStar) rules.push({ kind: rule[1].toLowerCase(), path: rule[2].trim() });
      const cd = /^crawl-delay:\s*(.*)$/i.exec(line);
      if (cd && inStar) rules.push({ kind: 'crawl-delay', path: cd[1].trim() });
    }
    const matching = rules.filter((r) => r.kind !== 'crawl-delay' && r.path && path.startsWith(r.path));
    const crawlDelay = rules.find((r) => r.kind === 'crawl-delay');
    return {
      ok: true,
      bytes: res.body.length,
      wildcardRules: rules.length,
      matchingRules: matching,
      crawlDelay: crawlDelay ? crawlDelay.path : null,
      // Longest match wins, per the de-facto standard.
      verdict: matching.length
        ? matching.sort((a, b) => b.path.length - a.path.length)[0].kind === 'allow' ? 'ALLOWED' : 'DISALLOWED'
        : 'ALLOWED (no matching rule)',
    };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 140) };
  }
}

async function probeMachineReadable(id, baseUrl) {
  const cands = MACHINE_READABLE_CANDIDATES[id] || [];
  if (!cands.length) return;
  console.log(`\n-- machine-readable candidates --`);
  for (const path of cands) {
    const url = new URL(path, baseUrl).toString();
    try {
      const res = await politeFetch(url, { raw: true });
      const head = res.body.slice(0, 120).replace(/\s+/g, ' ');
      const looksJson = /^\s*[[{]/.test(res.body);
      const looksCsv = /^[^\n<]{0,400},[^\n<]{0,400}\n/.test(res.body) && !/^\s*</.test(res.body);
      const looksHtml = /^\s*<(!doctype|html)/i.test(res.body);
      console.log(
        `  ${path}: OK ${res.body.length}b final=${res.final_url} ` +
          `json=${looksJson} csv=${looksCsv} html=${looksHtml}`
      );
      if (looksJson || looksCsv) console.log(`      HEAD: ${head}`);
    } catch (err) {
      console.log(`  ${path}: ${err.message.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
}

async function probe({ id, url }) {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`${id}  ${url}`);
  console.log('='.repeat(74));

  const robots = await robotsFor(url);
  console.log(`robots.txt: ${JSON.stringify(robots)}`);

  let res;
  try {
    res = await politeFetch(url, { raw: true });
  } catch (err) {
    console.log(`FETCH FAILED: ${err.message}`);
    return;
  }
  console.log(`final_url : ${res.final_url}`);
  console.log(`redirected: ${res.redirected}`);
  console.log(`bytes     : ${res.body.length}`);

  const t = tables(res.body);
  console.log(`\n-- tables (${t.length}) --`);
  t.forEach((tb, i) => {
    console.log(`  [${i}] id=${tb.id} class=${tb.classAttr} rows=${tb.rowCount}`);
    console.log(`      headers: ${JSON.stringify(tb.headers)}`);
    tb.sample.forEach((row, j) => console.log(`      row${j}: ${JSON.stringify(row)}`));
  });

  const f = forms(res.body);
  console.log(`\n-- forms (${f.length}) --`);
  f.forEach((fm, i) => {
    console.log(`  [${i}] ${fm.method} ${fm.action}`);
    console.log(`      inputs : ${JSON.stringify(fm.inputs.slice(0, 20))}`);
    fm.selects.forEach((s) => console.log(`      ${s}`));
  });

  const l = links(res.body, res.final_url || url);
  console.log(`\n-- links: ${l.total} total, ${l.pdf.length} pdf, ${l.pagination.length} pagination-ish --`);
  l.pdf.slice(0, 6).forEach((p) => console.log(`      pdf: ${p.href}  "${p.text}"`));
  l.pagination.slice(0, 10).forEach((p) => console.log(`      page: ${p.href}  "${p.text}"`));
  if (!t.length && !l.pdf.length) {
    console.log('  no tables and no PDFs — first 25 links, for orientation:');
    l.sample.forEach((s) => console.log(`      ${s.href}  "${s.text}"`));
  }

  // A total, if the page states one. Knowing it is the only way to prove a
  // parser captured the whole listing rather than page one of it.
  const counts = [];
  const re = /[^<>]{0,70}(?:\d[\d,]{1,8})\s*(?:results?|records?|entries|notifications?|breaches)[^<>]{0,50}/gi;
  let m;
  while ((m = re.exec(res.body)) && counts.length < 8) counts.push(textOf(m[0]));
  console.log(`\n-- stated totals (${counts.length}) --`);
  counts.forEach((c) => console.log(`      ${c}`));

  // Is the listing rendered server-side at all? If the rows arrive by fetch(),
  // an HTML parser sees an empty shell and would publish nothing while
  // reporting success.
  const scriptBytes = (res.body.match(/<script\b[\s\S]*?<\/script>/gi) || []).join('').length;
  console.log(
    `\n-- rendering: ${scriptBytes} bytes of inline script; ` +
      `visible text ${textOf(res.body).length} chars; ` +
      `client-rendered risk=${t.length === 0 && scriptBytes > 20000 ? 'HIGH' : 'low'}`
  );

  await probeMachineReadable(id, res.final_url || url);
}

async function main() {
  console.log('Read-only probe of the Phase 2 state AG sources. Nothing is written.\n');
  const only = process.argv[2];
  for (const s of SOURCES) {
    if (only && s.id !== only) continue;
    await probe(s);
  }
}

main().catch((err) => {
  console.error(`probe FAILED: ${err.message}`);
  process.exit(1);
});
