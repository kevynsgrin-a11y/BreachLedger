#!/usr/bin/env node
// Utility Engine static build. Reads ue.config.js, the build-time D1 export in
// site/data/, and docs/, then writes the full static site to dist/ for
// Cloudflare Pages. Fails the build (exit 1) on guard violations rather than
// publishing a page that breaks the editorial constraints.

const fs = require('fs');
const path = require('path');

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
  const target = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
  return target;
}

// Build-blocking guards (spec sections 8-10).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
function guardPage(routePath, html) {
  const problems = [];
  if (!html.startsWith('<!doctype html>')) problems.push('missing doctype');
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push('missing <title>');
  if (EMOJI_RE.test(html)) problems.push('emoji found — emoji-as-iconography is banned (spec section 10)');
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
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Assets
  const assetOut = path.join(OUT, 'assets');
  fs.mkdirSync(assetOut, { recursive: true });
  for (const f of fs.readdirSync(ASSETS)) {
    fs.copyFileSync(path.join(ASSETS, f), path.join(assetOut, f));
  }

  // Build-time D1 export (empty in Phase 0)
  const breaches = readData('breaches');
  const sources = readData('sources');
  const litigation = readData('litigation');
  const sourcesByBreach = new Map();
  for (const s of sources) {
    if (!sourcesByBreach.has(s.breach_id)) sourcesByBreach.set(s.breach_id, []);
    sourcesByBreach.get(s.breach_id).push(s);
  }
  const published = publishableBreaches(breaches, sourcesByBreach);

  const ctx = {
    site: config.site,
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
  const notFound = require(path.join(TEMPLATES, '404.js')).render(ctx);
  guardPage('/404', notFound);
  fs.writeFileSync(path.join(OUT, '404.html'), notFound);

  console.log(`build complete: ${written.length + 1} pages, ${published.length} published breaches (phase ${config.buildPhase})`);
}

main();
