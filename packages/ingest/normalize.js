// Normalization stage (spec section 4): map source-specific fields onto the
// breaches schema. Implemented per-source in Phase 1+; the canonical
// vocabularies live here so every parser maps into the same enums.

const SECTORS = ['healthcare', 'financial', 'retail', 'education', 'government', 'tech', 'other'];

const BREACH_VECTORS = ['hacking', 'insider', 'loss', 'improper_disposal', 'unknown'];

// Source-specific breach-type vocabularies -> canonical breach_vector.
// Extended per-source as parsers land (e.g. HHS OCR "Hacking/IT Incident").
const VECTOR_MAP = {
  'hacking/it incident': 'hacking',
  'unauthorized access/disclosure': 'hacking',
  theft: 'loss',
  loss: 'loss',
  'improper disposal': 'improper_disposal',
  unknown: 'unknown',
};

function mapVector(sourceValue) {
  if (!sourceValue) return 'unknown';
  return VECTOR_MAP[String(sourceValue).trim().toLowerCase()] || 'unknown';
}

function normalize() {
  throw new Error('normalize: per-source mapping lands in Phase 1 (hhs-ocr first)');
}

module.exports = { normalize, mapVector, SECTORS, BREACH_VECTORS, VECTOR_MAP };
