const test = require('node:test');
const assert = require('node:assert');
const { normalizeEntityName } = require('./entity-resolve');

test('lowercases, strips punctuation, collapses whitespace', () => {
  assert.equal(normalizeEntityName('  Acme   Health\tSystems  '), 'acme health systems');
  assert.equal(normalizeEntityName("St. Mary's Medical Center"), 'st mary s medical center');
});

test('strips legal suffixes, repeatedly', () => {
  assert.equal(normalizeEntityName('Acme Corp'), 'acme');
  assert.equal(normalizeEntityName('Acme Holdings, LLC'), 'acme holdings');
  assert.equal(normalizeEntityName('Acme Co., Inc.'), 'acme');
  assert.equal(normalizeEntityName('Smith & Jones, P.C.'), 'smith jones');
});

test('does not strip a suffix that is the whole name', () => {
  assert.equal(normalizeEntityName('Inc'), 'inc');
});

test('same breach entity converges across source spellings', () => {
  const hhs = normalizeEntityName('CONTOSO HEALTH NETWORK, INC.');
  const maine = normalizeEntityName('Contoso Health Network');
  assert.equal(hhs, maine);
});
