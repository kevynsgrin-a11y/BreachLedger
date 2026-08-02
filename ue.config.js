// Utility Engine site configuration for BreachLedger.
// The build (site/build.js) is static-first: it reads the build-time D1 export
// from site/data/, renders templates from site/templates/, and writes the full
// site to dist/ for Cloudflare Pages. Anything that must not trigger a rebuild
// (settlement countdowns, "added this week") is served from KV by workers/api.

module.exports = {
  site: {
    name: 'BreachLedger',
    tagline: 'A public record of disclosed U.S. data breaches',
    // Set SITE_ORIGIN at build time for production (e.g. https://breachledger.com);
    // the placeholder keeps canonical URLs obviously non-live until then.
    origin: process.env.SITE_ORIGIN || 'https://breachledger.example',
    language: 'en-US',
  },

  paths: {
    templates: 'site/templates',
    content: 'site/content',
    data: 'site/data', // build-time D1 export (JSON); absent files render as empty sets
    assets: 'site/assets',
    docs: 'docs',
    out: 'dist',
  },

  // Route registry. `phase` gates generation: routes above the current build
  // phase render nothing and are excluded from sitemaps. This keeps
  // "empty-but-valid" honest — no thin placeholder pages for content that
  // does not exist yet (see spec sections 7 and 8, thin-content guard).
  buildPhase: 0,
  routes: [
    { path: '/', template: 'home', phase: 0 },
    { path: '/severity', template: 'severity', phase: 0 },
    { path: '/sources', template: 'sources', phase: 0 },
    { path: '/corrections', template: 'corrections', phase: 0 },
    { path: '/breach/[slug]', template: 'breach-detail', phase: 1 },
    { path: '/breach/[slug]/what-to-do', template: 'remediation', phase: 3 },
    { path: '/company/[slug]', template: 'entity-hub', phase: 2 },
    { path: '/sector/[sector]', template: 'sector-hub', phase: 1 },
    { path: '/breaches/[year]', template: 'year-archive', phase: 1 },
    { path: '/settlements', template: 'settlement-index', phase: 4 },
    { path: '/settlements/[slug]', template: 'settlement-detail', phase: 4 },
    { path: '/settlements/deadlines', template: 'deadline-calendar', phase: 4 },
    { path: '/rights/[state]', template: 'state-rights', phase: 3 },
    { path: '/guides/[slug]', template: 'guide', phase: 3 },
  ],
};
