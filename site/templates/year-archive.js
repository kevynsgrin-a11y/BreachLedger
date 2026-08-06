const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { breachRows } = require('./breach-table');

function render(ctx) {
  const { site, year, breaches, years = [] } = ctx;

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

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; ${escapeHtml(year)}</nav>

<h1>Breaches reported in ${escapeHtml(year)}</h1>
<p>${sorted.length} breach${sorted.length === 1 ? '' : 'es'} entered the public record in ${escapeHtml(year)}.${
    withCounts
      ? ` The ${withCounts} record${withCounts === 1 ? '' : 's'} that disclose a count total ${total.toLocaleString('en-US')} individuals affected.`
      : ''
  } Dates reflect when the breach was reported to the government, which is not the same as when it occurred.</p>

${breachRows(sorted)}

${otherYears ? `<h2>Other years</h2><p class="related">${otherYears}</p>` : ''}`;

  return page({
    site,
    assets: ctx.assets,
    route: `/breaches/${year}`,
    title: `Data breaches reported in ${year}`,
    description: `Government records of U.S. data breaches reported in ${year}: entities, records affected, and severity scores, each traced to its source.`,
    content,
  });
}

module.exports = { render };
