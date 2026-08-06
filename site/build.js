#!/usr/bin/env node
// Utility Engine static build. Reads ue.config.js, the build-time D1 export in
// site/data/, and docs/, then writes the full static site to dist/ for
// Cloudflare Pages. Fails the build (exit 1) on guard violations rather than
// publishing a page that breaks the editorial constraints.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'ue.config.js'));
const { renderMarkdown } = require('./templates/markdown');

const OUT = path.join(ROOT, config.paths.out);
const DATA = path.join(ROOT, config.paths.data);
const DOCS = path.join(ROOT, config.paths.docs);
const ASSETS = path.join(ROOT, config.paths.assets);
const TEMPLATES = path.join(ROOT, config.paths.templates);

function readData(name) {
  const p = path.join(DATA, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readDoc(name) {
  const p = path.join(DOCS, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function writePage(routePath, html) {
  // '/' -> dist/index.html, '/severity' -> dist/severity/index.html
  const rel = routePath === '/' ? 'index.html' : path.join(routePath.replace(/^\//, ''), 'index.html');
  const target = path.resolve(OUT, rel);
  // Containment: a slug-derived route must never escape dist/ (e.g. '../').
  if (!target.startsWith(path.resolve(OUT) + path.sep)) {
    throw new Error(`writePage: route '${routePath}' resolves outside the output directory`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
  return target;
}

// Build-blocking guards (spec sections 8-10).
// Emoji ranges: core emoji blocks, misc-symbols/dingbats, misc-technical
// (alarm clocks, hourglasses — countdown iconography), 2B00 block (stars,
// circles), doubled punctuation, and variation selector 16. Deliberately
// excludes text glyphs like section signs, arrows, daggers, (c)/(tm).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2934}\u{2935}\u{203C}\u{2049}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE0F}]/u;
function guardPage(routePath, html) {
  const problems = [];
  if (!html.startsWith('<!doctype html>')) problems.push('missing doctype');
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push('missing <title>');
  if (EMOJI_RE.test(html)) problems.push('emoji found — emoji-as-iconography is banned (spec section 10)');
  // This site ships zero JavaScript. A <script> tag in output means data
  // reached the page unescaped — fail the build rather than publish it.
  if (/<script/i.test(html)) problems.push('script tag in output — the site is zero-JS; this is unescaped data');
  if (problems.length) {
    throw new Error(`build guard failed for ${routePath}: ${problems.join('; ')}`);
  }
}

// Thin-content guard (spec section 8): minimum viable breach page is
// entity + date + >=1 data class + >=1 source. Below that, it stays draft.
// Zero-source records must never render (spec section 3).
function publishableBreaches(breaches, sourcesByBreach) {
  return breaches.filter((b) => {
    if (b.status !== 'published' && b.status !== 'corrected') return false;
    const sources = sourcesByBreach.get(b.id) || [];
    const dataClasses = JSON.parse(b.data_classes || '[]');
    return Boolean(b.entity_name && b.notification_date && dataClasses.length >= 1 && sources.length >= 1);
  });
}

function main() {
  // A placeholder origin would publish canonical and og:url tags pointing at a
  // domain that does not serve this site. Fail rather than ship that.
  const origin = config.site.origin;
  if (!/^https:\/\//.test(origin) || /\.example($|\/)|localhost|example\.com/.test(origin)) {
    throw new Error(`build guard failed: site.origin '${origin}' is not a real https origin (set SITE_ORIGIN)`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Assets (text assets pass the emoji guard too — a CSS `content:` emoji
  // would otherwise ship unchecked). The stylesheet is content-hashed so it
  // can be cached immutably yet still update the instant it changes.
  const assetOut = path.join(OUT, 'assets');
  fs.mkdirSync(assetOut, { recursive: true });
  const assetNames = {};
  for (const f of fs.readdirSync(ASSETS)) {
    const raw = fs.readFileSync(path.join(ASSETS, f));
    if (/\.(css|js|svg|txt)$/.test(f) && EMOJI_RE.test(raw.toString('utf8'))) {
      throw new Error(`build guard failed for asset ${f}: emoji found (spec section 10)`);
    }
    let outName = f;
    if (f.endsWith('.css')) {
      const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 10);
      outName = f.replace(/\.css$/, `.${hash}.css`);
    }
    assetNames[f] = outName;
    fs.writeFileSync(path.join(assetOut, outName), raw);
  }

  // Build-time D1 export (empty in Phase 0)
  const breaches = readData('breaches');
  const sources = readData('sources');
  const litigation = readData('litigation');

  // UPL guard (spec sections 3 and 9): official_claim_url must be the
  // settlement administrator's domain, never ours. Build-blocking.
  const ourHost = new URL(config.site.origin).host;
  for (const l of litigation) {
    if (l.official_claim_url && new URL(l.official_claim_url).host === ourHost) {
      throw new Error(`build guard failed: litigation ${l.id} official_claim_url is on our own domain`);
    }
  }
  const sourcesByBreach = new Map();
  for (const s of sources) {
    if (!sourcesByBreach.has(s.breach_id)) sourcesByBreach.set(s.breach_id, []);
    sourcesByBreach.get(s.breach_id).push(s);
  }
  const published = publishableBreaches(breaches, sourcesByBreach);

  const ctx = {
    site: config.site,
    assets: assetNames,
    breaches: published,
    litigation,
    rubric: require(path.join(ROOT, 'packages/severity/rubric.json')),
    dataClasses: require(path.join(ROOT, 'packages/schema/seed/data-classes.json')).classes,
    docs: {
      sources: readDoc('SOURCES.md'),
      corrections: readDoc('CORRECTIONS.md'),
    },
    renderMarkdown,
  };

  const activeRoutes = config.routes.filter((r) => r.phase <= config.buildPhase && !r.path.includes('['));
  const written = [];
  for (const route of activeRoutes) {
    const template = require(path.join(TEMPLATES, `${route.template}.js`));
    const html = template.render(ctx);
    guardPage(route.path, html);
    written.push(writePage(route.path, html));
  }

  // Pages platform files
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  // Security headers for Cloudflare Pages. The site ships zero JavaScript and
  // one same-origin stylesheet, so the CSP can be maximally strict. Revisit
  // style-src if a template ever needs an inline width (severity bars).
  fs.writeFileSync(
    path.join(OUT, '_headers'),
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  X-Frame-Options: DENY',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
      "  Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      '  Cross-Origin-Opener-Policy: same-origin',
      // 6 months, no preload: long enough to protect returning visitors,
      // short enough to back out of without a browser-list removal request.
      '  Strict-Transport-Security: max-age=15552000; includeSubDomains',
      '',
      // Content-hashed filenames, so a year of caching is safe and a restyle
      // still reaches returning visitors immediately under its new name.
      '/assets/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
    ].join('\n')
  );
  const notFound = require(path.join(TEMPLATES, '404.js')).render(ctx);
  guardPage('/404', notFound);
  fs.writeFileSync(path.join(OUT, '404.html'), notFound);

  console.log(`build complete: ${written.length + 1} pages, ${published.length} published breaches (phase ${config.buildPhase})`);
}

main();
