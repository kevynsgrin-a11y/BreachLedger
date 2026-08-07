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
 * Build a breach slug: "<entity>-<yyyy-mm>", or "<entity>-<namespace>-<yyyy-mm>".
 * Month granularity keeps the URL readable while separating an entity's
 * repeat breaches in the common case.
 *
 * The namespace exists because a single organization can file to two different
 * government listings under two different rules — HHS runs a HIPAA breach
 * report and a separate 42 CFR Part 2 one. Those are distinct filings and get
 * distinct records, so they must get distinct URLs. Disambiguating them with a
 * numeric suffix would not do: which filing won the bare slug would depend on
 * which source happened to be ingested first, and the URLs are permanent.
 */
function breachSlug(entityName, notificationDate, namespace = null) {
  let entity = slugifyText(entityName);
  if (!entity) entity = 'unnamed-entity';
  if (entity.length > MAX_ENTITY_CHARS) {
    entity = entity.slice(0, MAX_ENTITY_CHARS).replace(/-+[^-]*$/, ''); // cut on a word boundary
  }
  const ns = slugifyText(namespace);
  if (ns) entity = `${entity}-${ns}`;
  const ym = /^(\d{4})-(\d{2})/.exec(notificationDate || '');
  return ym ? `${entity}-${ym[1]}-${ym[2]}` : entity;
}

/**
 * Assign slugs across a set of records.
 *
 * THE RULE: a slug is frozen at first publication and never recomputed.
 *
 * `existingSlugById` carries what the database already publishes. Any record
 * whose id appears there keeps that exact slug, whatever its entity name now
 * says and whoever else is in this run. Only genuinely new records compute one,
 * and they may only take a slug nobody already holds.
 *
 * This is not a refinement. Recomputing slugs was actively breaking published
 * URLs two ways, both measured against the live code:
 *
 *   1. When an entity that already had a record filed a second breach in the
 *      same month, both fell into one group and were ordered by their sha256
 *      ids -- so in 48% of cases the NEW record took the bare slug and the
 *      already-published one was pushed to '-2'. Its indexed URL moved.
 *   2. When a source respelled an entity ('Acme Clinic' -> 'Acme Clinic, Inc.')
 *      the recomputed slug simply differed, collided with nothing, and the
 *      writer emitted UPDATE breaches SET slug. The old URL 404s, and this site
 *      generates no redirects.
 *
 * Both get worse in Phase 2, not better: more sources means more repeat filers
 * per entity and more spellings of the same name.
 */
function assignSlugs(records, { stableKey = (r) => r.id, existingSlugById = new Map() } = {}) {
  // Every slug already spoken for, and by whom.
  const owner = new Map();
  for (const [id, slug] of existingSlugById) if (slug) owner.set(slug, id);

  const fresh = [];
  for (const r of records) {
    const published = existingSlugById.get(r.id);
    if (published) r.slug = published; // frozen, verbatim
    else fresh.push(r);
  }

  // New records only. Sorted by a stable key so the outcome does not depend on
  // the order the source happened to list them in.
  const groups = new Map();
  for (const r of fresh) {
    const base = breachSlug(r.entity_name, r.notification_date, r.slug_namespace);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(r);
  }
  for (const [base, group] of groups) {
    const sorted = group.slice().sort((a, b) => {
      const ka = String(stableKey(a));
      const kb = String(stableKey(b));
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const r of sorted) {
      let candidate = base;
      let n = 1;
      // Step past anything held by a different record, published or new.
      while (owner.has(candidate) && owner.get(candidate) !== r.id) {
        n += 1;
        candidate = `${base}-${n}`;
      }
      r.slug = candidate;
      owner.set(candidate, r.id);
    }
  }
  return records;
}

module.exports = { breachSlug, slugifyText, assignSlugs, MAX_ENTITY_CHARS };
