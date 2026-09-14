const { page } = require('./layout');
const { escapeHtml } = require('./markdown');

function localHref(value) {
  if (typeof value !== 'string' || !/^\/(?!\/)/.test(value)) return null;
  let decoded = value;
  try {
    // Encoded backslashes or controls must not bypass the local-link check.
    do {
      if (!/^\/(?!\/)/.test(decoded) || /[\\\s\u0000-\u001f\u007f]/.test(decoded)) return null;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } while (true);
    if (new URL(value, 'https://local.invalid').origin !== 'https://local.invalid') return null;
    return value;
  } catch {
    return null;
  }
}

function suppliedCount(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function render(ctx) {
  const { site, title, description, groups = [] } = ctx;
  const route = localHref(ctx.route);
  if (!route || /[?#]/.test(route)) throw new TypeError('Browse page metadata requires a local route without a query or fragment');
  const origin = new URL(site.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== site.origin) {
    throw new TypeError('Browse page metadata requires an HTTP(S) site origin');
  }

  const sections = (Array.isArray(groups) ? groups : []).map((group, index) => {
    if (!group || typeof group.heading !== 'string' || !group.heading.trim()) return '';
    const links = (Array.isArray(group.links) ? group.links : []).map((link) => {
      if (!link || typeof link.label !== 'string' || !link.label.trim()) return '';
      const href = localHref(link.href);
      if (!href) return '';
      const count = suppliedCount(link.count);
      return `<li><a href="${escapeHtml(href)}"><span class="browse-link-content"><span class="browse-link-label">${escapeHtml(link.label)}</span>${
        count !== null ? `<span class="browse-count">${count.toLocaleString('en-US')}<span class="sr-only"> entries</span></span>` : ''
      }</span></a></li>`;
    }).filter(Boolean);
    if (!links.length) return '';
    const id = `browse-group-${index + 1}`;
    return `<section class="browse-group" aria-labelledby="${id}">
<h2 id="${id}">${escapeHtml(group.heading)}</h2>
${group.description ? `<p>${escapeHtml(String(group.description))}</p>` : ''}
<ul class="browse-links">${links.join('\n')}</ul>
</section>`;
  }).filter(Boolean);

  const content = `<div class="browse-index">
<h1>${escapeHtml(title)}</h1>
${description ? `<p>${escapeHtml(description)}</p>` : ''}
${sections.length ? `<div class="browse-groups">${sections.join('\n')}</div>` : '<div class="empty-state">No browse links are available yet.</div>'}
</div>`;

  return page({
    site: { ...site, language: escapeHtml(site.language) },
    assets: ctx.assets && { ...ctx.assets, 'styles.css': escapeHtml(ctx.assets['styles.css'] || 'styles.css') },
    title,
    description: description || '',
    route: escapeHtml(route === '/' ? route : route.replace(/\/+$/, '')),
    content,
  });
}

module.exports = { render };
