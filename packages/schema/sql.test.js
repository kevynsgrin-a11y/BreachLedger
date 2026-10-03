// sql.js is the single security-critical function both the seed loader and the
// ingest writer interpolate through. The sibling defence-in-depth suite
// (ingest/sql-injection.test.js) proves a payload cannot escape a writer
// statement; these tests pin the escaping rules themselves.
//
// The escaping was originally audited by executing hostile values against a
// real SQLite engine, so it is executed against one here too. A structural
// assertion on the string can only show what the function emitted; a round
// trip shows what SQLite actually stored.

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { sqlLiteral } = require('./sql');

const db = new DatabaseSync(':memory:');

/** Store `value` as a literal and read back what SQLite actually persisted. */
function roundTrip(value) {
  const row = db.prepare(`SELECT ${sqlLiteral(value)} AS v`).get();
  return row.v;
}

// Built at runtime so no NUL byte is ever written into this source file.
const NUL = String.fromCharCode(0);

// --- Structural rules -----------------------------------------------------

test('a plain string becomes a single-quoted literal', () => {
  assert.equal(sqlLiteral('Acme Health'), "'Acme Health'");
});

test('a single quote is doubled, which is SQLite\'s only string escape', () => {
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
});

test('a backslash is not an escape character and must not be doubled', () => {
  // Doubling backslashes here would corrupt every stored URL and statute cite.
  assert.equal(sqlLiteral('a\\b'), "'a\\b'");
  assert.equal(sqlLiteral("' OR 1=1 --"), "''' OR 1=1 --'");
});

test('an empty string stays an empty string, not NULL', () => {
  // These are different values with different meanings: '' is "known to be
  // blank", NULL is "not disclosed". Collapsing them would fabricate a
  // disclosure the source never made.
  assert.equal(sqlLiteral(''), "''");
  assert.equal(roundTrip(''), '');
  assert.equal(roundTrip(null), null);
});

test('null and undefined become NULL rather than the text "null"', () => {
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(undefined), 'NULL');
});

test('numbers are emitted unquoted, so SQLite stores them as numbers', () => {
  assert.equal(sqlLiteral(1200), '1200');
  assert.equal(sqlLiteral(0), '0');
  assert.equal(sqlLiteral(-5), '-5');
  assert.equal(typeof roundTrip(1200), 'number');
});

test('booleans are emitted as 1 and 0, matching SQLite\'s integer storage', () => {
  // SQLite has no boolean type: a value can only be stored as integer 0 or 1.
  assert.equal(sqlLiteral(true), '1');
  assert.equal(sqlLiteral(false), '0');
  assert.equal(roundTrip(true), 1);
  assert.equal(roundTrip(false), 0);
});

test('non-finite numbers become NULL, because SQLite cannot store them', () => {
  // Emitting NaN or Infinity would be a syntax error mid-batch, after earlier
  // statements had already been committed.
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.equal(sqlLiteral(v), 'NULL', `${v} should serialize as NULL`);
  }
});

// --- What SQLite actually stores ------------------------------------------
// A structural assertion cannot catch a wrong-but-well-formed literal, so the
// rest asserts the value that comes back out of the engine.

test('a quote round-trips as exactly one quote', () => {
  assert.equal(roundTrip("O'Brien"), "O'Brien");
  assert.equal(roundTrip("''"), "''");
  assert.equal(roundTrip("'''"), "'''");
});

test('a breakout payload round-trips as inert text, one statement', () => {
  const payload = "x'); DROP TABLE breaches;--";
  assert.equal(roundTrip(payload), payload);
});

test('an embedded newline round-trips unchanged', () => {
  // Statute citations and the _notes fields carry multi-line text.
  assert.equal(roundTrip('line1\nline2'), 'line1\nline2');
  assert.equal(roundTrip('a\r\nb'), 'a\r\nb');
});

test('an embedded NUL cannot round-trip; SQLite rejects the whole statement', () => {
  // A deliberate boundary of this escaping, pinned here. SQLite parses a string
  // literal as a NUL-terminated C string, so a NUL byte closes it early and the
  // statement is a syntax error. sqlLiteral doubles quotes because that is the
  // only escape SQLite has, and there is no escape for NUL.
  //
  // Worth knowing precisely: a NUL fails that statement loudly rather than
  // silently truncating the stored value, so it cannot corrupt a row quietly.
  // No seeded value and no OCR field contains one.
  assert.equal(sqlLiteral(`a${NUL}b`), `'a${NUL}b'`);
  assert.throws(
    () => roundTrip(`a${NUL}b`),
    (err) => err.code === 'ERR_SQLITE_ERROR'
  );
});

test('non-ASCII round-trips as UTF-8, not as mojibake', () => {
  // Statute citations and state names carry section signs and em dashes.
  const cite = 'Alaska Stat. § 45.48.010 — PII';
  assert.equal(roundTrip(cite), cite);
});

test('a JSON payload round-trips byte-for-byte, so raw_payload survives', () => {
  const raw = JSON.stringify({ note: "it's fine", n: 1 });
  assert.equal(roundTrip(raw), raw);
});

test('the table the breakout payload names is still there afterwards', () => {
  // The end-to-end statement of the property: the payload did not execute.
  db.exec('CREATE TABLE IF NOT EXISTS breaches (id TEXT)');
  db.exec(`INSERT INTO breaches (id) VALUES (${sqlLiteral("x'); DROP TABLE breaches;--")})`);
  const n = db.prepare('SELECT COUNT(*) AS n FROM breaches').get().n;
  assert.equal(n, 1);
  db.exec('DROP TABLE breaches');
});

test('every literal it emits is accepted as valid SQL', () => {
  // Catches a value class that would break a whole batch mid-write.
  const values = [
    'plain', "quote'd", 'back\\slash', '', 'tab\there', 'new\nline', 'null-ish',
    'ünïcodé', 'a"b', 0, -1, 12.5, true, false,
  ];
  for (const v of values) {
    assert.doesNotThrow(
      () => db.prepare(`SELECT ${sqlLiteral(v)} AS v`).get(),
      `emitted invalid SQL for ${JSON.stringify(v)}`
    );
  }
});
