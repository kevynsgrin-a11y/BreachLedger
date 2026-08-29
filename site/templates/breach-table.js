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

// `caption` names the table for a screen reader. The visible heading above it
// already names it for everyone else, so the caption is rendered off-screen
// rather than duplicated on the page.
function breachRows(breaches, { showSector = true, caption } = {}) {
  if (!breaches.length) {
    return `<div class="empty-state">No breaches are on the record here yet.</div>`;
  }
  const cap = caption ? `<caption class="sr-only">${escapeHtml(caption)}</caption>` : '';
  const head = `<tr><th scope="col">Entity</th>${
    showSector ? '<th scope="col">Sector</th>' : ''
  }<th scope="col">Reported</th><th scope="col">Records affected</th><th scope="col">Severity</th></tr>`;
  const body = breaches
    .map((b) => {
      const records =
        Number.isFinite(Number(b.records_affected)) && b.records_affected != null
          ? Number(b.records_affected).toLocaleString('en-US') + (b.records_affected_is_est ? ' (est.)' : '')
          : '<span class="not-disclosed">not disclosed</span>';
      const severity =
        Number.isFinite(Number(b.severity_score)) && b.severity_score != null
          ? `${Number(b.severity_score)} / 100`
          : '';
      return `<tr>
<td><a href="/breach/${escapeHtml(b.slug)}/">${escapeHtml(b.entity_name)}</a></td>
${showSector ? `<td>${escapeHtml(b.sector || '')}</td>` : ''}
<td>${escapeHtml(b.notification_date || '')}</td>
<td class="num">${records}</td>
<td class="num">${severity}</td>
</tr>`;
    })
    .join('\n');
  return `<div class="table-scroll"><table>${cap}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

module.exports = { breachRows, paginate, pager, pageCount, pagePath, PAGE_SIZE };
