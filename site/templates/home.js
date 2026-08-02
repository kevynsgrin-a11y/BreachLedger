const { page } = require('./layout');
const { escapeHtml } = require('./markdown');

function render(ctx) {
  const { site, breaches, litigation } = ctx;

  const recent = breaches
    .slice()
    .sort((a, b) => (b.notification_date || '').localeCompare(a.notification_date || ''))
    .slice(0, 25);

  const breachTable = recent.length
    ? `<table>
<thead><tr><th>Entity</th><th>Sector</th><th>Notification date</th><th>Records affected</th><th>Severity</th></tr></thead>
<tbody>${recent
        .map(
          (b) => `<tr>
<td><a href="/breach/${escapeHtml(b.slug)}">${escapeHtml(b.entity_name)}</a></td>
<td>${escapeHtml(b.sector || '')}</td>
<td>${escapeHtml(b.notification_date || '')}</td>
<td>${b.records_affected != null ? Number(b.records_affected).toLocaleString('en-US') + (b.records_affected_is_est ? ' (est.)' : '') : 'not disclosed'}</td>
<td>${b.severity_score != null ? `${b.severity_score} / 100` : ''}</td>
</tr>`
        )
        .join('\n')}</tbody></table>`
    : `<div class="empty-state">No breach records are published yet. Ingestion of the HHS Office for Civil Rights
breach portal begins in Phase 1; state attorney general sources follow. Every record published here will cite
its government or court source. See <a href="/sources">sources and methodology</a>.</div>`;

  const openSettlements = litigation.filter((l) => l.claim_deadline && l.official_claim_url);
  const settlementBlock = openSettlements.length
    ? `<table>
<thead><tr><th>Case</th><th>Claim deadline</th><th>Administrator</th></tr></thead>
<tbody>${openSettlements
        .map(
          (l) => `<tr><td>${escapeHtml(l.case_name)}</td><td class="deadline">${escapeHtml(l.claim_deadline)}</td><td>${escapeHtml(l.administrator_name || '')}</td></tr>`
        )
        .join('\n')}</tbody></table>`
    : `<div class="empty-state">Settlement tracking begins in Phase 4. Settlement pages will link only to the official
settlement administrator; this site does not process claims.</div>`;

  const content = `
<h1>The breach record</h1>
<p>A structured public record of disclosed U.S. data breaches, compiled from federal and state government
filings. Each entry lists what was exposed, when notice was given, what remediation the entity offered, and the
litigation that followed — with every fact traced to its source.</p>

<h2>Recent breaches</h2>
${breachTable}

<h2>Open settlements</h2>
${settlementBlock}

<h2>How to read this record</h2>
<p>Severity scores follow a published, versioned rubric — see <a href="/severity">the severity rubric</a> for the
full scoring math. Sourcing and retrieval methods are documented on <a href="/sources">sources and
methodology</a>. Errors are corrected openly and logged on the <a href="/corrections">corrections page</a>.</p>`;

  return page({
    site,
    route: '/',
    title: site.name,
    description: 'A structured public record of disclosed U.S. data breaches, compiled from federal and state government filings, with every fact traced to a citable source.',
    content,
  });
}

module.exports = { render };
