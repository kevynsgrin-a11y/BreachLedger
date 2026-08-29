const test = require('node:test');
const assert = require('node:assert/strict');

const { breadcrumbList, dataset, temporalCoverage, publisher, publisherNode } = require('./structured-data');
const { page, jsonLd } = require('./layout');

const PUBLISHER = {
  name: 'Oak and Main Developers LLC',
  streetAddress: '2108 N St.',
  addressLocality: 'Sacramento',
  addressRegion: 'CA',
  postalCode: '95816',
  addressCountry: 'US',
  email: 'corrections@breachbook.org',
};

const SITE = {
  name: 'BreachBook',
  tagline: 'A public record of disclosed U.S. data breaches',
  origin: 'https://breachbook.org',
  language: 'en-US',
  publisher: PUBLISHER,
};

test('breadcrumb positions are 1-based and sequential', () => {
  const bc = breadcrumbList(SITE.origin, [
    { name: 'Record', path: '/' },
    { name: 'Healthcare', path: '/sector/healthcare/' },
    { name: 'Acme Health' },
  ]);
  assert.equal(bc['@type'], 'BreadcrumbList');
  assert.deepEqual(bc.itemListElement.map((e) => e.position), [1, 2, 3]);
  assert.equal(bc.itemListElement[1].item, 'https://breachbook.org/sector/healthcare/');
});

test('the trailing breadcrumb carries no item URL', () => {
  const bc = breadcrumbList(SITE.origin, [{ name: 'Record', path: '/' }, { name: 'Acme Health' }]);
  assert.ok(!('item' in bc.itemListElement[1]), 'current page must not link to itself');
});

test('temporalCoverage spans earliest to latest notification date', () => {
  const coverage = temporalCoverage([
    { notification_date: '2015-06-01' },
    { notification_date: '2009-10-21' },
    { notification_date: '2026-07-31' },
  ]);
  assert.equal(coverage, '2009-10-21/2026-07-31');
});

test('temporalCoverage ignores malformed and missing dates', () => {
  assert.equal(temporalCoverage([{ notification_date: null }, { notification_date: 'nope' }]), null);
});

test('dataset omits temporalCoverage rather than emitting an empty range', () => {
  const ds = dataset(SITE, []);
  assert.equal(ds['@type'], 'Dataset');
  assert.ok(!('temporalCoverage' in ds));
});

// The build guard permits exactly one script element, so the escaping that
// makes it safe is load-bearing, not cosmetic.
test('jsonLd escapes < so a value cannot close the script element', () => {
  const out = jsonLd([{ name: '</script><script>alert(1)</script>' }]);
  assert.ok(!/<\/script><script>/.test(out), 'raw breakout sequence must not survive');
  assert.ok(out.includes('\\u003c'), 'angle bracket must be unicode-escaped');
  // Exactly one opening and one closing script tag: the block itself.
  assert.equal((out.match(/<script/g) || []).length, 1);
  assert.equal((out.match(/<\/script>/g) || []).length, 1);
});

test('a hostile entity name cannot inject markup through structured data', () => {
  const html = page({
    site: SITE,
    title: 'x',
    description: 'x',
    content: '<p>x</p>',
    route: '/breach/x',
    structuredData: [breadcrumbList(SITE.origin, [{ name: '<img src=x onerror=alert(1)>' }])],
  });
  // The payload survives as escaped JSON text, never as a live element.
  assert.ok(!html.includes('<img src=x'), 'must not emit a live img element');
  assert.ok(html.includes('\\u003cimg'), 'payload must be present but escaped');
});

test('the ld+json block the build guard accepts contains no raw <', () => {
  // Mirrors LD_JSON_BLOCK in site/build.js: the guard only strips a block whose
  // payload has no '<' at all, so an unescaped payload still fails the build.
  const LD_JSON_BLOCK = /<script type="application\/ld\+json">[^<]*<\/script>/g;
  const good = jsonLd([{ name: 'Acme </script> Health' }]);
  assert.equal(good.replace(LD_JSON_BLOCK, '').includes('<script'), false, 'escaped block is recognized');

  const forged = '<script type="application/ld+json">{"a":"</script><script>x()</script>"}</script>';
  assert.ok(
    forged.replace(LD_JSON_BLOCK, '').includes('<script'),
    'an unescaped payload must still trip the guard'
  );
});

test('structured data is suppressed on noindex pages', () => {
  const html = page({
    site: SITE,
    title: '404',
    description: 'x',
    content: '<p>x</p>',
    route: '/404',
    structuredData: [breadcrumbList(SITE.origin, [{ name: 'Record', path: '/' }])],
  });
  assert.ok(html.includes('noindex'));
  assert.ok(!html.includes('application/ld+json'));
});

// The publisher identity is what makes this YMYL record attributable.
test('publisher names the legal entity and its postal address', () => {
  const org = publisher(SITE);
  assert.equal(org['@type'], 'Organization');
  assert.equal(org.name, 'Oak and Main Developers LLC');
  assert.equal(org.legalName, 'Oak and Main Developers LLC');
  assert.equal(org.address['@type'], 'PostalAddress');
  assert.equal(org.address.addressRegion, 'CA');
  assert.equal(org.address.postalCode, '95816');
  assert.equal(org.email, 'corrections@breachbook.org');
  assert.equal(org.publishingPrinciples, 'https://breachbook.org/sources/');
});

test('a nested publisher carries no @context of its own', () => {
  // Only the outermost node in a JSON-LD block declares @context.
  assert.ok(!('@context' in publisherNode(SITE)));
  assert.equal(publisherNode(SITE).name, 'Oak and Main Developers LLC');
});

test('the dataset credits the legal entity as creator and publisher', () => {
  const ds = dataset(SITE, [{ notification_date: '2026-01-01' }]);
  assert.equal(ds.creator.name, 'Oak and Main Developers LLC');
  assert.equal(ds.publisher.name, 'Oak and Main Developers LLC');
  assert.ok(!('@context' in ds.creator), 'nested nodes must not redeclare @context');
});

test('a site with no configured publisher still produces a valid dataset', () => {
  const { publisher: _omitted, ...bare } = SITE;
  assert.equal(publisher(bare), null);
  const ds = dataset(bare, []);
  assert.equal(ds.creator.name, 'BreachBook', 'falls back to the site name');
  assert.ok(!('publisher' in ds), 'no publisher node when none is configured');
});

test('emitted structured data is parseable JSON', () => {
  const html = page({
    site: SITE,
    title: 'x',
    description: 'x',
    content: '<p>x</p>',
    route: '/',
    structuredData: [dataset(SITE, [{ notification_date: '2026-01-01' }])],
  });
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'a block should be present');
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed['@context'], 'https://schema.org');
});
