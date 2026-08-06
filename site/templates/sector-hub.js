const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { breachRows } = require('./breach-table');

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
  const { site, sector, breaches } = ctx;
  const label = SECTOR_LABEL[sector] || sector;

  const sorted = breaches
    .slice()
    .sort((a, b) => (b.notification_date || '').localeCompare(a.notification_date || ''));

  const total = sorted.reduce((n, b) => n + (Number(b.records_affected) || 0), 0);
  const withCounts = sorted.filter((b) => Number.isFinite(Number(b.records_affected)) && b.records_affected != null).length;

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; ${escapeHtml(label)}</nav>

<h1>${escapeHtml(label)} breaches</h1>
<p>${sorted.length} breach${sorted.length === 1 ? '' : 'es'} on the record in this sector.${
    withCounts
      ? ` The ${withCounts} record${withCounts === 1 ? '' : 's'} that disclose a count total ${total.toLocaleString('en-US')} individuals affected.`
      : ''
  }</p>

${breachRows(sorted)}

<p class="related"><a href="/">All sectors</a> &middot; <a href="/sources/">How this record is compiled</a></p>`;

  return page({
    site,
    assets: ctx.assets,
    route: `/sector/${sector}`,
    title: `${label} data breaches`,
    description: `Government records of disclosed ${label.toLowerCase()} data breaches: entities, dates, records affected, and severity scores, each traced to its source.`,
    content,
  });
}

module.exports = { render, SECTOR_LABEL };
