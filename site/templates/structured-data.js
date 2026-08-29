// schema.org structured data builders.
//
// These emit plain objects; layout.js serializes them (escaping '<') and the
// build guard rejects any block that still carries a raw '<'. Keeping the
// builders here means the shape of a breadcrumb trail is defined once rather
// than re-derived, slightly differently, in each template.
//
// Scope is deliberately narrow. Only two types are emitted: BreadcrumbList,
// which describes navigation the page already renders visibly, and Dataset,
// which describes the record as a whole on its front page. Nothing here
// asserts a fact that is not already on the page and traceable to a source —
// marking up a breach as a NewsArticle, for instance, would claim an authored
// story where this site publishes a government filing.

function breadcrumbList(origin, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: entry.name,
      // The final crumb is the current page and carries no item URL, per
      // schema.org guidance for the trailing element.
      ...(entry.path ? { item: `${origin}${entry.path}` } : {}),
    })),
  };
}

// temporalCoverage uses the ISO 8601 interval form ("start/end") that
// schema.org specifies for a closed range.
function temporalCoverage(breaches) {
  const dates = breaches.map((b) => b.notification_date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
  if (!dates.length) return null;
  return `${dates[0]}/${dates[dates.length - 1]}`;
}

function dataset(site, breaches) {
  const coverage = temporalCoverage(breaches);
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${site.name}: a public record of disclosed U.S. data breaches`,
    description:
      'A structured public record of disclosed U.S. data breaches, compiled from federal and state ' +
      'government filings. Every published fact traces to a citable government or court source.',
    url: `${site.origin}/`,
    isAccessibleForFree: true,
    creator: { '@type': 'Organization', name: site.name, url: `${site.origin}/` },
    inLanguage: site.language,
    ...(coverage ? { temporalCoverage: coverage } : {}),
    spatialCoverage: { '@type': 'Place', name: 'United States' },
    // Points at the methodology page rather than asserting a licence this
    // project has not published.
    citation: `${site.origin}/sources/`,
  };
}

module.exports = { breadcrumbList, dataset, temporalCoverage };
