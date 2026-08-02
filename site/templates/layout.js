// Shared page shell. Institutional register: a records portal, not a product
// site. No emoji (build-enforced), tables over cards, citations as first-class
// page furniture.

const { escapeHtml } = require('./markdown');

function page({ site, title, description, content, route }) {
  const fullTitle = route === '/' ? `${site.name} — ${site.tagline}` : `${title} — ${site.name}`;
  const canonical = route === '/404' ? '' : `\n<link rel="canonical" href="${site.origin}${route === '/' ? '/' : route + '/'}">`;
  return `<!doctype html>
<html lang="${site.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">${canonical}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <p class="masthead"><a href="/">${escapeHtml(site.name)}</a></p>
    <p class="site-tagline">${escapeHtml(site.tagline)}. Every entry cites a government or court source.</p>
    <nav class="site-nav">
      <a href="/">Record</a>
      <a href="/severity">Severity rubric</a>
      <a href="/sources">Sources &amp; methodology</a>
      <a href="/corrections">Corrections</a>
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
    <p><a href="/sources">How this record is compiled</a> · <a href="/corrections">Corrections policy</a></p>
  </div>
</footer>
</body>
</html>`;
}

module.exports = { page };
