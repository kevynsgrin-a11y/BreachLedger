// PrimeFaces TabView handling for the HHS OCR breach portal.
//
// The archive is not a separate page and not a filter: it is the second tab of
// a PrimeFaces TabView. The portal's own markup gives this away —
//   <a href="#ocrForm:j_idt31:archiveTab">Archive</a>
//   <div id="ocrForm:j_idt31:archiveTab" class="ui-tabs-panel ... ui-helper-hidden">
//   <input type="hidden" name="ocrForm:j_idt31_activeIndex" ...>
//   function doArchiveButtonClicked() { PF('archiveRptButton')... }
//
// Only one set of four exporter commands is rendered at a time, so the archive
// tab's content (and its own CSV exporter) is loaded on demand rather than
// sitting hidden in the page. Switching tabs therefore requires a real
// postback, and the response may be a PrimeFaces partial-response XML document
// rather than a full HTML page.

/**
 * Locate the TabView from its activeIndex hidden field.
 * "ocrForm:j_idt31_activeIndex" -> { id: "ocrForm:j_idt31", field: "..." }
 * Returns null when the page has no TabView.
 */
function findTabView(hidden) {
  for (const name of Object.keys(hidden)) {
    const m = /^(.*)_activeIndex$/.exec(name);
    if (m) return { id: m[1], field: name, activeIndex: hidden[name] };
  }
  return null;
}

/**
 * Find a tab's client id by the visible label of the anchor that selects it.
 * The anchor is a plain in-page link (href="#<tabId>"), not a JSF command, so
 * the generic command scanner does not see it.
 */
function findTabId(html, labelPattern) {
  const re = /<a\b[^>]*\bhref\s*=\s*["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const label = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (labelPattern.test(label) || labelPattern.test(m[1])) return m[1];
  }
  return null;
}

/**
 * Body for a PrimeFaces TabView tabChange, as an AJAX partial submit.
 * PrimeFaces sends the new index in <tabview>_newTab / _tabindex and mirrors it
 * into the activeIndex hidden field.
 */
function buildTabChangeFields(hidden, tabView, tabIndex, tabClientId) {
  return {
    ...hidden,
    ocrForm: 'ocrForm',
    [tabView.field]: String(tabIndex),
    [`${tabView.id}_newTab`]: tabClientId || '',
    [`${tabView.id}_tabindex`]: String(tabIndex),
    'javax.faces.source': tabView.id,
    'javax.faces.partial.event': 'tabChange',
    'javax.faces.behavior.event': 'tabChange',
    'javax.faces.partial.execute': tabView.id,
    'javax.faces.partial.render': tabView.id,
    'javax.faces.partial.ajax': 'true',
  };
}

/**
 * The same tab switch as an ordinary full postback: set activeIndex and submit.
 * Simpler, and sufficient when the TabView is not dynamic. Tried alongside the
 * AJAX form because which one works is a server-side configuration detail.
 */
function buildTabPostbackFields(hidden, tabView, tabIndex) {
  return {
    ...hidden,
    ocrForm: 'ocrForm',
    [tabView.field]: String(tabIndex),
    [`${tabView.id}_tabindex`]: String(tabIndex),
  };
}

/**
 * Extract renderable HTML from a PrimeFaces partial-response.
 *
 * An AJAX postback answers with XML:
 *   <partial-response><changes>
 *     <update id="..."><![CDATA[ ...html... ]]></update>
 *     <update id="javax.faces.ViewState"><![CDATA[token]]></update>
 *   </changes></partial-response>
 *
 * Returns { html, viewState } — html is the concatenated updates, so the
 * existing command/exporter scanners work on it unchanged. A non-XML body is
 * passed through untouched, so callers need not care which shape they got.
 */
function extractPartialResponse(body) {
  const text = String(body || '');
  if (!/<partial-response/i.test(text)) return { html: text, viewState: null, isPartial: false };

  let html = '';
  let viewState = null;
  const updateRe = /<update\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/update>/gi;
  let m;
  while ((m = updateRe.exec(text))) {
    const id = m[1];
    const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[2]);
    const content = cdata ? cdata[1] : m[2];
    if (/ViewState/i.test(id)) viewState = content.trim();
    else html += content;
  }
  return { html, viewState, isPartial: true };
}

/**
 * Merge a partial response's fresh ViewState back into the hidden field set,
 * so the following export postback carries a token the server still accepts.
 */
function mergeViewState(hidden, viewState) {
  if (!viewState) return hidden;
  const key = 'jakarta.faces.ViewState' in hidden ? 'jakarta.faces.ViewState' : 'javax.faces.ViewState';
  return { ...hidden, [key]: viewState };
}

module.exports = {
  findTabView,
  findTabId,
  buildTabChangeFields,
  buildTabPostbackFields,
  extractPartialResponse,
  mergeViewState,
};
