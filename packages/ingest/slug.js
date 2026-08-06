// Slug generation for breach pages.
//
// A slug is a permanent public URL. Two properties matter more than prettiness:
//   1. STABILITY — the same breach must always produce the same slug, or the
//      record's URL changes between ingest runs and every inbound link breaks.
//      So slugs derive only from immutable facts (entity name + notification
//      date), never from mutable ones like record counts or severity.
//   2. UNIQUENESS — one entity can report several breaches. Collisions are
//      resolved deterministically by the caller-supplied disambiguator, not by
//      an incrementing counter that depends on processing order.

const MAX_ENTITY_CHARS = 60;

function slugifyText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics: Muñoz -> Munoz
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Build a breach slug: "<entity>-<yyyy-mm>".
 * Month granularity keeps the URL readable while separating an entity's
 * repeat breaches in the common case.
 */
function breachSlug(entityName, notificationDate) {
  let entity = slugifyText(entityName);
  if (!entity) entity = 'unnamed-entity';
  if (entity.length > MAX_ENTITY_CHARS) {
    entity = entity.slice(0, MAX_ENTITY_CHARS).replace(/-+[^-]*$/, ''); // cut on a word boundary
  }
  const ym = /^(\d{4})-(\d{2})/.exec(notificationDate || '');
  return ym ? `${entity}-${ym[1]}-${ym[2]}` : entity;
}

/**
 * Assign unique slugs across a set of records. Deterministic regardless of
 * input order: colliding records are sorted by a stable key before suffixing,
 * so re-running the ingest never reshuffles which record owns the bare slug.
 * Records are mutated with a `slug` property and returned.
 */
function assignSlugs(records, { stableKey = (r) => r.id } = {}) {
  const groups = new Map();
  for (const r of records) {
    const base = breachSlug(r.entity_name, r.notification_date);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(r);
  }
  for (const [base, group] of groups) {
    if (group.length === 1) {
      group[0].slug = base;
      continue;
    }
    const sorted = group.slice().sort((a, b) => {
      const ka = String(stableKey(a));
      const kb = String(stableKey(b));
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    sorted.forEach((r, idx) => {
      r.slug = idx === 0 ? base : `${base}-${idx + 1}`;
    });
  }
  return records;
}

module.exports = { breachSlug, slugifyText, assignSlugs, MAX_ENTITY_CHARS };
