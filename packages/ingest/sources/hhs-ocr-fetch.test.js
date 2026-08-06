const test = require('node:test');
const assert = require('node:assert');
const { fetchBreachCsv, CookieJar } = require('./hhs-ocr-fetch');

const FRONT = `<html><form id="ocrForm" action="/ocr/breach/breach_report.jsf;jsessionid=ABC">
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt39':'ocrForm:j_idt39'},'');return false">View HIPAA Breach Reports</a>
<input type="hidden" name="javax.faces.ViewState" value="VS1"></form></html>`;

const GRID = `<html><form id="ocrForm" action="/ocr/breach/breach_report_hip.jsf">
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt384':'ocrForm:j_idt384'},'');return false"><img alt="CSV" src="/i/csv.png"></a>
<input type="hidden" name="javax.faces.ViewState" value="VS2"></form></html>`;

const CSV = 'Name of Covered Entity,State\nAcme Clinic,CA\n';

/** Mock portal that records the request sequence. */
function mockPortal({ csvBody = CSV, gridBody = GRID, frontBody = FRONT } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (calls.length === 1) return { body: frontBody, checksum: 'c1', retrieved_at: 'T' };
    if (calls.length === 2) return { body: gridBody, checksum: 'c2', retrieved_at: 'T' };
    return { body: csvBody, checksum: 'c3', retrieved_at: 'T' };
  };
  return { impl, calls };
}

test('drives the three-step sequence and returns CSV', async () => {
  const { impl, calls } = mockPortal();
  const { csv, steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(csv, CSV);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[2].method, 'POST');
  assert.equal(steps.gridCommand, 'ocrForm:j_idt39');
  assert.equal(steps.csvCommand, 'ocrForm:j_idt384');
});

test('carries the discovered command id and ViewState in each POST body', async () => {
  const { impl, calls } = mockPortal();
  await fetchBreachCsv({ fetchImpl: impl });
  const grid = new URLSearchParams(calls[1].body);
  assert.equal(grid.get('javax.faces.ViewState'), 'VS1');
  assert.equal(grid.get('ocrForm:j_idt39'), 'ocrForm:j_idt39');
  const csv = new URLSearchParams(calls[2].body);
  // The SECOND ViewState, not the first — reusing VS1 would be rejected.
  assert.equal(csv.get('javax.faces.ViewState'), 'VS2');
  assert.equal(csv.get('ocrForm:j_idt384'), 'ocrForm:j_idt384');
});

test('resolves the form action relative to the portal, preserving jsessionid', async () => {
  const { impl, calls } = mockPortal();
  await fetchBreachCsv({ fetchImpl: impl });
  assert.match(calls[1].url, /^https:\/\/ocrportal\.hhs\.gov\/ocr\/breach\/breach_report\.jsf;jsessionid=ABC$/);
  assert.match(calls[2].url, /breach_report_hip\.jsf$/);
});

test('throws a diagnosable error when the grid label is gone', async () => {
  const { impl } = mockPortal({ frontBody: FRONT.replace('View HIPAA Breach Reports', 'Something Else') });
  await assert.rejects(() => fetchBreachCsv({ fetchImpl: impl }), /could not find the "View HIPAA Breach Reports" command/);
});

test('throws when no ViewState is present', async () => {
  const { impl } = mockPortal({ frontBody: FRONT.replace(/<input[^>]*ViewState[^>]*>/, '') });
  await assert.rejects(() => fetchBreachCsv({ fetchImpl: impl }), /no javax.faces.ViewState/);
});

test('refuses to guess when the CSV exporter is missing, rather than downloading another format', async () => {
  // Grid offering only an Excel exporter: neither the alt text nor the icon
  // filename indicates CSV, so there is nothing safe to click.
  const xlsOnly = GRID.replace('alt="CSV" src="/i/csv.png"', 'alt="XLS" src="/i/excel.png"');
  const { impl } = mockPortal({ gridBody: xlsOnly });
  await assert.rejects(() => fetchBreachCsv({ fetchImpl: impl }), /no CSV export control found/);
});

test('identifies the CSV icon by filename when the alt attribute is absent', async () => {
  const noAlt = GRID.replace('alt="CSV" ', '');
  const { impl } = mockPortal({ gridBody: noAlt });
  const { steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(steps.csvCommand, 'ocrForm:j_idt384');
});

test('detects an HTML response where CSV was expected (session expiry)', async () => {
  const { impl } = mockPortal({ csvBody: '<html><body>Session expired</body></html>' });
  await assert.rejects(() => fetchBreachCsv({ fetchImpl: impl }), /expected CSV, received HTML/);
});

test('rejects a response with no comma-delimited header row', async () => {
  const { impl } = mockPortal({ csvBody: 'not a csv at all\n' });
  await assert.rejects(() => fetchBreachCsv({ fetchImpl: impl }), /no comma-delimited header row/);
});

test('cookie jar absorbs and replays Set-Cookie', () => {
  const jar = new CookieJar();
  jar.absorb({ headers: { getSetCookie: () => ['JSESSIONID=XYZ; Path=/; HttpOnly', 'other=1; Path=/'] } });
  const header = jar.header();
  assert.match(header, /JSESSIONID=XYZ/);
  assert.match(header, /other=1/);
  assert.ok(!header.includes('HttpOnly'));
});
