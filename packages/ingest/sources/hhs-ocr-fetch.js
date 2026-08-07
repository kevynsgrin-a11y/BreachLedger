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
const tv = require('./hhs-tabview');

const BASE = 'https://ocrportal.hhs.gov/ocr/breach/';
const FRONT_PAGE = `${BASE}breach_report.jsf`;
const GRID_PAGE = `${BASE}breach_report_hip.jsf`;
// The 42 CFR Part 2 report is a structurally identical grid at its own address:
// same PrimeFaces datatable, same four exporters, same TabView archive. Found by
// direct probe and confirmed by the front page's own navigation landing there.
const PART2_GRID_PAGE = `${BASE}breach_report_part2.jsf`;
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

async function fetchBreachCsv({ fetchImpl = politeFetch, gridPage = GRID_PAGE } = {}) {
  const jar = new CookieJar();
  const attempts = [];

  // --- Primary: the data grid, fetched directly --------------------------
  const direct = await fetchImpl(gridPage, { raw: true, jar });
  let result = await exportFromPage({
    fetchImpl, jar, pageUrl: gridPage, pageBody: direct.body, attempts, pathName: 'direct-grid',
  });

  // --- Fallback: navigate from the front page ----------------------------
  // Only meaningful for the HIPAA grid; the Part 2 grid is reached directly.
  if (!result && gridPage === GRID_PAGE) {
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
async function fetchAllViews({ fetchImpl = politeFetch, requireArchive = true, gridPage = GRID_PAGE } = {}) {
  const views = [];

  // View 1: whatever the grid shows by default (Under Investigation).
  const current = await fetchBreachCsv({ fetchImpl, gridPage });
  views.push({ view: 'under_investigation', csv: current.csv, checksum: current.steps.checksum, retrieved_at: current.steps.retrieved_at, steps: current.steps });

  // View 2: Archive. It is the second tab of a PrimeFaces TabView, loaded on
  // demand, so it needs a real tabChange postback rather than a command click.
  const jar = new CookieJar();
  const attempts = [];
  const grid = await fetchImpl(gridPage, { raw: true, jar });
  // Discovery aid: what other portal pages exist, for locating the archive.
  const linked = jsf.linkedPages(grid.body);
  if (linked.length) console.error(`hhs_ocr: .jsf pages linked from the grid: ${linked.join(' | ')}`);

  const gridHidden = jsf.extractHiddenInputs(grid.body);
  const gridAction = new URL(jsf.extractFormAction(grid.body) || gridPage, gridPage).toString();
  const tabView = tv.findTabView(gridHidden);
  const archiveTabId = tv.findTabId(grid.body, ARCHIVE_PATTERN);

  if (!tabView || !archiveTabId) {
    const err = new Error(
      'hhs_ocr: could not locate the Archive tab on the report grid. Refusing to publish only ' +
        'the last ~24 months as though it were the complete record.\n' +
        `  tabView=${tabView ? tabView.id : 'none'} archiveTab=${archiveTabId || 'none'}\n` +
        '  JSF commands on the grid:\n' +
        jsf.listCommandCandidates(grid.body).map((c) => `    - ${c.commandId} label="${c.label}"`).join('\n') +
        '\n  .jsf pages linked from the grid:\n' +
        jsf.linkedPages(grid.body).map((l) => `    - ${l}`).join('\n')
    );
    err.archiveNotFound = true;
    if (requireArchive) throw err;
    console.error(`hhs_ocr: WARNING archive view not captured.\n${err.message}`);
    return views;
  }

  console.error(`hhs_ocr: switching to archive tab ${archiveTabId} on tabview ${tabView.id}`);

  // Two shapes of tab switch, because which one the server accepts is a
  // configuration detail: a PrimeFaces AJAX tabChange, and a plain postback.
  const switchVariants = [
    { name: 'ajax-tabchange', fields: tv.buildTabChangeFields(gridHidden, tabView, 1, archiveTabId) },
    { name: 'plain-postback', fields: tv.buildTabPostbackFields(gridHidden, tabView, 1) },
  ];

  let archived = null;
  for (const variant of switchVariants) {
    const body = new URLSearchParams(variant.fields).toString();
    const res = await fetchImpl(gridAction, {
      raw: true,
      jar,
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    // The response may be a PrimeFaces partial-response XML document; unwrap it
    // so the ordinary exporter scanners work on the rendered fragment.
    const { html, viewState, isPartial } = tv.extractPartialResponse(res.body);
    const merged = tv.mergeViewState(jsf.extractHiddenInputs(html), viewState)
    const pageHidden = Object.keys(merged).length > 1 ? merged : tv.mergeViewState(gridHidden, viewState);
    const csvCommand = jsf.findCsvExportCommand(html);

    if (!csvCommand) {
      attempts.push(
        `archive[${variant.name}]: ${res.body.length} bytes, partial=${isPartial}, ` +
          `csvCommand=none, commands=${jsf.listCommandCandidates(html).length}`
      );
      continue;
    }

    const got = await postExport({
      fetchImpl, jar, action: gridAction, hidden: pageHidden, commandId: csvCommand, attempts,
    });
    if (!got) continue;

    // CRITICAL: prove we actually changed views. If the tab switch silently
    // failed, the export returns the SAME under-investigation rows, and
    // publishing them labelled 'archive' would double-count the recent window
    // and still leave the history missing.
    if (got.res.body === views[0].csv) {
      attempts.push(
        `archive[${variant.name}]: export succeeded but returned byte-identical content to the ` +
          'under-investigation view — the tab did not actually change'
      );
      continue;
    }

    archived = { csv: got.res, commandId: csvCommand, encoding: got.encoding, path: `archive[${variant.name}]` };
    break;
  }

  if (!archived) {
    const err = new Error(
      'hhs_ocr: found the Archive tab but could not export distinct archived data from it. ' +
        'Refusing to publish the recent view twice under two labels.\n' +
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
    steps: { path: archived.path, encoding: archived.encoding, csvCommand: archived.commandId, tabId: archiveTabId, bytes: archived.csv.body.length },
  });

  return views;
}

module.exports = { fetchBreachCsv, fetchAllViews, CookieJar, FRONT_PAGE, GRID_PAGE, PART2_GRID_PAGE, GRID_LABEL, ARCHIVE_PATTERN, USER_AGENT };
