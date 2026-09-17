// Scanner tool page — the interactive VirusTotal surface.
// Static shell; all interactivity is in /assets/scan.js against the TrueAPI
// ingest worker's /scan/* endpoints (rate-limited, budget-guarded there).
const { page } = require('./layout');
const { escapeHtml } = require('./markdown');

function render(ctx) {
  const { site, assets } = ctx;
  const content = `
<article class="doc scan-tool">
  <h1>Scan a link or file</h1>
  <p class="lead">After a breach disclosure, lookalike claim sites and phishing pages appear within days. Check any URL
or file against <a href="https://www.virustotal.com/" rel="noopener">VirusTotal</a> — the aggregate verdict of 60+
security engines — before you trust it with a claim code, an SSN, or a download.</p>

  <section aria-labelledby="scan-url-h">
    <h2 id="scan-url-h">Check a URL</h2>
    <form id="scan-url-form" class="scan-form">
      <label for="scan-url-input" class="sr-only">URL to check</label>
      <input id="scan-url-input" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false"
        placeholder="https://claim-settlement.example.com" required>
      <button type="submit" class="btn" id="scan-url-btn">Check URL</button>
    </form>
    <div id="scan-url-result" class="scan-result" aria-live="polite"></div>
  </section>

  <section aria-labelledby="scan-file-h">
    <h2 id="scan-file-h">Check a file</h2>
    <p>The file is <strong>hashed in your browser</strong> first; only the fingerprint is looked up. If the file is
already known to VirusTotal you get the full report and the file never leaves your device. Only if it is unknown do
we offer an upload — and say so plainly before anything is sent.</p>
    <form id="scan-file-form" class="scan-form">
      <label for="scan-file-input" class="file-label">
        <input id="scan-file-input" name="file" type="file">
        <span>Choose a file (up to 32 MB)</span>
      </label>
      <button type="submit" class="btn" id="scan-file-btn">Check file</button>
    </form>
    <div id="scan-file-result" class="scan-result" aria-live="polite"></div>
  </section>

  <section aria-labelledby="scan-notes-h" class="scan-notes">
    <h2 id="scan-notes-h">What this tool is and is not</h2>
    <ul>
      <li><strong>Not a verdict on guilt.</strong> A clean scan means no engine currently flags the item — not that the
site is legitimate or the email is honest. A flagged scan means engines see something. Judgment stays yours.</li>
      <li><strong>Community quota.</strong> This tool runs on VirusTotal's free public API (4 requests/minute,
500/day, non-commercial), shared across this site. Per-visitor limits keep it fair; if you hit one, try later.</li>
      <li><strong>Privacy.</strong> URL checks send the URL to VirusTotal for analysis. File checks hash locally;
an unknown file is uploaded only if you click through.</li>
      <li><strong>Already breached?</strong> This tool does not look up exposed email addresses — see
<a href="/rights/">what to do instead</a>.</li>
    </ul>
    <p class="retrieved">Powered by the VirusTotal public API. Verdicts link to the full per-engine report on
virustotal.com.</p>
  </section>
</article>`;

  return page({
    site,
    assets,
    route: '/scan',
    title: 'Scan a link or file',
    description: 'Check any URL or file against 60+ security engines before you trust it after a breach. Free, community-quota, privacy-first: files are hashed in your browser.',
    content,
    script: assets['scan.js'] ? `/assets/${assets['scan.js']}` : null,
  });
}

module.exports = { render };
