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

// The grid shows one of two views at a time. "Under Investigation" holds only
// the last ~24 months; everything older lives in "Archive". Both are required
// for the complete record — publishing only the recent view would present a
// two-year slice as though it were the full government record.
const ARCHIVE_PATTERN = /archive/i;

/**
 * Fetch every view of the breach report.
 *
 * Each view is fetched from a FRESH grid page rather than by reusing the
 * previous page's ViewState: a JSF ViewState is tied to the view it was
 * rendered for, and reusing one across a toggle is how these scrapers
 * silently end up exporting the same view twice.
 *
 * @returns {Array<{view, csv, checksum, retrieved_at, steps}>}
 */
async function fetchAllViews({ fetchImpl = politeFetch, requireArchive = true } = {}) {
  const views = [];

  // View 1: whatever the grid shows by default (Under Investigation).
  const current = await fetchBreachCsv({ fetchImpl });
  views.push({ view: 'under_investigation', csv: current.csv, checksum: current.steps.checksum, retrieved_at: current.steps.retrieved_at, steps: current.steps });

  // View 2: Archive, reached by toggling on a freshly loaded grid.
  const jar = new CookieJar();
  const attempts = [];
  const grid = await fetchImpl(GRID_PAGE, { raw: true, jar });
  // Discovery aid: what other portal pages exist, for locating the archive.
  const linked = jsf.linkedPages(grid.body);
  if (linked.length) console.error(`hhs_ocr: .jsf pages linked from the grid: ${linked.join(' | ')}`);
  const gridHidden = jsf.extractHiddenInputs(grid.body);
  const toggle = jsf.findCommandMatching(grid.body, ARCHIVE_PATTERN);
  if (!toggle) {
    // The archive is not an in-page toggle on this URL. Report every command
    // AND every linked .jsf page, so the archive's real location is
    // identifiable from one run rather than guessed at.
    const err = new Error(
      'hhs_ocr: no Archive view toggle on the grid page. The archived records are reached ' +
        'some other way; refusing to publish only the last ~24 months as though it were the ' +
        'complete record.\n' +
        '  JSF commands on the grid:\n' +
        jsf.listCommandCandidates(grid.body).map((c) => `    - ${c.commandId} label="${c.label}"`).join('\n') +
        '\n  .jsf pages linked from the grid:\n' +
        jsf.linkedPages(grid.body).map((l) => `    - ${l}`).join('\n')
    );
    err.archiveNotFound = true;
    if (requireArchive) throw err;
    // Documented partial coverage: the caller has accepted that this run
    // captures only the recent view, and the site states that coverage
    // explicitly on /sources. Still logged at full volume.
    console.error(`hhs_ocr: WARNING archive view not captured.\n${err.message}`);
    return views;
  }
  const gridAction = new URL(jsf.extractFormAction(grid.body) || GRID_PAGE, GRID_PAGE).toString();

  let archived = null;
  for (const enc of jsf.commandEncodings(gridHidden, toggle)) {
    const toggled = await fetchImpl(gridAction, {
      raw: true,
      jar,
      method: 'POST',
      body: enc.body,
      headers: { 'Content-Type': enc.contentType },
    });
    const candidate = await exportFromPage({
      fetchImpl, jar, pageUrl: gridAction, pageBody: toggled.body, attempts, pathName: `archive[${enc.name}]`,
    });
    if (candidate) { archived = candidate; break; }
  }
  if (!archived) {
    const err = new Error(
      'hhs_ocr: found the Archive toggle but could not export from the archived view.\n' +
        attempts.map((a) => `  - ${a}`).join('\n')
    );
    err.archiveNotFound = true;
    if (requireArchive) throw err;
    console.error(`hhs_ocr: WARNING archive view not captured.\n${err.message}`);
    return views;
  }
  views.push({
    view: 'archive',
    csv: archived.csv.body,
    checksum: archived.csv.checksum,
    retrieved_at: archived.csv.retrieved_at,
    steps: { path: archived.path, encoding: archived.encoding, csvCommand: archived.commandId, toggle, bytes: archived.csv.body.length },
  });

  return views;
}

module.exports = { fetchBreachCsv, fetchAllViews, CookieJar, FRONT_PAGE, GRID_PAGE, GRID_LABEL, ARCHIVE_PATTERN, USER_AGENT };
