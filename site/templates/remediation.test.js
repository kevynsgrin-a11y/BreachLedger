const test = require('node:test');
const assert = require('node:assert/strict');

const { render } = require('./remediation');

const SITE = {
  name: 'BreachBook',
  tagline: 'A public record of disclosed U.S. data breaches',
  origin: 'https://breachbook.org',
  language: 'en-US',
};

const DATA_CLASS_MAP = {
  ssn: { code: 'ssn', label: 'Social Security number', permanence: 'permanent' },
  medical: { code: 'medical', label: 'Medical records or diagnoses', permanence: 'permanent' },
};

const MODULES = [
  {
    slug: 'credit-freeze',
    title: 'Place a Security Freeze at All Three Credit Bureaus',
    applies_to: ['ssn'],
    priority: 1,
    body_md: 'A security freeze restricts access to your credit file.\n\n1. Place a freeze with each bureau.\n2. Record the PIN.',
    source_url: 'https://consumer.ftc.gov/articles/credit-freezes-and-fraud-alerts',
    last_verified: '2026-08-02',
  },
];

const BREACH = {
  slug: 'acme-health-2026-01',
  entity_name: 'Acme Health',
  data_classes_parsed: ['ssn'],
  notification_date: '2026-01-15',
};

function build(overrides = {}) {
  return render({
    site: SITE,
    assets: {},
    dataClassMap: DATA_CLASS_MAP,
    breach: BREACH,
    modules: MODULES,
    ...overrides,
  });
}

test('renders each applicable module with its title and body', () => {
  const html = build();
  assert.ok(html.includes('Place a Security Freeze at All Three Credit Bureaus'));
  assert.ok(html.includes('security freeze restricts access'));
});

test('attributes every module to the agency page it came from, with a date', () => {
  const html = build();
  assert.ok(html.includes('https://consumer.ftc.gov/articles/credit-freezes-and-fraud-alerts'));
  assert.ok(html.includes('consumer.ftc.gov'));
  assert.ok(html.includes('verified August 2, 2026'));
});

test('says which exposed category caused a module to be listed', () => {
  assert.ok(build().includes('Social Security number'));
});

// docs/EDITORIAL.md: no legal advice, and never imply the reader is affected.
test('carries the not-legal-advice and not-a-law-firm disclaimer', () => {
  const html = build();
  assert.ok(/not legal advice/i.test(html));
  assert.ok(/not a law firm/i.test(html));
});

test('does not assert that the reader was affected', () => {
  const html = build();
  assert.ok(
    /not a statement that\s+any particular person was affected/i.test(html.replace(/\s+/g, ' ')),
    'the page must state plainly that it does not establish who was affected'
  );
});

test('uses no banned legal-advice construction', () => {
  const html = build().toLowerCase();
  for (const banned of ['you are entitled to', 'we can file for you', 'you should sue', 'you should ']) {
    assert.ok(!html.includes(banned), `banned construction present: "${banned}"`);
  }
});

test('escapes a hostile entity name', () => {
  const html = build({ breach: { ...BREACH, entity_name: '<script>alert(1)</script>' } });
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('links back to the record and to the state reference', () => {
  const html = build();
  assert.ok(html.includes(`/breach/${BREACH.slug}/`));
  assert.ok(html.includes('/rights/'));
});

test('canonical route is the what-to-do path', () => {
  assert.ok(build().includes(`<link rel="canonical" href="https://breachbook.org/breach/${BREACH.slug}/what-to-do/">`));
});

test('emits a breadcrumb structured-data block', () => {
  const html = build();
  assert.ok(html.includes('application/ld+json'));
  assert.ok(html.includes('BreadcrumbList'));
});
