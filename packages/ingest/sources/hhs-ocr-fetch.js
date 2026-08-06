// Drives the HHS OCR portal's JSF form sequence to obtain the breach CSV.
//
// Sequence (see hhs-jsf.js for why nothing is hardcoded):
//   1. GET  the front page          -> cookies (JSESSIONID) + ViewState
//   2. POST "View HIPAA Breach Reports" -> the data grid + a NEW ViewState
//   3. POST the CSV export command  -> text/csv
//
// Every step verifies what it got and throws with a diagnosable excerpt
// otherwise. A silent fallback here would publish an empty or partial record
// set as though it were the complete government record, which is the single
// worst failure mode this project has.

const { politeFetch, USER_AGENT } = require('../fetch-util');
const jsf = require('./hhs-jsf');

const BASE = 'https://ocrportal.hhs.gov/ocr/breach/';
const FRONT_PAGE = `${BASE}breach_report.jsf`;
// The data grid. Fetching it directly is the primary path (two requests);
// navigating from the front page is the fallback, and was observed to land on
// a chrome page carrying no JSF commands at all.
const GRID_PAGE = `${BASE}breach_report_hip.jsf`;
const GRID_LABEL = 'View HIPAA Breach Reports';

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorb(response) {
    // Node exposes repeated Set-Cookie headers via getSetCookie().
    const raw = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const line of raw) {
      const pair = String(line).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function assertCsv(body, csvCommand) {
  if (/^\s*</.test(body) || /<html/i.test(body.slice(0, 500))) {
    throw new Error(
      `hhs_ocr: expected CSV, received HTML (session expiry or wrong command id ` +
        `${csvCommand}). Excerpt: ${jsf.excerpt(body)}`
    );
  }
  if (!/,/.test(body.split('\n')[0] || '')) {
    throw new Error(`hhs_ocr: response has no comma-delimited header row. Excerpt: ${jsf.excerpt(body)}`);
  }
}

function assertHtml(text, step) {
  if (!/<html|<form/i.test(text)) {
    throw new Error(`hhs_ocr ${step}: expected an HTML page, got: ${jsf.excerpt(text)}`);
  }
}

/**
 * @returns {{csv: string, steps: object}} raw CSV text plus what was discovered,
 *   so the run log records which command ids this deployment actually used.
 */
async function fetchBreachCsv({ fetchImpl = politeFetch } = {}) {
  const jar = new CookieJar();
  const steps = {};
  const attempts = [];

  // --- Primary path: fetch the grid directly ------------------------------
  {
    const direct = await fetchImpl(GRID_PAGE, { raw: true, jar });
    const hidden = jsf.extractHiddenInputs(direct.body);
    const csvCommand = jsf.findCsvExportCommand(direct.body);
    if (jsf.extractViewState(hidden) && csvCommand) {
      steps.path = 'direct';
      steps.csvCommand = csvCommand;
      const action = new URL(jsf.extractFormAction(direct.body) || GRID_PAGE, GRID_PAGE).toString();
      const csv = await fetchImpl(action, {
        raw: true,
        jar,
        method: 'POST',
        body: jsf.buildCommandBody(hidden, csvCommand),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      assertCsv(csv.body, csvCommand);
      steps.bytes = csv.body.length;
      steps.checksum = csv.checksum;
      steps.retrieved_at = csv.retrieved_at;
      return { csv: csv.body, steps };
    }
    attempts.push(
      `direct GET ${GRID_PAGE}: ${direct.body.length} bytes, ` +
        `viewState=${Boolean(jsf.extractViewState(hidden))}, csvCommand=${csvCommand || 'none'}, ` +
        `commands=${jsf.listCommandCandidates(direct.body).length}`
    );
  }

  // --- Fallback path: navigate from the front page ------------------------
  // --- Step 1: front page -------------------------------------------------
  const front = await fetchImpl(FRONT_PAGE, { raw: true, jar });
  assertHtml(front.body, 'step 1 (front page)');
  const frontHidden = jsf.extractHiddenInputs(front.body);
  const frontViewState = jsf.extractViewState(frontHidden);
  if (!frontViewState) {
    throw new Error(
      `hhs_ocr step 1: no javax.faces.ViewState on ${FRONT_PAGE}. The portal may have been ` +
        `redesigned or is serving an error page. Excerpt: ${jsf.excerpt(front.body)}`
    );
  }
  const gridCommand = jsf.findCommandByLabel(front.body, GRID_LABEL);
  if (!gridCommand) {
    throw new Error(
      `hhs_ocr step 1: could not find the "${GRID_LABEL}" command link. The label may have ` +
        `changed. Excerpt: ${jsf.excerpt(front.body)}`
    );
  }
  steps.gridCommand = gridCommand;
  const frontAction = new URL(jsf.extractFormAction(front.body) || FRONT_PAGE, FRONT_PAGE).toString();

  // --- Step 2: the data grid ---------------------------------------------
  const grid = await fetchImpl(frontAction, {
    raw: true,
    jar,
    method: 'POST',
    body: jsf.buildCommandBody(frontHidden, gridCommand),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assertHtml(grid.body, 'step 2 (grid)');
  const gridHidden = jsf.extractHiddenInputs(grid.body);
  if (!jsf.extractViewState(gridHidden)) {
    throw new Error(`hhs_ocr step 2: grid page carried no ViewState. Excerpt: ${jsf.excerpt(grid.body)}`);
  }
  const csvCommand = jsf.findCsvExportCommand(grid.body);
  if (!csvCommand) {
    // Dump what the page actually offers rather than a generic excerpt: the
    // portal is on PrimeFaces 12, whose exporters are icon-font elements, and
    // a redesign is exactly the case this error needs to make diagnosable.
    const candidates = jsf.listCommandCandidates(grid.body);
    const diag = jsf.exportDiagnostics(grid.body);
    throw new Error(
      'hhs_ocr: no CSV export control found by either path. Refusing to guess and ' +
        'download the wrong format.\n' +
        `  attempts: ${attempts.join(' | ')}\n` +
        `  page bytes: ${grid.body.length}\n` +
        `  JSF commands found (${candidates.length}):\n` +
        candidates.map((c) => `    - ${c.commandId} label="${c.label}" attrs=${c.attrs}`).join('\n') +
        `\n  markup mentioning csv/export (${diag.length}):\n` +
        diag.map((d) => `    - ${d}`).join('\n')
    );
  }
  steps.csvCommand = csvCommand;
  const gridAction = new URL(jsf.extractFormAction(grid.body) || frontAction, frontAction).toString();

  // --- Step 3: the CSV export --------------------------------------------
  const csv = await fetchImpl(gridAction, {
    raw: true,
    jar,
    method: 'POST',
    body: jsf.buildCommandBody(gridHidden, csvCommand),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  assertCsv(csv.body, csvCommand);

  steps.path = 'front-page-navigation';
  steps.bytes = csv.body.length;
  steps.checksum = csv.checksum;
  steps.retrieved_at = csv.retrieved_at;
  return { csv: csv.body, steps };
}

module.exports = { fetchBreachCsv, CookieJar, FRONT_PAGE, GRID_LABEL, USER_AGENT };
