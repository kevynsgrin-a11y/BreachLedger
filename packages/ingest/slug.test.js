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
