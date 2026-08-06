const test = require('node:test');
const assert = require('node:assert');
const {
  extractHiddenInputs,
  extractViewState,
  extractFormAction,
  findCommandByLabel,
  findCsvExportCommand,
  buildCommandBody,
} = require('./hhs-jsf');

// Markup modelled on the real portal: form action carrying a path-encoded
// session, a mojarra command link, and the four sibling export icons.
const FRONT_PAGE = `
<html><body>
<form id="ocrForm" name="ocrForm" method="post"
      action="/ocr/breach/breach_report.jsf;jsessionid=EE6706AB12CD" enctype="application/x-www-form-urlencoded">
<input type="hidden" name="ocrForm_SUBMIT" value="1" />
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt39':'ocrForm:j_idt39'},'');return false">View HIPAA Breach Reports</a>
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt41':'ocrForm:j_idt41'},'');return false">File a HIPAA Breach</a>
<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="-8102...:9911" autocomplete="off" />
</form></body></html>`;

const GRID_PAGE = `
<html><body>
<form id="ocrForm" name="ocrForm" method="post" action="/ocr/breach/breach_report_hip.jsf">
<input type="hidden" name="javax.faces.ClientWindow" value="cw-77" />
<span class="exporters">
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt381':'ocrForm:j_idt381'},'');return false"><img alt="XLS" title="Export as Excel" src="/ocr/images/icons/excel.png" /></a>
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt383':'ocrForm:j_idt383'},'');return false"><img alt="PDF" title="Export as PDF" src="/ocr/images/icons/pdf.png" /></a>
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt384':'ocrForm:j_idt384'},'');return false"><img alt="CSV" title="Export as CSV" src="/ocr/images/icons/csv.png" /></a>
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('ocrForm'),{'ocrForm:j_idt385':'ocrForm:j_idt385'},'');return false"><img alt="XML" title="Export as XML" src="/ocr/images/icons/xml.png" /></a>
</span>
<input type="hidden" name="javax.faces.ViewState" value="GRIDSTATE-1234" />
</form></body></html>`;

test('extracts every hidden input, ignoring visible ones', () => {
  const hidden = extractHiddenInputs(FRONT_PAGE + '<input type="text" name="visible" value="no">');
  assert.equal(hidden['ocrForm_SUBMIT'], '1');
  assert.equal(hidden['javax.faces.ViewState'], '-8102...:9911');
  assert.ok(!('visible' in hidden));
});

test('extracts ViewState under either the javax or jakarta spelling', () => {
  assert.equal(extractViewState(extractHiddenInputs(FRONT_PAGE)), '-8102...:9911');
  assert.equal(extractViewState({ 'jakarta.faces.ViewState': 'j4' }), 'j4');
  assert.equal(extractViewState({}), null);
});

test('extracts the form action including a path-encoded jsessionid', () => {
  assert.equal(extractFormAction(FRONT_PAGE), '/ocr/breach/breach_report.jsf;jsessionid=EE6706AB12CD');
  assert.equal(extractFormAction(GRID_PAGE), '/ocr/breach/breach_report_hip.jsf');
});

test('finds a command by its visible label, not by a hardcoded id', () => {
  assert.equal(findCommandByLabel(FRONT_PAGE, 'View HIPAA Breach Reports'), 'ocrForm:j_idt39');
  assert.equal(findCommandByLabel(FRONT_PAGE, 'File a HIPAA Breach'), 'ocrForm:j_idt41');
  assert.equal(findCommandByLabel(FRONT_PAGE, 'Nonexistent Link'), null);
});

test('label matching tolerates whitespace and nested markup', () => {
  const html = FRONT_PAGE.replace('View HIPAA Breach Reports', '\n  <span>View HIPAA</span>\n  Breach Reports\n');
  assert.equal(findCommandByLabel(html, 'View HIPAA Breach Reports'), 'ocrForm:j_idt39');
});

test('picks the CSV exporter by its icon, never by sibling position', () => {
  assert.equal(findCsvExportCommand(GRID_PAGE), 'ocrForm:j_idt384');
});

test('CSV discovery survives id drift between deployments', () => {
  // Same page as an older deployment numbered its elements differently.
  const older = GRID_PAGE.replace(/j_idt38(\d)/g, (_, d) => `j_idt36${d}`);
  assert.equal(findCsvExportCommand(older), 'ocrForm:j_idt364');
});

test('returns null rather than guessing when no CSV exporter is present', () => {
  const noCsv = GRID_PAGE.replace(/<a[^>]*>\s*<img alt="CSV"[\s\S]*?<\/a>/i, '');
  assert.equal(findCsvExportCommand(noCsv), null);
});

test('command body carries all hidden fields plus the command id', () => {
  const hidden = extractHiddenInputs(GRID_PAGE);
  const body = new URLSearchParams(buildCommandBody(hidden, 'ocrForm:j_idt384'));
  assert.equal(body.get('ocrForm'), 'ocrForm');
  assert.equal(body.get('ocrForm:j_idt384'), 'ocrForm:j_idt384');
  assert.equal(body.get('javax.faces.ViewState'), 'GRIDSTATE-1234');
  // ClientWindow and friends must be carried through, not dropped.
  assert.equal(body.get('javax.faces.ClientWindow'), 'cw-77');
});

test('HTML entities in attribute values are decoded', () => {
  const html = `<form id="ocrForm" action="/a.jsf?x=1&amp;y=2"><input type="hidden" name="t" value="a&amp;b"></form>`;
  assert.equal(extractFormAction(html), '/a.jsf?x=1&y=2');
  assert.equal(extractHiddenInputs(html).t, 'a&b');
});
