// Shared page shell. Institutional register: a records portal, not a product
// site. No emoji (build-enforced), tables over cards, citations as first-class
// page furniture.

const { escapeHtml } = require('./markdown');

// JSON-LD is the one script element this site emits, and it carries no
// executable code. '<' is serialized as \u003c so no string value — an entity
// name, a description — can close the element early and inject markup. The
// build guard (site/build.js) independently rejects any ld+json block whose
// payload still contains a raw '<', so an escaping regression fails the build
// rather than shipping.
function jsonLd(objects) {
  return (objects || [])
    .filter(Boolean)
    .map((obj) => `\n<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`)
    .join('');
}

function page({ site, title, description, content, route, assets = {}, structuredData = [] }) {
  const stylesheet = assets['styles.css'] || 'styles.css';
  const fullTitle = route === '/' ? `${site.name} — ${site.tagline}` : `${title} — ${site.name}`;
  const url = `${site.origin}${route === '/' ? '/' : route + '/'}`;
  const indexable = route !== '/404';
  const canonical = indexable ? `\n<link rel="canonical" href="${url}">` : '\n<meta name="robots" content="noindex">';
  // Link-preview metadata. No og:image is declared: an image tag pointing at a
  // file that does not exist renders worse than none at all.
  const social = indexable
    ? `
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${site.language.replace('-', '_')}">
<meta name="twitter:card" content="summary">`
    : '';
  // Structured data is suppressed on noindex pages: describing a page to a
  // crawler that has just been told not to index it is contradictory.
  const structured = indexable ? jsonLd(structuredData) : '';
  return `<!doctype html>
<html lang="${site.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">${canonical}${social}${structured}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/${stylesheet}">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <p class="masthead"><a href="/">${escapeHtml(site.name)}</a></p>
    <p class="site-tagline">${escapeHtml(site.tagline)}. Every entry cites a government or court source.</p>
    <nav class="site-nav">
      <a href="/">Record</a>
      <a href="/rights/">Rights by state</a>
      <a href="/severity/">Severity rubric</a>
      <a href="/sources/">Sources &amp; methodology</a>
      <a href="/corrections/">Corrections</a>
    </nav>
  </div>
</header>
<main class="wrap">
${content}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${escapeHtml(site.name)} is a public record compiled from government and court disclosures. It is not a law firm,
    not a settlement administrator, and does not process or advise on claims. Nothing on this site is legal advice.</p>
    <p><a href="/sources/">How this record is compiled</a> · <a href="/corrections/">Corrections policy</a></p>
  </div>
</footer>
</body>
</html>`;
}

module.exports = { page, jsonLd };
