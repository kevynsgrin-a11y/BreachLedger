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

// Round 1 found the Maine endpoint documented on /sources returns 404. These
// are the plausible current addresses. Probing them is cheaper and far more
// definitive than reasoning about how the site was reorganised, and a state
// government host at one request per second is well within polite use.
// Round 2 established the Maine AG site was reorganised: the old
// /ag/consumer/... paths now redirect into a new information architecture,
// and the landing page they arrive at carries no table. So the list is
// somewhere below it. Round 3 starts from that landing page and reports every
// link on it, which is how the actual breach listing gets found rather than
// guessed at for a third time.
const MAINE_CANDIDATES = [
  'https://www.maine.gov/ag/consumer-protection/consumer-help-topics/privacy-and-identity-theft',
  'https://www.maine.gov/ag/about-us/consumer-protection',
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
      .map((r) => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => textOf(c[1]).slice(0, 90)));
    // Where each row LEADS matters as much as what it says: the notification
    // letter and any per-breach detail page hang off a cell link, and a global
    // link list hides them among the site chrome.
    const rowLinks = rows
      .slice(0, 4)
      .map((r) => [...r[1].matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((a) => a[1]));
    out.push({
      classAttr: (/\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || null,
      id: (/\bid\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || null,
      headers,
      rowCount: rows.length,
      sample,
      rowLinks,
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
    return null;
  }
  console.log(`final_url : ${res.final_url}`);
  console.log(`redirected: ${res.redirected}`);
  console.log(`bytes     : ${res.body.length}`);

  const t = tables(res.body);
  console.log(`\n-- tables (${t.length}) --`);
  t.forEach((tb, i) => {
    console.log(`  [${i}] id=${tb.id} class=${tb.classAttr} rows=${tb.rowCount}`);
    console.log(`      headers: ${JSON.stringify(tb.headers)}`);
    tb.sample.forEach((row, j) => {
      console.log(`      row${j}: ${JSON.stringify(row)}`);
      const lk = (tb.rowLinks && tb.rowLinks[j]) || [];
      if (lk.length) console.log(`         links: ${JSON.stringify(lk)}`);
    });
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
  return res.body;
}

/** Follow the first row's link. CA's list omits data categories and affected
 *  counts entirely, so if it records them anywhere it is behind this link. */
async function probeFirstDetail(id, html, baseUrl) {
  const t = tables(html);
  const first = t.find((tb) => tb.rowLinks && tb.rowLinks.flat().length);
  if (!first) { console.log(`\n-- no row-level links to follow --`); return; }
  const href = first.rowLinks.flat()[0];
  let url;
  try { url = new URL(href, baseUrl).toString(); } catch { return; }
  console.log(`\n-- following the first row into ${url} --`);
  try {
    const res = await politeFetch(url, { raw: true });
    console.log(`  final=${res.final_url} bytes=${res.body.length}`);
    const dt = tables(res.body);
    console.log(`  tables: ${dt.length}`);
    dt.forEach((tb, i) => {
      console.log(`    [${i}] headers=${JSON.stringify(tb.headers)} rows=${tb.rowCount}`);
      tb.sample.forEach((r, j) => console.log(`        row${j}: ${JSON.stringify(r)}`));
    });
    const dl = [...res.body.matchAll(/<(dt|th|strong|b)\b[^>]*>([\s\S]{0,120}?)<\/\1>/gi)]
      .map((m) => textOf(m[2])).filter(Boolean).slice(0, 30);
    console.log(`  labelled fields: ${JSON.stringify(dl)}`);
    const pdfs = [...res.body.matchAll(/href\s*=\s*["']([^"']*\.pdf[^"']*)["']/gi)].map((m) => m[1]).slice(0, 6);
    console.log(`  pdf links: ${JSON.stringify(pdfs)}`);
    console.log(`  visible text (first 700): ${textOf(res.body).slice(0, 700)}`);
  } catch (err) {
    console.log(`  detail fetch failed: ${err.message.slice(0, 140)}`);
  }
}

async function probeMaineCandidates() {
  console.log(`\n${'='.repeat(74)}`);
  console.log('maine_ag — CANDIDATE REDISCOVERY (documented endpoint returned 404)');
  console.log('='.repeat(74));
  for (const url of MAINE_CANDIDATES) {
    try {
      const res = await politeFetch(url, { raw: true });
      const t = tables(res.body);
      const biggest = t.sort((a, b) => b.rowCount - a.rowCount)[0];
      console.log(
        `  OK ${url}\n     final=${res.final_url} bytes=${res.body.length} tables=${t.length} ` +
          `biggestRows=${biggest ? biggest.rowCount : 0}`
      );
      if (biggest && biggest.rowCount > 3) {
        console.log(`     headers: ${JSON.stringify(biggest.headers)}`);
        biggest.sample.forEach((r, j) => console.log(`     row${j}: ${JSON.stringify(r)}`));
        (biggest.rowLinks || []).forEach((lk, j) => lk.length && console.log(`     row${j} links: ${JSON.stringify(lk)}`));
      } else {
        // No table here, so this is a landing page rather than the listing.
        // Report where it leads: the listing is behind one of these.
        const l = links(res.body, res.final_url || url);
        const interesting = l.sample
          .concat(l.pdf, l.pagination)
          .filter((x) => /breach|notif|identity|security|data/i.test(`${x.href} ${x.text}`));
        const seen = new Set();
        console.log(`     ${l.total} links; those mentioning breach/notification/identity:`);
        for (const x of interesting) {
          if (seen.has(x.href)) continue;
          seen.add(x.href);
          console.log(`       ${x.href}  "${x.text}"`);
        }
      }
    } catch (err) {
      console.log(`  -- ${url}: ${err.message.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
}

async function main() {
  console.log('Read-only probe of the Phase 2 state AG sources. Nothing is written.\n');
  const only = process.argv[2];
  for (const s of SOURCES) {
    if (only && s.id !== only) continue;
    const body = await probe(s);
    if (body) await probeFirstDetail(s.id, body, s.url);
  }
  if (!only || only === 'maine_ag') await probeMaineCandidates();
}

main().catch((err) => {
  console.error(`probe FAILED: ${err.message}`);
  process.exit(1);
});
