const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { breachRows, paginate, pager, pageCount, pagePath } = require('./breach-table');
const { breadcrumbList } = require('./structured-data');

const SECTOR_LABEL = {
  healthcare: 'Healthcare',
  financial: 'Financial services',
  retail: 'Retail',
  education: 'Education',
  government: 'Government',
  tech: 'Technology',
  other: 'Other sectors',
};

function render(ctx) {
  const { site, sector, breaches, page: pageNum = 1 } = ctx;
  const label = SECTOR_LABEL[sector] || sector;

  // Counts describe the whole sector, not the visible page: a reader on page 3
  // is still being told how large the record is.
  const sorted = breaches
    .slice()
    .sort((a, b) => (b.notification_date || '').localeCompare(a.notification_date || ''));

  const total = sorted.reduce((n, b) => n + (Number(b.records_affected) || 0), 0);
  const withCounts = sorted.filter((b) => Number.isFinite(Number(b.records_affected)) && b.records_affected != null).length;

  const basePath = `/sector/${sector}/`;
  const totalPages = pageCount(sorted.length);
  const current = Math.min(Math.max(1, Number(pageNum) || 1), totalPages);
  const visible = paginate(sorted, current);

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; ${escapeHtml(label)}</nav>

<h1>${escapeHtml(label)} breaches</h1>
<p>${sorted.length} breach${sorted.length === 1 ? '' : 'es'} on the record in this sector.${
    withCounts
      ? ` The ${withCounts} record${withCounts === 1 ? '' : 's'} that disclose a count total ${total.toLocaleString('en-US')} individuals affected.`
      : ''
  }${totalPages > 1 ? ` Listed newest first, ${escapeHtml(String(visible.length))} per page.` : ''}</p>

${breachRows(visible)}
${pager(basePath, current, totalPages)}

<p class="related"><a href="/">All sectors</a> &middot; <a href="/sources/">How this record is compiled</a></p>`;

  const pageSuffix = current > 1 ? ` — page ${current}` : '';
  return page({
    site,
    assets: ctx.assets,
    structuredData: [
      breadcrumbList(site.origin, [
        { name: 'Record', path: '/' },
        current > 1 ? { name: label, path: basePath } : null,
        current > 1 ? { name: `Page ${current}` } : { name: label },
      ].filter(Boolean)),
    ],
    // Each shard is its own canonical URL; page 1 keeps the bare sector path.
    route: pagePath(basePath, current).replace(/\/$/, '') || '/',
    title: `${label} data breaches${pageSuffix}`,
    description: `Government records of disclosed ${label.toLowerCase()} data breaches: entities, dates, records affected, and severity scores, each traced to its source.${
      current > 1 ? ` Page ${current} of ${totalPages}.` : ''
    }`,
    content,
  });
}

module.exports = { render, SECTOR_LABEL };
