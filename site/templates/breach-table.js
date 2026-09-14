// Shared listing table for every index view (home, sector hubs, year archives).
// Tables over cards: density signals rigor on a records site.
//
// Index views are paginated. At production scale a single sector holds the
// entire corpus (every HHS-sourced record is sector=healthcare), so an
// unpaginated hub renders one table of every breach on the record and grows
// with each daily ingest. Pagination is static: page 2 is a real file at
// /sector/<s>/2/, not a client-side slice, because this site ships no
// JavaScript and a crawler must be able to reach every row by following links.

const { escapeHtml } = require('./markdown');

// 200 rows keeps a hub page in the low hundreds of KB while keeping the number
// of shards per sector manageable for a crawler.
const PAGE_SIZE = 200;

function pageCount(total, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size));
}

function paginate(items, page, size = PAGE_SIZE) {
  const p = Math.max(1, Number(page) || 1);
  return items.slice((p - 1) * size, p * size);
}

// `basePath` is the page-1 path and must end in '/' (e.g. '/sector/healthcare/').
// Page 1 keeps the bare path so the canonical URL of a hub never changes.
function pagePath(basePath, n) {
  return n <= 1 ? basePath : `${basePath}${n}/`;
}

function pager(basePath, page, totalPages) {
  if (totalPages <= 1) return '';
  const parts = [];
  if (page > 1) {
    parts.push(`<a href="${escapeHtml(pagePath(basePath, page - 1))}" rel="prev">Newer</a>`);
  }
  parts.push(`<span class="pager-position">Page ${page} of ${totalPages}</span>`);
  if (page < totalPages) {
    parts.push(`<a href="${escapeHtml(pagePath(basePath, page + 1))}" rel="next">Older</a>`);
  }
  // First/last links keep every shard within two hops of any other, so a
  // crawler never has to walk 40 pages in sequence to reach the end.
  const jumps = [];
  if (page > 2) jumps.push(`<a href="${escapeHtml(pagePath(basePath, 1))}">First</a>`);
  if (page < totalPages - 1) jumps.push(`<a href="${escapeHtml(pagePath(basePath, totalPages))}">Last</a>`);
  return `<nav class="pager" aria-label="Pagination">${parts.join(' ')}${
    jumps.length ? `<span class="pager-jump">${jumps.join(' ')}</span>` : ''
  }</nav>`;
}

const RECORD_SCALE_MIN = 500;
const RECORD_SCALE_MAX = 10000000;
const ALIGNMENT_TEXT = {
  largest: 'Largest disclosed count among rows shown; graphics aligned left.',
  newest: 'Latest notification among rows shown; graphics aligned right.',
  standard: 'Standard row; graphics centered.',
};

function disclosedNumber(value, maximum = Infinity) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null;
}

function notificationDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function listingValues(breaches) {
  let largest = null;
  let newest = null;
  const rows = breaches.map((breach) => {
    const records = disclosedNumber(breach.records_affected);
    const severity = disclosedNumber(breach.severity_score, 100);
    const day = notificationDay(breach.notification_date);
    if (records !== null && (largest === null || records > largest)) largest = records;
    if (day !== null && (newest === null || day > newest)) newest = day;
    return { breach, records, severity, day };
  });
  return rows.map((row) => ({
    ...row,
    alignment: row.records !== null && row.records === largest
      ? 'largest'
      : row.day !== null && row.day === newest ? 'newest' : 'standard',
  }));
}

function recordRuler(records) {
  if (records === null) return '';
  const bounded = Math.max(RECORD_SCALE_MIN, Math.min(RECORD_SCALE_MAX, records));
  const fraction = Math.log(bounded / RECORD_SCALE_MIN) / Math.log(RECORD_SCALE_MAX / RECORD_SCALE_MIN);
  const x = (4 + fraction * 112).toFixed(2);
  const rangeNote = records < RECORD_SCALE_MIN ? 'Below 500' : records > RECORD_SCALE_MAX ? 'Above 10 million' : '';
  return `<div class="listing-graphic-slot" aria-hidden="true"><div class="listing-graphic">
<svg class="listing-record-ruler" viewBox="0 0 120 18" focusable="false">
<line class="listing-ruler-track" x1="4" y1="12" x2="116" y2="12"/>
<line class="listing-ruler-track" x1="4" y1="8" x2="4" y2="16"/>
<line class="listing-ruler-track" x1="116" y1="8" x2="116" y2="16"/>
<line class="listing-ruler-marker" x1="${x}" y1="2" x2="${x}" y2="16"/>
</svg>
<div class="listing-scale-labels"><span>500</span><span>10m</span></div>
${rangeNote ? `<span class="listing-range-note">${rangeNote}</span>` : ''}
</div></div>`;
}

function severityBar(severity) {
  if (severity === null) return '';
  // Only the graphic is rounded: the exact disclosed score remains in the cell.
  return `<div class="listing-graphic-slot" aria-hidden="true"><div class="listing-graphic">
<span class="listing-score-track"><span class="listing-score-fill sev-${Math.round(severity)}"></span></span>
<div class="listing-scale-labels"><span>0</span><span>100</span></div>
</div></div>`;
}

// `caption` names the table for a screen reader. The visible heading above it
// already names it for everyone else, so the caption is rendered off-screen
// rather than duplicated on the page.
function breachRows(breaches, { showSector = true, caption, dateHeading = 'Reported', numericAlignment = 'right' } = {}) {
  if (!breaches.length) {
    return `<div class="empty-state">No breaches are on the record here yet.</div>`;
  }
  const cap = caption ? `<caption class="sr-only">${escapeHtml(caption)}</caption>` : '';
  const head = `<tr><th scope="col">Entity</th>${
    showSector ? '<th scope="col">Sector</th>' : ''
  }<th scope="col">${escapeHtml(dateHeading)}</th><th scope="col">Records affected</th><th scope="col">Severity</th></tr>`;
  const numberClass = numericAlignment === 'left' ? 'listing-number' : 'listing-number num';
  const body = listingValues(breaches)
    .map(({ breach: b, records, severity, alignment }) => {
      const recordText = records !== null
        ? records.toLocaleString('en-US', { maximumFractionDigits: 20 }) + (b.records_affected_is_est ? ' (est.)' : '')
        : '<span class="not-disclosed">not disclosed</span>';
      const severityText = severity !== null ? `${severity} / 100` : '<span class="sr-only">not disclosed</span>';
      return `<tr class="listing-row listing-row--${alignment}">
<td><a href="/breach/${escapeHtml(b.slug)}/">${escapeHtml(b.entity_name)}</a><span class="sr-only"> ${ALIGNMENT_TEXT[alignment]}</span></td>
${showSector ? `<td>${escapeHtml(b.sector || '')}</td>` : ''}
<td>${escapeHtml(b.notification_date || '')}</td>
<td class="${numberClass}"><span class="listing-value">${recordText}</span>${recordRuler(records)}</td>
<td class="${numberClass}"><span class="listing-value">${severityText}</span>${severityBar(severity)}</td>
</tr>`;
    })
    .join('\n');
  return `<p class="listing-legend">Records rulers use a logarithmic scale from 500 to 10 million; severity bars use 0–100.
Graphics align within the rows shown: largest disclosed count left, latest notification right, others centered.
Ties share alignment; largest takes precedence.</p>
<div class="table-scroll listing-scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption || 'Breach records')}"><table class="breach-listing">${cap}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

module.exports = { breachRows, paginate, pager, pageCount, pagePath, PAGE_SIZE };
