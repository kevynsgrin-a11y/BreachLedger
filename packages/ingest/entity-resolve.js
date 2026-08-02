// Entity resolution (spec section 4): deterministic name normalization plus a
// manual alias map for known parent/subsidiary relationships.

const fs = require('fs');
const path = require('path');

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'corp', 'corporation', 'co',
  'company', 'ltd', 'limited', 'pc', 'pa', 'plc', 'pllc',
]);

/**
 * Normalize an entity name: lowercase, strip punctuation, strip trailing legal
 * suffixes (repeatedly, so "Acme Corp., Inc." fully reduces), collapse
 * whitespace.
 */
function normalizeEntityName(name) {
  if (!name) return '';
  let tokens = String(name)
    .toLowerCase()
    .replace(/\./g, '') // keep abbreviated suffixes one token: "P.C." -> "pc"
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

let aliasMap = null;
function loadAliasMap() {
  if (aliasMap) return aliasMap;
  const p = path.join(__dirname, '..', 'schema', 'seed', 'entity-aliases.json');
  const { aliases } = JSON.parse(fs.readFileSync(p, 'utf8'));
  aliasMap = new Map();
  for (const [canonical, list] of Object.entries(aliases)) {
    for (const alias of list) aliasMap.set(alias, canonical);
  }
  return aliasMap;
}

/** Resolve a raw entity name to its canonical normalized form. */
function resolveEntity(rawName) {
  const normalized = normalizeEntityName(rawName);
  return loadAliasMap().get(normalized) || normalized;
}

module.exports = { normalizeEntityName, resolveEntity, LEGAL_SUFFIXES };
