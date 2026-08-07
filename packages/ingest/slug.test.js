const test = require('node:test');
const assert = require('node:assert');
const { breachSlug, slugifyText, assignSlugs } = require('./slug');

test('builds entity-year-month slug', () => {
  assert.equal(breachSlug('Contoso Health Network', '2025-03-14'), 'contoso-health-network-2025-03');
});

test('strips punctuation, diacritics, and expands ampersand', () => {
  assert.equal(slugifyText("St. Mary's Health & Rehab"), 'st-mary-s-health-and-rehab');
  assert.equal(slugifyText('Clínica Muñoz'), 'clinica-munoz');
});

test('missing notification date yields entity-only slug, never "undefined"', () => {
  const s = breachSlug('Acme Clinic', null);
  assert.equal(s, 'acme-clinic');
  assert.ok(!s.includes('undefined') && !s.includes('nan'));
});

test('empty entity name falls back rather than producing an empty slug', () => {
  assert.equal(breachSlug('', '2025-01-05'), 'unnamed-entity-2025-01');
});

test('long names truncate on a word boundary', () => {
  const s = breachSlug('A'.repeat(20) + ' ' + 'B'.repeat(80), '2025-01-05');
  assert.ok(s.length < 90);
  assert.ok(!s.includes('--'));
  assert.ok(s.endsWith('-2025-01'));
});

test('collisions are suffixed deterministically, independent of input order', () => {
  const mk = (id) => ({ id, entity_name: 'Acme Clinic', notification_date: '2025-04-02' });
  const forward = assignSlugs([mk('b'), mk('a'), mk('c')]).map((r) => `${r.id}:${r.slug}`).sort();
  const reverse = assignSlugs([mk('c'), mk('b'), mk('a')]).map((r) => `${r.id}:${r.slug}`).sort();
  assert.deepEqual(forward, reverse);
  assert.ok(forward.includes('a:acme-clinic-2025-04'));
});

test('distinct breaches by the same entity in different months do not collide', () => {
  const recs = assignSlugs([
    { id: '1', entity_name: 'Acme Clinic', notification_date: '2025-04-02' },
    { id: '2', entity_name: 'Acme Clinic', notification_date: '2025-09-11' },
  ]);
  assert.notEqual(recs[0].slug, recs[1].slug);
});

test('slugs contain only url-safe characters', () => {
  for (const name of ["O'Brien & Sons, Inc.", 'Café Médical', 'A/B Testing Co.', '   ']) {
    const s = breachSlug(name, '2025-01-01');
    assert.match(s, /^[a-z0-9-]+$/, `bad slug for ${name}: ${s}`);
  }
});

// --- Published slugs are frozen -------------------------------------------
// These guard a defect that was live in Phase 1 and would have got worse with
// every source added: recomputing slugs moved URLs that were already indexed.

test('a published record keeps its slug when a sibling appears in the same month', () => {
  // Ordering within a group is by sha256 id, so before this was fixed the new
  // record won the bare slug roughly half the time and evicted the published one.
  const published = { id: 'ffff-later-sorting', entity_name: 'Riverbend Health', notification_date: '2026-05-04' };
  const sibling = { id: '0000-earlier-sorting', entity_name: 'Riverbend Health', notification_date: '2026-05-20' };
  assignSlugs([published, sibling], {
    existingSlugById: new Map([[published.id, 'riverbend-health-2026-05']]),
  });
  assert.equal(published.slug, 'riverbend-health-2026-05', 'the published URL must not move');
  assert.equal(sibling.slug, 'riverbend-health-2026-05-2');
});

test('a published record keeps its slug when the source respells the entity', () => {
  const rec = { id: 'fixed-id', entity_name: 'Acme Clinic, Inc.', notification_date: '2026-05-14' };
  assignSlugs([rec], { existingSlugById: new Map([['fixed-id', 'acme-clinic-2026-05']]) });
  assert.equal(rec.slug, 'acme-clinic-2026-05');
  assert.notEqual(rec.slug, breachSlug(rec.entity_name, rec.notification_date));
});

test('a new record never takes a slug another record already publishes', () => {
  const fresh = { id: 'new-1', entity_name: 'Acme Clinic', notification_date: '2026-05-14' };
  assignSlugs([fresh], { existingSlugById: new Map([['someone-else', 'acme-clinic-2026-05']]) });
  assert.equal(fresh.slug, 'acme-clinic-2026-05-2');
});

test('assignment does not depend on the order the source listed the records', () => {
  const mk = () => [
    { id: 'b', entity_name: 'Same Name', notification_date: '2026-05-02' },
    { id: 'a', entity_name: 'Same Name', notification_date: '2026-05-09' },
    { id: 'c', entity_name: 'Same Name', notification_date: '2026-05-21' },
  ];
  const forward = mk();
  const reversed = mk().reverse();
  assignSlugs(forward);
  assignSlugs(reversed);
  const byId = (list) => Object.fromEntries(list.map((r) => [r.id, r.slug]));
  assert.deepEqual(byId(forward), byId(reversed));
});

test('re-running against its own output is a no-op', () => {
  // The property that matters in production: today's slugs are tomorrow's
  // frozen slugs, so a second run must change nothing.
  const records = [
    { id: 'a', entity_name: 'Clinic One', notification_date: '2026-05-02' },
    { id: 'b', entity_name: 'Clinic One', notification_date: '2026-05-09' },
  ];
  assignSlugs(records);
  const first = records.map((r) => r.slug);
  const existing = new Map(records.map((r) => [r.id, r.slug]));
  assignSlugs(records, { existingSlugById: existing });
  assert.deepEqual(records.map((r) => r.slug), first);
});
