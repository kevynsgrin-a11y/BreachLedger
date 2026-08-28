// Index of state breach-notification statutes: /rights
//
// A comparison table across all seeded jurisdictions. The deadline column is
// the one figure that differs most between states and is the usual reason a
// reader arrives here, so it is shown in the table rather than requiring 51
// page loads to compare.

const { page } = require('./layout');
const { escapeHtml } = require('./markdown');
const { breadcrumbList } = require('./structured-data');

function deadlineCell(days) {
  return days == null ? '<span class="not-disclosed">no fixed period</span>' : `${days} days`;
}

function agCell(threshold) {
  if (threshold == null) return '<span class="not-disclosed">not required</span>';
  if (Number(threshold) <= 1) return 'every breach';
  // Thresholds are stored as an inclusive lower bound; see state-rights.js.
  return `${Number(threshold).toLocaleString('en-US')} or more residents`;
}

function render(ctx) {
  const { site, stateRights = [] } = ctx;

  const rows = stateRights
    .map(
      (s) => `<tr>
<td><a href="/rights/${escapeHtml(String(s.state_code).toLowerCase())}/">${escapeHtml(s.state_name)}</a></td>
<td>${deadlineCell(s.notification_deadline_days)}</td>
<td>${agCell(s.ag_report_threshold)}</td>
<td>${Number(s.free_credit_freeze) === 1 ? 'free' : '<span class="not-disclosed">not specified</span>'}</td>
<td>${
        s.mandated_monitoring_months == null
          ? '<span class="not-disclosed">not required</span>'
          : `${s.mandated_monitoring_months} months`
      }</td>
</tr>`
    )
    .join('\n');

  const withDeadline = stateRights.filter((s) => s.notification_deadline_days != null).length;

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; Rights by state</nav>

<h1>Breach notification law by state</h1>

<p>What each U.S. jurisdiction's breach notification statute requires of an organization that discloses a
breach: how quickly residents must be notified, whether the attorney general must be told, what a credit
freeze costs, and whether identity theft monitoring must be offered. ${stateRights.length} jurisdictions are
recorded, of which ${withDeadline} set a fixed notification deadline in days.</p>

<p class="record-note">This is a reference summary of statutory text, not legal advice, and it does not
describe any particular breach. ${escapeHtml(site.name)} is not a law firm and cannot advise on how a statute
applies to an individual case. Each entry cites the statute and the date it was last verified.</p>

<div class="table-scroll"><table>
<thead><tr><th>Jurisdiction</th><th>Notice deadline</th><th>Attorney general notice</th><th>Credit freeze</th><th>Monitoring</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>

<p class="related"><a href="/">The breach record</a> &middot; <a href="/sources/">How this record is compiled</a></p>
<p class="corrections-link">Found an error in one of these entries? See the <a href="/corrections/">corrections policy</a>.</p>`;

  return page({
    site,
    assets: ctx.assets,
    structuredData: [
      breadcrumbList(site.origin, [{ name: 'Record', path: '/' }, { name: 'Rights by state' }]),
    ],
    route: '/rights',
    title: 'Data breach notification law by state',
    description:
      'What each U.S. state breach notification statute requires: the deadline to notify residents, attorney general reporting thresholds, credit freeze cost, and mandated monitoring, each with its statute cited.',
    content,
  });
}

module.exports = { render };
