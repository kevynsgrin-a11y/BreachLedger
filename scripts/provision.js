#!/usr/bin/env node
// One-shot Cloudflare provisioning for BreachBook (breachbook.org).
// Infrastructure identifiers stay `breachledger` from the original build —
// renaming them would require re-provisioning and break the live deployment.
//
// Prerequisites: CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID for
// token-based auth) in the environment, or an interactive `wrangler login`.
//
// What it does, idempotently:
//   1. creates the D1 database `breachledger` (or finds the existing one)
//   2. creates the KV namespace `HOT` (or finds the existing one)
//   3. patches the real ids into wrangler.toml and every workers/*/wrangler.toml
//   4. applies migrations to the remote D1 and loads the seed tables
//   5. creates the Pages project `breachledger`
// After it succeeds: `npm run deploy` publishes the site.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], ...opts });

// Wrangler may print a banner ahead of JSON output; parse from the first
// bracket so the scripts survive both clean and decorated stdout.
const parseJson = (out) => {
  const start = Math.min(...['[', '{'].map((c) => (out.indexOf(c) === -1 ? Infinity : out.indexOf(c))));
  if (!Number.isFinite(start)) throw new Error(`expected JSON in wrangler output, got:\n${out}`);
  return JSON.parse(out.slice(start));
};

function ensureAuth() {
  try {
    run('npx wrangler whoami');
  } catch (e) {
    console.error('wrangler is not authenticated. Set CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) or run `wrangler login`.');
    process.exit(1);
  }
}

function d1Id() {
  const list = parseJson(run('npx wrangler d1 list --json'));
  let db = list.find((d) => d.name === 'breachledger');
  if (!db) {
    console.log('creating D1 database `breachledger`...');
    run('npx wrangler d1 create breachledger');
    db = parseJson(run('npx wrangler d1 list --json')).find((d) => d.name === 'breachledger');
  }
  if (!db) throw new Error('could not create or find D1 database `breachledger`');
  return db.uuid || db.id;
}

function kvId() {
  const list = parseJson(run('npx wrangler kv namespace list'));
  // Titles are worker-prefixed by wrangler; match on the binding suffix.
  let ns = list.find((n) => /HOT$/.test(n.title));
  if (!ns) {
    console.log('creating KV namespace `HOT`...');
    run('npx wrangler kv namespace create HOT');
    ns = parseJson(run('npx wrangler kv namespace list')).find((n) => /HOT$/.test(n.title));
  }
  if (!ns) throw new Error('could not create or find KV namespace `HOT`');
  return ns.id;
}

function patchConfigs(databaseId, kvNamespaceId) {
  const configs = [
    'wrangler.toml',
    'workers/ingest-cron/wrangler.toml',
    'workers/api/wrangler.toml',
    'workers/alerts/wrangler.toml',
  ];
  for (const rel of configs) {
    const p = path.join(ROOT, rel);
    let text = fs.readFileSync(p, 'utf8');
    text = text.replace(/database_id = "[0-9a-f-]+"/g, `database_id = "${databaseId}"`);
    text = text.replace(/^id = "[0-9a-f]+"$/gm, `id = "${kvNamespaceId}"`);
    fs.writeFileSync(p, text);
    console.log(`patched ${rel}`);
  }
}

function migrateAndSeed() {
  console.log('applying migrations to remote D1...');
  run('npx wrangler d1 migrations apply breachledger --remote', { stdio: 'inherit' });
  console.log('seeding remote D1...');
  run('node packages/schema/seed/load.js --out .wrangler/tmp-seed.sql');
  run('npx wrangler d1 execute breachledger --remote --file .wrangler/tmp-seed.sql', { stdio: 'inherit' });
}

// Must match the --branch value used by `npm run deploy` (PAGES_BRANCH, default
// `main`). A deployment whose branch differs from the project's production
// branch is published as a PREVIEW: it succeeds, prints a *.pages.dev URL, and
// the custom domain keeps serving the old production build. Silent and costly.
const PRODUCTION_BRANCH = process.env.PAGES_BRANCH || 'main';

function pagesProject() {
  try {
    run(`npx wrangler pages project create breachledger --production-branch ${PRODUCTION_BRANCH}`);
    console.log(`Pages project \`breachledger\` created (production branch: ${PRODUCTION_BRANCH}).`);
  } catch (e) {
    const msg = String(e.stderr || e.message || '');
    if (/already exists/i.test(msg)) {
      console.log('Pages project `breachledger` already exists — leaving its settings alone.');
      console.log(`  Confirm its Production branch is "${PRODUCTION_BRANCH}", or set PAGES_BRANCH to match it before deploying.`);
    } else throw e;
  }
}

ensureAuth();
const databaseId = d1Id();
console.log(`D1 database id: ${databaseId}`);
const kvNamespaceId = kvId();
console.log(`KV namespace id: ${kvNamespaceId}`);
patchConfigs(databaseId, kvNamespaceId);
migrateAndSeed();
pagesProject();
console.log(`
Provisioning complete. Next:
  1. npm run deploy   (builds with origin https://breachbook.org by default,
     publishes to branch "${PRODUCTION_BRANCH}" — must equal the project's
     Production branch or the upload becomes a preview, not production)
  2. Attach the custom domain breachbook.org to the Pages project in the
     Cloudflare dashboard (Pages > breachledger > Custom domains).
  3. Commit the patched wrangler.toml ids.
Workers (ingest-cron, api, alerts) deploy in Phase 1+ — do not deploy a cron
that has nothing to ingest yet.`);
