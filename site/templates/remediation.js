// Remediation guidance for one breach: /breach/[slug]/what-to-do
//
// Assembled, not written. The modules come from the seeded module library and
// are selected by the data classes this breach's record actually lists — the
// inverse of remediation_modules.applies_to, the same derivation the seed
// loader uses for data_classes.remediation_ids. Nothing here is specific to a
// reader, and nothing is added that a federal agency did not publish.
//
// Editorial constraints this template is built to satisfy (docs/EDITORIAL.md):
// - No legal advice. Steps are attributed to the agency that published them
//   ("the FTC's guidance states"), never asserted as what the reader must do.
// - Never imply the reader is affected. The page is conditional throughout,
//   and says plainly that only the entity's own notice can answer that.
// - Every module carries its source link and verification date.

const { page } = require('./layout');
const { escapeHtml, renderMarkdown } = require('./markdown');
const { breadcrumbList } = require('./structured-data');

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function render(ctx) {
  const { site, breach, modules = [], dataClassMap } = ctx;

  const exposed = breach.data_classes_parsed || [];
  const exposedLabels = exposed
    .map((code) => (dataClassMap[code] ? dataClassMap[code].label : code))
    .filter(Boolean);

  const moduleBlocks = modules
    .map((m) => {
      const applies = m.applies_to
        .filter((c) => exposed.includes(c))
        .map((c) => (dataClassMap[c] ? dataClassMap[c].label : c));
      const verified = fmtDate(m.last_verified);
      return `
<section class="remediation-module">
<h2>${escapeHtml(m.title)}</h2>
<p class="module-applies">Listed here because the record for this breach includes: ${escapeHtml(applies.join(', '))}.</p>
${renderMarkdown(m.body_md)}
<p class="retrieved">Published by <a href="${escapeHtml(m.source_url)}">${escapeHtml(hostOf(m.source_url))}</a>${
        verified ? ` &middot; verified ${escapeHtml(verified)}` : ''
      }</p>
</section>`;
    })
    .join('\n');

  const content = `
<nav class="breadcrumb"><a href="/">Record</a> &rsaquo; <a href="/breach/${escapeHtml(breach.slug)}/">${escapeHtml(
    breach.entity_name
  )}</a> &rsaquo; What to do</nav>

<h1>Steps published for the information exposed in the ${escapeHtml(breach.entity_name)} breach</h1>

<p class="record-note">This page is general reference information, not legal advice, and not a statement that
any particular person was affected by this breach. Only a notice from the reporting organization can answer
whether a given individual's information was involved. ${escapeHtml(site.name)} is not a law firm and does not
process or advise on claims.</p>

<p>The record for this breach lists ${exposedLabels.length} categor${exposedLabels.length === 1 ? 'y' : 'ies'}
of exposed information${exposedLabels.length ? `: ${escapeHtml(exposedLabels.join(', '))}` : ''}. The sections
below reproduce the guidance federal consumer-protection agencies publish for those categories, in the order
this site's module library assigns. Each cites the agency page it came from and the date that page was last
checked.</p>

${moduleBlocks}

<h2>What this page does not cover</h2>
<p>Guidance is selected only from the categories the government record states. Where a source does not
enumerate what was exposed, fewer sections appear here &mdash; that reflects a gap in the public record, not
a finding that less was exposed. Rights that depend on the state a person lives in are recorded separately in
the <a href="/rights/">state breach-notification reference</a>.</p>

<p class="related"><a href="/breach/${escapeHtml(breach.slug)}/">Back to the ${escapeHtml(
    breach.entity_name
  )} record</a> &middot; <a href="/rights/">Rights by state</a> &middot; <a href="/sources/">How this record is compiled</a></p>
<p class="corrections-link">Found an error on this page? See the <a href="/corrections/">corrections policy</a>.</p>`;

  return page({
    site,
    assets: ctx.assets,
    structuredData: [
      breadcrumbList(site.origin, [
        { name: 'Record', path: '/' },
        { name: breach.entity_name, path: `/breach/${breach.slug}/` },
        { name: 'What to do' },
      ]),
    ],
    route: `/breach/${breach.slug}/what-to-do`,
    title: `${breach.entity_name} breach: published remediation guidance`,
    description: `Guidance published by federal consumer-protection agencies for the categories of information exposed in the ${breach.entity_name} data breach, with the source and verification date for each.`,
    content,
  });
}

module.exports = { render };
