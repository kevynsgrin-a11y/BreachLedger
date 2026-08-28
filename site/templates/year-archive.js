const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { breachRows, paginate, pager, pageCount, pagePath } = require('./breach-table');
const { breadcrumbList } = require('./structured-data');

function render(ctx) {
  const { site, year, breaches, years = [], page: pageNum = 1 } = ctx;

  const sorted = breaches
    .slice()
    .sort((a, b) => (b.notification_date || '').localeCompare(a.notification_date || ''));

  const total = sorted.reduce((n, b) => n + (Number(b.records_affected) || 0), 0);
  const withCounts = sorted.filter((b) => Number.isFinite(Number(b.records_affected)) && b.records_affected != null).length;

  const otherYears = years
    .filter((y) => y !== year)
    .sort((a, b) => b.localeCompare(a))
    .map((y) => `<a href="/breaches/${escapeHtml(y)}/">${escapeHtml(y)}</a>`)
    .join(' &middot; ');

  const basePath = `/breaches/${year}/`;
  const totalPages = pageCount(sorted.length);
  const current = Math.min(Math.max(1, Number(pageNum) || 1), totalPages);
  const visible = paginate(sorted, current);

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; ${escapeHtml(year)}</nav>

<h1>Breaches reported in ${escapeHtml(year)}</h1>
<p>${sorted.length} breach${sorted.length === 1 ? '' : 'es'} entered the public record in ${escapeHtml(year)}.${
    withCounts
      ? ` The ${withCounts} record${withCounts === 1 ? '' : 's'} that disclose a count total ${total.toLocaleString('en-US')} individuals affected.`
      : ''
  } Dates reflect when the breach was reported to the government, which is not the same as when it occurred.</p>

${breachRows(visible)}
${pager(basePath, current, totalPages)}

${otherYears ? `<h2>Other years</h2><p class="related">${otherYears}</p>` : ''}`;

  const pageSuffix = current > 1 ? ` — page ${current}` : '';
  return page({
    site,
    assets: ctx.assets,
    structuredData: [
      breadcrumbList(site.origin, [
        { name: 'Record', path: '/' },
        current > 1 ? { name: year, path: basePath } : null,
        current > 1 ? { name: `Page ${current}` } : { name: year },
      ].filter(Boolean)),
    ],
    route: pagePath(basePath, current).replace(/\/$/, '') || '/',
    title: `Data breaches reported in ${year}${pageSuffix}`,
    description: `Government records of U.S. data breaches reported in ${year}: entities, records affected, and severity scores, each traced to its source.${
      current > 1 ? ` Page ${current} of ${totalPages}.` : ''
    }`,
    content,
  });
}

module.exports = { render };
