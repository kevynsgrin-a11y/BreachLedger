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
  // Link-preview metadata. One static site-wide image rather than a per-page
  // one: a shared card is a strict improvement over the bare text a link
  // previewed as before, and it cannot go stale against a record it does not
  // describe. Deliberately carries no breach-specific text, so a Part 2 record
  // shared as a link reveals nothing its metadata is required to withhold.
  const ogImage = `${site.origin}/assets/og-default.png`;
  const social = indexable
    ? `
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${site.language.replace('-', '_')}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(site.name)} — ${escapeHtml(site.tagline)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(fullTitle)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${ogImage}">`
    : '';
  // Structured data is suppressed on noindex pages: describing a page to a
  // crawler that has just been told not to index it is contradictory.
  const structured = indexable ? jsonLd(structuredData) : '';

  // Primary navigation with an active marker. A record with no JavaScript
  // cannot highlight the current section on the client, so the active item is
  // resolved here at build time and carries aria-current="page" for assistive
  // tech plus a class hook for the visible underline. The home link is only
  // active on the exact root; every other section matches its path prefix so a
  // breach detail page still lights up "Record".
  const navItems = [
    { href: '/', label: 'Record' },
    { href: '/rights/', label: 'Rights by state' },
    { href: '/severity/', label: 'Severity rubric' },
    { href: '/sources/', label: 'Sources &amp; methodology' },
    { href: '/corrections/', label: 'Corrections' },
    { href: '/about/', label: 'About' },
  ];
  const normalizedRoute = route === '/' ? '/' : `${route.replace(/\/$/, '')}/`;
  const isActive = (href) => {
    if (href === '/') {
      return normalizedRoute === '/' || normalizedRoute.startsWith('/breach/') ||
        normalizedRoute.startsWith('/breaches/') || normalizedRoute.startsWith('/sector/');
    }
    return normalizedRoute === href || normalizedRoute.startsWith(href);
  };
  const nav = navItems
    .map(({ href, label }) => {
      const active = isActive(href);
      return `<a href="${href}"${active ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`;
    })
    .join('\n      ');
  return `<!doctype html>
<html lang="${site.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">${canonical}${social}${structured}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
<link rel="manifest" href="/assets/manifest.json">
<meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1a1b1d" media="(prefers-color-scheme: dark)">
<link rel="stylesheet" href="/assets/${stylesheet}">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <p class="masthead"><a href="/">${escapeHtml(site.name)}</a></p>
    <p class="site-tagline">${escapeHtml(site.tagline)}. Every entry cites a government or court source.</p>
    <nav class="site-nav" aria-label="Primary">
      ${nav}
    </nav>
  </div>
</header>
<main class="wrap" id="main">
${content}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${escapeHtml(site.name)} is a public record compiled from government and court disclosures. It is not a law firm,
    not a settlement administrator, and does not process or advise on claims. Nothing on this site is legal advice.</p>
    <p><a href="/about/">About</a> · <a href="/sources/">How this record is compiled</a> ·
    <a href="/corrections/">Corrections policy</a> · <a href="/privacy/">Privacy</a></p>
    <p>This site sets no cookies, runs no analytics, and collects no data about its readers.</p>${
      site.publisher && site.publisher.name
        ? `
    <p class="publisher-line">Published by ${escapeHtml(site.publisher.name)}, ${escapeHtml(
            site.publisher.addressLocality
          )}, ${escapeHtml(site.publisher.addressRegion)}. Corrections: ${escapeHtml(site.publisher.email)}</p>`
        : ''
    }
  </div>
</footer>
</body>
</html>`;
}

module.exports = { page, jsonLd };
