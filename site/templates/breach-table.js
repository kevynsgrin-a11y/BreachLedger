// Shared listing table for every index view (home, sector hubs, year archives).
// Tables over cards: density signals rigor on a records site.

const { escapeHtml } = require('./markdown');

function breachRows(breaches, { showSector = true } = {}) {
  if (!breaches.length) {
    return `<div class="empty-state">No breaches are on the record here yet.</div>`;
  }
  const head = `<tr><th>Entity</th>${showSector ? '<th>Sector</th>' : ''}<th>Reported</th><th>Records affected</th><th>Severity</th></tr>`;
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
  return `<div class="table-scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

module.exports = { breachRows };
