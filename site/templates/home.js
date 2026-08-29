const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { dataset } = require('./structured-data');
const { SECTOR_LABEL } = require('./sector-hub');

function render(ctx) {
  const { site, breaches, litigation } = ctx;

  const recent = breaches
    .slice()
    .sort((a, b) => (b.notification_date || '').localeCompare(a.notification_date || ''))
    .slice(0, 25);

  const breachTable = recent.length
    ? `<div class="table-scroll"><table>
<caption class="sr-only">The ${recent.length} most recently reported breaches on the record</caption>
<thead><tr><th scope="col">Entity</th><th scope="col">Sector</th><th scope="col">Notification date</th><th scope="col">Records affected</th><th scope="col">Severity</th></tr></thead>
<tbody>${recent
        .map(
          (b) => `<tr>
<td><a href="/breach/${escapeHtml(b.slug)}">${escapeHtml(b.entity_name)}</a></td>
<td>${escapeHtml(b.sector || '')}</td>
<td>${escapeHtml(b.notification_date || '')}</td>
<td>${Number.isFinite(Number(b.records_affected)) && b.records_affected != null ? Number(b.records_affected).toLocaleString('en-US') + (b.records_affected_is_est ? ' (est.)' : '') : 'not disclosed'}</td>
<td>${Number.isFinite(Number(b.severity_score)) && b.severity_score != null ? `${Number(b.severity_score)} / 100` : ''}</td>
</tr>`
        )
        .join('\n')}</tbody></table></div>`
    : `<div class="empty-state">No breach records are published yet. Every record published here will cite its
government or court source. See <a href="/sources/">sources and methodology</a>.</div>`;

  const openSettlements = litigation.filter((l) => l.claim_deadline && l.official_claim_url);
  const settlementBlock = openSettlements.length
    ? `<div class="table-scroll"><table>
<caption class="sr-only">Settlements with an open claim deadline</caption>
<thead><tr><th scope="col">Case</th><th scope="col">Claim deadline</th><th scope="col">Administrator</th></tr></thead>
<tbody>${openSettlements
        .map(
          (l) => `<tr><td>${escapeHtml(l.case_name)}</td><td class="deadline">${escapeHtml(l.claim_deadline)}</td><td>${escapeHtml(l.administrator_name || '')}</td></tr>`
        )
        .join('\n')}</tbody></table></div>`
    : `<div class="empty-state">No settlements are open yet. When one is, it will be listed here with its claim
deadline and a link to the official settlement administrator &mdash; this site never processes claims
itself.</div>`;

  // Coverage is stated on the front page, not only on /sources. Derived from
  // the record itself so it cannot describe a breadth the site does not have:
  // while one sector supplies every published record, saying so here is the
  // difference between a reader understanding the scope and assuming it.
  const sectors = [...new Set(breaches.map((b) => b.sector).filter(Boolean))];
  const scopeNote =
    sectors.length === 1
      ? `<p class="scope-note">Coverage today is ${escapeHtml(
          SECTOR_LABEL[sectors[0]] || sectors[0]
        ).toLowerCase()} only, sourced from the HHS Office for Civil Rights breach portal. State attorney
general, SEC, and court sources are documented on the <a href="/sources/">sources page</a> and are not yet
ingested, so this record is not yet comprehensive across sectors.</p>`
      : '';

  const content = `
<h1>The breach record</h1>
<p>A structured public record of disclosed U.S. data breaches, compiled from federal and state government
filings. Each entry lists what was exposed, when notice was given, what remediation the entity offered, and the
litigation that followed — with every fact traced to its source.</p>
${scopeNote}

<h2>Recent breaches</h2>
${breachTable}

<h2>Open settlements</h2>
${settlementBlock}

<h2>How to read this record</h2>
<p>Severity scores follow a published, versioned rubric — see <a href="/severity/">the severity rubric</a> for the
full scoring math. Sourcing and retrieval methods are documented on <a href="/sources/">sources and
methodology</a>. Errors are corrected openly and logged on the <a href="/corrections/">corrections page</a>.</p>`;

  return page({
    site,
    assets: ctx.assets,
    // The record as a whole is described once, on its own front page.
    structuredData: [dataset(site, breaches)],
    route: '/',
    title: site.name,
    description: 'A structured public record of disclosed U.S. data breaches, compiled from federal and state government filings, with every fact traced to a citable source.',
    content,
  });
}

module.exports = { render };
