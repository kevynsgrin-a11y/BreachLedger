const test = require('node:test');
const assert = require('node:assert');
const { fetchBreachCsv, CookieJar } = require('./hhs-ocr-fetch');

const FRONT = `<html><form id="ocrForm" action="/ocr/breach/breach_report.jsf;jsessionid=ABC" enctype="multipart/form-data">
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt39':'ocrForm:j_idt39'},'');return false">View HIPAA Breach Reports</a>
<input type="hidden" name="javax.faces.ViewState" value="VS1"></form></html>`;

const GRID = `<html><form id="ocrForm" action="/ocr/breach/breach_report_hip.jsf" enctype="multipart/form-data">
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt384':'ocrForm:j_idt384'},'');return false"><img alt="CSV" src="/i/csv.png"></a>
<input type="hidden" name="javax.faces.ViewState" value="VS2"></form></html>`;

const CSV = 'Name of Covered Entity,State\nAcme Clinic,CA\n';
// What JSF returns when a postback is encoded in a way it does not decode:
// HTTP 200, re-rendered view, no error.
const RERENDER = '<html><body><p>re-rendered view, no commands</p></body></html>';

/**
 * Mock portal. `acceptEncoding` names the ONE encoding the server decodes;
 * every other encoding gets the silent 200-with-HTML re-render, which is the
 * real failure mode this fetcher exists to survive.
 */
function mockPortal({
  acceptEncoding = 'multipart',
  directGrid = GRID,
  frontBody = FRONT,
  navGrid = GRID,
  csvBody = CSV,
} = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const ct = (opts.headers && opts.headers['Content-Type']) || '';
    const enc = ct.startsWith('multipart/') ? 'multipart' : String(opts.body || '').includes('javax.faces.partial.ajax') ? 'ajax' : 'urlencoded';
    calls.push({ url, method, enc, body: opts.body });

    if (method === 'GET') {
      return { body: url.includes('breach_report_hip.jsf') ? directGrid : frontBody, checksum: 'c0', retrieved_at: 'T' };
    }
    if (enc !== acceptEncoding) return { body: RERENDER, checksum: 'x', retrieved_at: 'T' };
    // A navigation postback returns the grid; an export postback returns CSV.
    const isExport = String(opts.body || '').includes('j_idt384');
    return { body: isExport ? csvBody : navGrid, checksum: 'c9', retrieved_at: 'T' };
  };
  return { impl, calls };
}

test('primary path: direct grid, multipart export, two requests', async () => {
  const { impl, calls } = mockPortal();
  const { csv, steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(csv, CSV);
  assert.equal(steps.path, 'direct-grid');
  assert.equal(steps.encoding, 'multipart');
  assert.equal(steps.csvCommand, 'ocrForm:j_idt384');
  assert.equal(calls.length, 2);
});

test('falls through to urlencoded when the server rejects multipart', async () => {
  const { impl, calls } = mockPortal({ acceptEncoding: 'urlencoded' });
  const { csv, steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(csv, CSV);
  assert.equal(steps.encoding, 'urlencoded');
  // multipart attempted first, then urlencoded succeeded
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.enc).slice(0, 2), ['multipart', 'urlencoded']);
});

test('falls through to the AJAX variant when only that is decoded', async () => {
  const { impl } = mockPortal({ acceptEncoding: 'ajax' });
  const { csv, steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(csv, CSV);
  assert.equal(steps.encoding, 'ajax');
});

test('a 200-with-HTML re-render is treated as failure, never as success', async () => {
  // No encoding is accepted: every POST returns HTTP 200 with markup.
  const { impl } = mockPortal({ acceptEncoding: 'none-of-them' });
  await assert.rejects(
    () => fetchBreachCsv({ fetchImpl: impl }),
    (err) => {
      assert.match(err.message, /could not obtain the CSV export by any path or encoding/);
      assert.match(err.message, /not CSV/);
      return true;
    }
  );
});

test('falls back to front-page navigation when the direct grid has no exporter', async () => {
  const { impl, calls } = mockPortal({ directGrid: '<html><body>chrome only</body></html>' });
  const { csv, steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(csv, CSV);
  assert.match(steps.path, /^front-nav/);
  assert.ok(calls.some((c) => c.url.includes('breach_report.jsf')));
});

test('refuses to click a non-CSV exporter rather than downloading the wrong format', async () => {
  const xlsOnly = GRID.replace('alt="CSV" src="/i/csv.png"', 'alt="XLS" src="/i/excel.png"');
  const { impl } = mockPortal({ directGrid: xlsOnly, navGrid: xlsOnly, frontBody: '<html><body>none</body></html>' });
  await assert.rejects(() => fetchBreachCsv({ fetchImpl: impl }), /csvCommand=none/);
});

test('identifies the CSV icon by filename when alt is absent', async () => {
  const noAlt = GRID.replace('alt="CSV" ', '');
  const { impl } = mockPortal({ directGrid: noAlt });
  const { steps } = await fetchBreachCsv({ fetchImpl: impl });
  assert.equal(steps.csvCommand, 'ocrForm:j_idt384');
});

test('multipart body carries the ViewState and the command id', async () => {
  const { impl, calls } = mockPortal();
  await fetchBreachCsv({ fetchImpl: impl });
  const post = calls.find((c) => c.method === 'POST');
  assert.match(post.body, /name="javax\.faces\.ViewState"[\s\S]*VS2/);
  assert.match(post.body, /name="ocrForm:j_idt384"/);
});

test('error message enumerates every attempt for diagnosis', async () => {
  const { impl } = mockPortal({ acceptEncoding: 'none', directGrid: '<html>x</html>', frontBody: '<html>y</html>' });
  await assert.rejects(
    () => fetchBreachCsv({ fetchImpl: impl }),
    (err) => {
      assert.match(err.message, /direct-grid:/);
      assert.match(err.message, /front-page:/);
      return true;
    }
  );
});

test('cookie jar absorbs and replays Set-Cookie', () => {
  const jar = new CookieJar();
  jar.absorb({ headers: { getSetCookie: () => ['JSESSIONID=XYZ; Path=/; HttpOnly', 'other=1; Path=/'] } });
  const header = jar.header();
  assert.match(header, /JSESSIONID=XYZ/);
  assert.match(header, /other=1/);
  assert.ok(!header.includes('HttpOnly'));
});

const { fetchAllViews } = require('./hhs-ocr-fetch');

// Grid carrying both the CSV exporter and an Archive view toggle.
const GRID_WITH_TOGGLE = `<html><form id="ocrForm" action="/ocr/breach/breach_report_hip.jsf" enctype="multipart/form-data">
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt23':'ocrForm:j_idt23'},'');return false" id="ocrForm:underInvRptButton">Under Investigation</a>
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt24':'ocrForm:j_idt24'},'');return false" id="ocrForm:archiveRptButton">Archive</a>
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt400':'ocrForm:j_idt400'},'');return false"><img alt="CSV" src="/i/csv.png"></a>
<input type="hidden" name="javax.faces.ViewState" value="VS-GRID"></form></html>`;

const ARCHIVE_CSV = 'Name of Covered Entity,State\nOld Clinic,NY\n';

function mockTwoViewPortal() {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = String(opts.body || '');
    calls.push({ url, method, body });
    if (method === 'GET') return { body: GRID_WITH_TOGGLE, checksum: 'g', retrieved_at: 'T' };
    if (body.includes('j_idt24')) return { body: GRID_WITH_TOGGLE, checksum: 'a', retrieved_at: 'T' }; // toggled view
    if (body.includes('j_idt400')) {
      // Return the archive CSV once the toggle has been pressed at least once.
      const toggled = calls.some((c) => c.body && c.body.includes('j_idt24'));
      return { body: toggled ? ARCHIVE_CSV : CSV, checksum: 'c', retrieved_at: 'T' };
    }
    return { body: '<html>unexpected</html>', checksum: 'x', retrieved_at: 'T' };
  };
  return { impl, calls };
}

test('fetches both the under-investigation and archive views', async () => {
  const { impl } = mockTwoViewPortal();
  const views = await fetchAllViews({ fetchImpl: impl });
  assert.equal(views.length, 2);
  assert.equal(views[0].view, 'under_investigation');
  assert.equal(views[0].csv, CSV);
  assert.equal(views[1].view, 'archive');
  assert.equal(views[1].csv, ARCHIVE_CSV);
  assert.equal(views[1].steps.toggle, 'ocrForm:j_idt24');
});

test('archive view is fetched from a fresh grid, not a reused ViewState', async () => {
  const { impl, calls } = mockTwoViewPortal();
  await fetchAllViews({ fetchImpl: impl });
  // At least two GETs of the grid: one per view.
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url.includes('breach_report_hip')).length >= 2);
});

test('refuses to publish a partial record when the Archive toggle is missing', async () => {
  const noToggle = GRID_WITH_TOGGLE.replace(/<a[^>]*archiveRptButton[\s\S]*?<\/a>/i, '');
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET') return { body: noToggle, checksum: 'g', retrieved_at: 'T' };
    return { body: CSV, checksum: 'c', retrieved_at: 'T' };
  };
  await assert.rejects(
    () => fetchAllViews({ fetchImpl: impl }),
    /no Archive view toggle[\s\S]*refusing to publish only the last ~24 months/i
  );
});

test('coverage=current downgrades a missing archive to a warning, not a silent pass', async () => {
  const noToggle = GRID_WITH_TOGGLE.replace(/<a[^>]*archiveRptButton[\s\S]*?<\/a>/i, '');
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET') return { body: noToggle, checksum: 'g', retrieved_at: 'T' };
    return { body: CSV, checksum: 'c', retrieved_at: 'T' };
  };
  const views = await fetchAllViews({ fetchImpl: impl, requireArchive: false });
  // The recent view is still returned, and the archive is simply absent —
  // never fabricated, never silently counted as captured.
  assert.equal(views.length, 1);
  assert.equal(views[0].view, 'under_investigation');
});
