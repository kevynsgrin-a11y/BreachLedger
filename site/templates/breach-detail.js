// Breach detail — the programmatic core of the site.
// Block order is fixed by spec section 6 and is not cosmetic: the record comes
// first, the interpretation second, the sources always.

const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { score } = require('../../packages/severity/score');

const PERMANENCE_LABEL = {
  permanent: 'permanent',
  semi_permanent: 'semi-permanent',
  rotatable: 'rotatable',
};

const VECTOR_LABEL = {
  hacking: 'Hacking or IT incident',
  insider: 'Insider',
  loss: 'Loss or theft',
  improper_disposal: 'Improper disposal',
  unknown: 'Unknown',
};

function fmtNumber(n) {
  return Number.isFinite(Number(n)) && n != null ? Number(n).toLocaleString('en-US') : null;
}

function fmtDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function severityBlock(breach, dataClassMap) {
  const parsed = {
    data_classes: breach.data_classes_parsed,
    records_affected: breach.records_affected,
    remediation_offered: breach.remediation_offered_parsed,
    discovery_date: breach.discovery_date,
    notification_date: breach.notification_date,
  };
  const result = score(parsed);
  const b = result.breakdown;

  const classRows = b.data_class_subtotal.parts
    .map((p) => {
      const dc = dataClassMap[p.code];
      return `<tr><td>${escapeHtml(dc ? dc.label : p.code)}</td><td>${p.weight}</td></tr>`;
    })
    .join('');

  const capNote =
    b.data_class_subtotal.raw > b.data_class_subtotal.capped
      ? ` (sum ${b.data_class_subtotal.raw}, capped at ${b.data_class_subtotal.capped})`
      : '';

  const lagText = b.notification_lag_modifier.unknown
    ? 'not calculable &mdash; discovery or notification date not disclosed'
    : `${b.notification_lag_modifier.days} days between discovery and notification`;

  const scaleText = b.scale_modifier.unknown
    ? `records affected ${escapeHtml(b.scale_modifier.band)}`
    : escapeHtml(b.scale_modifier.band) + ' records';

  return `
<h2>Severity score</h2>
<p class="severity-value">${result.score} out of 100 <span class="severity-rubric">(rubric v${escapeHtml(result.rubric_version)})</span></p>
<div class="severity-bar"><div class="severity-bar-fill sev-${result.score}"></div></div>
<p>This score is computed, not assigned. Every component is shown below, and the method is published in full
on the <a href="/severity/">severity rubric</a>.</p>
<div class="table-scroll"><table>
<thead><tr><th>Component</th><th>Basis</th><th>Points</th></tr></thead>
<tbody>
<tr><td>Data classes exposed</td><td>${b.data_class_subtotal.parts.length} class(es)${escapeHtml(capNote)}</td><td>${b.data_class_subtotal.capped}</td></tr>
<tr><td>Scale</td><td>${scaleText}</td><td>${b.scale_modifier.points}</td></tr>
<tr><td>Remediation gap</td><td>${escapeHtml(b.remediation_gap_modifier.band)}</td><td>${b.remediation_gap_modifier.points}</td></tr>
<tr><td>Notification lag</td><td>${lagText}</td><td>${b.notification_lag_modifier.points}</td></tr>
<tr><td><strong>Total</strong></td><td></td><td><strong>${result.score}</strong></td></tr>
</tbody></table></div>
${classRows ? `<h3>Data class weights applied</h3><div class="table-scroll"><table><thead><tr><th>Data class</th><th>Weight</th></tr></thead><tbody>${classRows}</tbody></table></div>` : ''}`;
}

function render(ctx) {
  const { site, breach, sources, litigation = [], dataClassMap, buildPhase } = ctx;

  const exposed = breach.data_classes_parsed || [];
  const states = breach.states_notified_parsed || [];
  const remediation = breach.remediation_offered_parsed;

  const exposedRows = exposed
    .map((code) => {
      const dc = dataClassMap[code];
      if (!dc) return '';
      return `<tr><td>${escapeHtml(dc.label)}</td><td>${escapeHtml(PERMANENCE_LABEL[dc.permanence] || dc.permanence)}</td></tr>`;
    })
    .join('');

  const recordsText = (() => {
    const n = fmtNumber(breach.records_affected);
    if (n === null) return 'Not disclosed in the source record.';
    return `${n} individuals${breach.records_affected_is_est ? ' <em>(estimated)</em>' : ''}`;
  })();

  const timelineRows = [
    ['Breach began', fmtDate(breach.breach_start_date)],
    ['Breach ended', fmtDate(breach.breach_end_date)],
    ['Discovered', fmtDate(breach.discovery_date)],
    ['Reported', fmtDate(breach.notification_date)],
  ]
    .map(([label, value]) => `<tr><td>${label}</td><td>${value ? escapeHtml(value) : '<span class="not-disclosed">not disclosed</span>'}</td></tr>`)
    .join('');

  let lagLine = '';
  if (breach.discovery_date && breach.notification_date) {
    const days = Math.round((Date.parse(breach.notification_date) - Date.parse(breach.discovery_date)) / 86400000);
    if (Number.isFinite(days) && days >= 0) {
      lagLine = `<p>${days} day${days === 1 ? '' : 's'} elapsed between discovery and notification.</p>`;
    }
  }

  const remediationBlock = remediation && remediation.type && remediation.type !== 'none'
    ? `<p>${escapeHtml(remediation.type)}${remediation.provider ? ` through ${escapeHtml(remediation.provider)}` : ''}${
        remediation.months ? `, ${remediation.months} months` : ''
      }.${remediation.enrollment_deadline ? ` Enrollment deadline: <span class="deadline">${escapeHtml(fmtDate(remediation.enrollment_deadline) || remediation.enrollment_deadline)}</span>.` : ''}</p>`
    : `<p>The source record does not report remediation offered by the entity. This does not mean none was
offered &mdash; it means the government record does not state it.</p>`;

  const statesBlock = states.length
    ? `<p>${states.map((s) => escapeHtml(s)).join(', ')}</p>`
    : `<p>The source record does not enumerate the states notified.</p>`;

  const related = litigation.filter((l) => l.breach_id === breach.id);
  const litigationBlock = related.length
    ? `<div class="table-scroll"><table><thead><tr><th>Case</th><th>Court</th><th>Status</th></tr></thead><tbody>${related
        .map(
          (l) => `<tr><td>${escapeHtml(l.case_name)}</td><td>${escapeHtml(l.court || '')}</td><td>${escapeHtml(l.status || '')}</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : `<p>No litigation associated with this breach is recorded here. Litigation and settlement tracking is
being added; absence from this page is not evidence that none exists.</p>`;

  // Sources block. Non-optional: renders even when there is only one source,
  // and a record with zero sources never reaches this template.
  const sourceItems = sources
    .map((s) => {
      const label = ctx.sourceLabels[s.source_type] || s.source_type;
      const doc = s.document_url
        ? ` &middot; <a href="${escapeHtml(s.document_url)}">source document</a>`
        : '';
      return `<li><a href="${escapeHtml(s.source_url)}">${escapeHtml(label)}</a>${doc}
<span class="retrieved">retrieved ${escapeHtml(fmtDate(s.retrieved_at) || s.retrieved_at)}</span></li>`;
    })
    .join('');

  const year = (breach.notification_date || '').slice(0, 4);
  const nav = [
    breach.sector ? `<a href="/sector/${escapeHtml(breach.sector)}/">All ${escapeHtml(breach.sector)} breaches</a>` : '',
    year ? `<a href="/breaches/${escapeHtml(year)}/">Breaches reported in ${escapeHtml(year)}</a>` : '',
    buildPhase >= 3 ? `<a href="/breach/${escapeHtml(breach.slug)}/what-to-do/">What to do if you were affected</a>` : '',
  ].filter(Boolean).join(' &middot; ');

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; ${escapeHtml(breach.entity_name)}</nav>

<h1>${escapeHtml(breach.entity_name)}</h1>
<p class="record-meta">
  ${breach.sector ? `Sector: ${escapeHtml(breach.sector)}. ` : ''}
  ${breach.notification_date ? `Reported ${escapeHtml(fmtDate(breach.notification_date))}.` : ''}
  ${breach.breach_vector ? ` Cause on the record: ${escapeHtml(VECTOR_LABEL[breach.breach_vector] || breach.breach_vector)}.` : ''}
</p>

${severityBlock(breach, dataClassMap)}

<h2>What was exposed</h2>
${
  exposedRows
    ? `<div class="table-scroll"><table><thead><tr><th>Data class</th><th>Permanence</th></tr></thead><tbody>${exposedRows}</tbody></table></div>
<p>Permanence describes whether the exposed information can be changed. A rotatable value such as a password
can be replaced; a permanent one such as a Social Security number cannot.</p>`
    : `<p>The source record does not enumerate the categories of information involved.</p>`
}

<h2>Records affected</h2>
<p>${recordsText}</p>

<h2>Timeline</h2>
<div class="table-scroll"><table><tbody>${timelineRows}</tbody></table></div>
${lagLine}

<h2>Remediation offered by the entity</h2>
${remediationBlock}

<h2>States notified</h2>
${statesBlock}

<h2>Litigation</h2>
${litigationBlock}

<div class="citations">
<h2>Sources</h2>
<p>Every fact on this page comes from the government records below.</p>
<ol>${sourceItems}</ol>
</div>

${nav ? `<p class="related">${nav}</p>` : ''}
<p class="corrections-link">Found an error in this record? See the <a href="/corrections/">corrections policy</a>.</p>`;

  return page({
    site,
    assets: ctx.assets,
    route: `/breach/${breach.slug}`,
    title: `${breach.entity_name} data breach`,
    description: `Government record of the ${breach.entity_name} data breach${
      breach.notification_date ? `, reported ${fmtDate(breach.notification_date)}` : ''
    }: what was exposed, how many people, and the sources.`,
    content,
  });
}

module.exports = { render, fmtDate, fmtNumber };
