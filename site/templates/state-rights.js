// State breach-notification statute reference: /rights/[state]
//
// Renders the seeded state_rights row for one jurisdiction. Every field is
// reported as what the statute provides, with the citation and the date the
// entry was last verified; nothing is framed as what a reader should do.
//
// The seed rows also carry `_notes` and `_confidence`. Those are editorial
// working notes — verification trails, URL provenance, open questions — and
// are deliberately NOT published: the seed loader does not write them to the
// database either. Publishing an internal QA trail as reader-facing content
// would put unreviewed prose on a YMYL page.
//
// Where a value is null the page says the statute sets no such figure, rather
// than rendering an empty cell. A blank is indistinguishable from an oversight;
// a sentence is a fact.

const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { breadcrumbList } = require('./structured-data');

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function deadlineText(days) {
  if (days == null) {
    return 'No fixed number of days appears in the statute; notice is required without unreasonable delay.';
  }
  return `${days} days.`;
}

function agThresholdText(threshold) {
  if (threshold == null) {
    return 'The statute sets no general requirement to notify the attorney general.';
  }
  if (Number(threshold) <= 1) {
    return 'Every breach that requires notice to residents must also be reported to the attorney general.';
  }
  // The seed records thresholds as an inclusive lower bound — its own notes call
  // this "recorded as at/above value", so a statute reading "more than 1,000" is
  // stored as 1001. Rendering it as "N or more" states the boundary the seed
  // actually encodes, rather than re-deriving a comparison from the raw figure.
  return `Reported to the attorney general when the breach affects ${Number(threshold).toLocaleString('en-US')} or more residents.`;
}

function monitoringText(months) {
  if (months == null) {
    return 'The statute does not require the entity to provide identity theft monitoring.';
  }
  return `At least ${months} months of monitoring must be provided in the circumstances the statute specifies.`;
}

function yesNo(flag, yes, no) {
  return Number(flag) === 1 ? yes : no;
}

function render(ctx) {
  const { site, state, states = [] } = ctx;
  const code = String(state.state_code).toLowerCase();
  const verified = fmtDate(state.last_verified);

  const rows = [
    ['Deadline to notify residents', deadlineText(state.notification_deadline_days)],
    [
      'Does an exposed Social Security number trigger notice',
      yesNo(
        state.ssn_triggers_notice,
        'Yes. A Social Security number is within the statute’s definition of personal information.',
        'Not on its own under this statute; other elements may still trigger notice.'
      ),
    ],
    [
      'Cost of a credit freeze',
      yesNo(
        state.free_credit_freeze,
        'Free to place, lift, and remove.',
        'The statute does not provide for a no-cost freeze; federal law provides one nationwide.'
      ),
    ],
    ['Identity theft monitoring', monitoringText(state.mandated_monitoring_months)],
    ['Attorney general notice', agThresholdText(state.ag_report_threshold)],
  ]
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`)
    .join('\n');

  const others = states
    .filter((s) => s.state_code !== state.state_code)
    .map(
      (s) =>
        `<a href="/rights/${escapeHtml(String(s.state_code).toLowerCase())}/">${escapeHtml(s.state_name)}</a>`
    )
    .join(' &middot; ');

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; <a href="/rights/">Rights by state</a> &rsaquo; ${escapeHtml(
    state.state_name
  )}</nav>

<h1>Breach notification law in ${escapeHtml(state.state_name)}</h1>

<p class="record-note">This page reports what the ${escapeHtml(state.state_name)} breach notification statute
provides. It is a reference summary, not legal advice, and it does not describe any particular breach.
${escapeHtml(site.name)} is not a law firm and cannot advise on how a statute applies to an individual case.</p>

<div class="table-scroll"><table class="rights-table"><tbody>
${rows}
</tbody></table></div>

<h2>Statute</h2>
<p>${escapeHtml(state.statute_citation)}${
    state.statute_url ? ` &mdash; <a href="${escapeHtml(state.statute_url)}">read the statute</a>` : ''
  }</p>
${verified ? `<p class="retrieved">Entry last verified ${escapeHtml(verified)} against the official source above.</p>` : ''}

<h2>How to read this entry</h2>
<p>These fields summarize the obligations a statute places on an organization that discloses a breach. They do
not establish that any organization met or failed to meet them, and a breach recorded elsewhere on this site is
not evidence either way. Where the statute sets no figure, the row says so rather than showing a blank.</p>

<h2>Other jurisdictions</h2>
<p class="related">${others}</p>

<p class="corrections-link">Found an error in this entry? See the <a href="/corrections/">corrections policy</a>.</p>`;

  return page({
    site,
    assets: ctx.assets,
    structuredData: [
      breadcrumbList(site.origin, [
        { name: 'Record', path: '/' },
        { name: 'Rights by state', path: '/rights/' },
        { name: state.state_name },
      ]),
    ],
    route: `/rights/${code}`,
    title: `${state.state_name} data breach notification law`,
    description: `What the ${state.state_name} data breach notification statute provides: the deadline to notify residents, attorney general reporting, credit freeze cost, and monitoring, with the statute cited.`,
    content,
  });
}

module.exports = { render };
