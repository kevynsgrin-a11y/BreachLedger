// Drives the HHS OCR portal's JSF form sequence to obtain the breach CSV.
//
// There is no static CSV URL. The export lives behind a cookie-bound JSF
// postback whose ViewState changes at every step and whose element ids are
// Mojarra-generated, so nothing here may be hardcoded.
//
// The single most important rule in this file: SUCCESS IS JUDGED BY WHETHER
// THE BODY IS CSV, NEVER BY STATUS CODE. If a JSF postback is encoded in a way
// the server's filter does not decode, JSF does not error — it re-renders the
// view and returns HTTP 200 with HTML. A status-code check would read that as
// success and hand a page of markup to the CSV parser.
//
// Encodings are therefore attempted in order of evidential support
// (multipart first: the only genuine capture of this form declares
// enctype="multipart/form-data"), and each attempt is accepted only if what
// comes back actually looks like CSV.

const { politeFetch, USER_AGENT } = require('../fetch-util');
const jsf = require('./hhs-jsf');

const BASE = 'https://ocrportal.hhs.gov/ocr/breach/';
const FRONT_PAGE = `${BASE}breach_report.jsf`;
const GRID_PAGE = `${BASE}breach_report_hip.jsf`;
const GRID_LABEL = 'View HIPAA Breach Reports';

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorb(response) {
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

/**
 * POST the export command, trying each encoding until one returns something
 * that is actually CSV. Returns the CSV response, or null with the attempts
 * recorded for diagnosis.
 */
async function postExport({ fetchImpl, jar, action, hidden, commandId, attempts }) {
  for (const enc of jsf.commandEncodings(hidden, commandId)) {
    let res;
    try {
      res = await fetchImpl(action, {
        raw: true,
        jar,
        method: 'POST',
        body: enc.body,
        headers: { 'Content-Type': enc.contentType },
      });
    } catch (err) {
      attempts.push(`export[${enc.name}]: request failed: ${err.message}`);
      continue;
    }
    if (jsf.looksLikeCsv(res.body)) {
      return { res, encoding: enc.name };
    }
    attempts.push(
      `export[${enc.name}]: ${res.body.length} bytes, not CSV (${jsf.excerpt(res.body, 120)})`
    );
  }
  return null;
}

/** Try to obtain the export from a page that already contains the exporter. */
async function exportFromPage({ fetchImpl, jar, pageUrl, pageBody, attempts, pathName }) {
  const hidden = jsf.extractHiddenInputs(pageBody);
  const viewState = jsf.extractViewState(hidden);
  const commandId = jsf.findCsvExportCommand(pageBody);
  if (!viewState || !commandId) {
    attempts.push(
      `${pathName}: ${pageBody.length} bytes, viewState=${Boolean(viewState)}, ` +
        `csvCommand=${commandId || 'none'}, commands=${jsf.listCommandCandidates(pageBody).length}`
    );
    return null;
  }
  const action = new URL(jsf.extractFormAction(pageBody) || pageUrl, pageUrl).toString();
  const got = await postExport({ fetchImpl, jar, action, hidden, commandId, attempts });
  if (!got) return null;
  return { csv: got.res, commandId, encoding: got.encoding, path: pathName };
}

async function fetchBreachCsv({ fetchImpl = politeFetch } = {}) {
  const jar = new CookieJar();
  const attempts = [];

  // --- Primary: the data grid, fetched directly --------------------------
  const direct = await fetchImpl(GRID_PAGE, { raw: true, jar });
  let result = await exportFromPage({
    fetchImpl, jar, pageUrl: GRID_PAGE, pageBody: direct.body, attempts, pathName: 'direct-grid',
  });

  // --- Fallback: navigate from the front page ----------------------------
  if (!result) {
    const front = await fetchImpl(FRONT_PAGE, { raw: true, jar });
    const frontHidden = jsf.extractHiddenInputs(front.body);
    const gridCommand = jsf.findCommandByLabel(front.body, GRID_LABEL);
    if (jsf.extractViewState(frontHidden) && gridCommand) {
      const frontAction = new URL(jsf.extractFormAction(front.body) || FRONT_PAGE, FRONT_PAGE).toString();
      // The navigation postback needs a decodable encoding too, for exactly the
      // same reason the export does.
      for (const enc of jsf.commandEncodings(frontHidden, gridCommand)) {
        const grid = await fetchImpl(frontAction, {
          raw: true,
          jar,
          method: 'POST',
          body: enc.body,
          headers: { 'Content-Type': enc.contentType },
        });
        const candidate = await exportFromPage({
          fetchImpl,
          jar,
          pageUrl: frontAction,
          pageBody: grid.body,
          attempts,
          pathName: `front-nav[${enc.name}]`,
        });
        if (candidate) { result = candidate; break; }
      }
    } else {
      attempts.push(
        `front-page: viewState=${Boolean(jsf.extractViewState(frontHidden))}, ` +
          `gridCommand=${gridCommand || 'none'}, commands=${jsf.listCommandCandidates(front.body).length}`
      );
    }
  }

  if (!result) {
    const diag = jsf.exportDiagnostics(direct.body);
    throw new Error(
      'hhs_ocr: could not obtain the CSV export by any path or encoding. Refusing to publish a ' +
        'partial or wrong-format record set.\n' +
        attempts.map((a) => `  - ${a}`).join('\n') +
        `\n  markup mentioning csv/export on the direct grid (${diag.length}):\n` +
        diag.slice(0, 15).map((d) => `    - ${d}`).join('\n')
    );
  }

  return {
    csv: result.csv.body,
    steps: {
      path: result.path,
      encoding: result.encoding,
      csvCommand: result.commandId,
      bytes: result.csv.body.length,
      checksum: result.csv.checksum,
      retrieved_at: result.csv.retrieved_at,
      attemptsBeforeSuccess: attempts.length,
    },
  };
}

module.exports = { fetchBreachCsv, CookieJar, FRONT_PAGE, GRID_PAGE, GRID_LABEL, USER_AGENT };
