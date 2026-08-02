const { page } = require('./layout');
const { escapeHtml } = require('./markdown');

function render(ctx) {
  const { site, rubric, dataClasses } = ctx;

  const weightRows = dataClasses
    .slice()
    .sort((a, b) => b.severity_weight - a.severity_weight)
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.label)}</td><td>${escapeHtml(c.permanence.replace('_', '-'))}</td><td>${c.severity_weight}</td></tr>`
    )
    .join('\n');

  const scaleRows = rubric.scale_modifier.bands
    .map((b) => `<tr><td>${escapeHtml(b.label)}</td><td>${b.points}</td></tr>`)
    .join('\n');

  const gapRows = rubric.remediation_gap_modifier.bands
    .map((b) => `<tr><td>${escapeHtml(b.condition.replace(/_/g, ' '))}</td><td>${b.points}</td></tr>`)
    .join('\n');

  const lagRows = rubric.notification_lag_modifier.bands
    .map(
      (b) =>
        `<tr><td>${b.max_days === null ? `over ${b.min_days - 1} days` : `${b.min_days} to ${b.max_days} days`}</td><td>${b.points}</td></tr>`
    )
    .join('\n');

  const content = `
<h1>Severity rubric, version ${escapeHtml(rubric.version)}</h1>
<p>Every breach on this site carries a severity score from 0 to 100, computed by a fixed, published formula.
The score is always displayed with its component breakdown — a bare number with no math shown reads as invented.
When the rubric changes, the version number changes, and existing scores record which version produced them.</p>

<p><code>${escapeHtml(rubric.formula)}</code></p>

<h2>Component 1: data class subtotal (capped at ${rubric.data_class_subtotal.cap})</h2>
<p>The sum of the weights of every data class the breach exposed. Weights reflect permanence: a Social Security
number cannot be rotated the way a payment card can.</p>
<table>
<thead><tr><th>Data class</th><th>Permanence</th><th>Weight</th></tr></thead>
<tbody>${weightRows}</tbody>
</table>

<h2>Component 2: scale modifier (0&ndash;${rubric.scale_modifier.max})</h2>
<p>Log-scaled on the number of records affected. Bands include their lower bound and exclude their upper bound.
When the record count is undisclosed, this component scores 0 and the breakdown says so.</p>
<table>
<thead><tr><th>Records affected</th><th>Points</th></tr></thead>
<tbody>${scaleRows}</tbody>
</table>

<h2>Component 3: remediation gap modifier (0&ndash;${rubric.remediation_gap_modifier.max})</h2>
<p>Scores the gap between what was exposed and what the notifying entity offered affected people.</p>
<table>
<thead><tr><th>Condition</th><th>Points</th></tr></thead>
<tbody>${gapRows}</tbody>
</table>

<h2>Component 4: notification lag modifier (0&ndash;${rubric.notification_lag_modifier.max})</h2>
<p>Days between the entity's stated discovery date and its notification date. When either date is undisclosed,
this component scores 0 and the breakdown says so.</p>
<table>
<thead><tr><th>Lag</th><th>Points</th></tr></thead>
<tbody>${lagRows}</tbody>
</table>

<div class="citations">
<h2>Rubric provenance</h2>
<ol>
<li>The rubric is maintained in the site repository as <code>packages/severity/rubric.json</code> and applied
by a deterministic scoring function. Scores are reproducible from the published inputs on each breach page.</li>
</ol>
</div>`;

  return page({
    site,
    route: '/severity',
    title: `Severity rubric v${rubric.version}`,
    description: 'The published, versioned rubric used to score breach severity: data class weights, scale, remediation gap, and notification lag.',
    content,
  });
}

module.exports = { render };
