// scan.js — BreachBook scanner tool. Talks ONLY to the TrueAPI ingest worker's
// /scan/* endpoints (which hold the VirusTotal key, rate limits, and budget
// guards). No other network calls; file hashing happens locally.
(function () {
  'use strict';
  var SCAN_BASE = 'https://ingest.oakandmain.dev/scan';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function verdictCard(result, kindLabel) {
    if (result.error === 'rate_limited' || result.error === 'daily_limit') {
      return '<div class="scan-card scan-info"><p>' + esc(result.reason || 'Rate limited — try again later.') + '</p></div>';
    }
    if (result.error) {
      return '<div class="scan-card scan-unknown"><p>Could not complete the check (' + esc(result.error) + '). Try again in a moment.</p></div>';
    }
    if (result.verdict === 'unknown') {
      return '<div class="scan-card scan-unknown"><p><strong>Not in VirusTotal&rsquo;s corpus yet.</strong> ' +
        (result.submitted
          ? 'A scan has been submitted — results usually appear within a minute.'
          : 'This ' + kindLabel + ' has not been analyzed before.') +
        (result.submitted && result.analysisId ? '' : '') + '</p>' +
        (result.sha256 ? '<p class="retrieved">SHA-256: <code>' + esc(result.sha256) + '</code></p>' : '') +
        '</div>';
    }
    var stats = result.stats || {};
    var flagged = result.flagged || 0;
    var cls = flagged > 0 ? 'scan-flagged' : 'scan-clean';
    var headline = flagged > 0
      ? '<strong>' + flagged + ' of ' + (result.engine_total || '?') + ' engines flag this ' + kindLabel + '</strong>'
      : '<strong>No engine currently flags this ' + kindLabel + '</strong> (' +
        (stats.harmless || 0) + ' harmless, ' + (stats.undetected || 0) + ' undetected)';
    return '<div class="scan-card ' + cls + '">' +
      '<p>' + headline + '</p>' +
      (result.analysisDate ? '<p class="retrieved">Verdict as of ' + esc(result.analysisDate) + '</p>' : '') +
      (result.permalink ? '<p><a href="' + esc(result.permalink) + '" rel="noopener" target="_blank">Full per-engine report on VirusTotal &rarr;</a></p>' : '') +
      '</div>';
  }

  function setLoading(el, text) {
    el.innerHTML = '<div class="scan-card scan-info"><p>' + esc(text) + '</p></div>';
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .catch(function () { return { error: 'network' }; });
  }

  // ---- URL scanning ---------------------------------------------------------
  var urlForm = $('scan-url-form');
  if (urlForm) {
    urlForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = $('scan-url-result');
      var value = $('scan-url-input').value.trim();
      if (!value) return;
      if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
      setLoading(out, 'Checking against 60+ engines\u2026');
      getJSON(SCAN_BASE + '/url?url=' + encodeURIComponent(value)).then(function (j) {
        if (j.verdict === 'unknown') {
          // Offer to submit for a fresh scan.
          out.innerHTML = verdictCard(j, 'URL') +
            '<p><button type="button" class="btn btn-secondary" id="scan-url-submit">Submit this URL for a fresh scan</button></p>';
          var submitBtn = $('scan-url-submit');
          if (submitBtn) {
            submitBtn.addEventListener('click', function () {
              setLoading(out, 'Submitted \u2014 waiting for engines\u2026');
              fetch(SCAN_BASE + '/url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: value }),
              }).then(function (r) { return r.json(); }).catch(function () { return { error: 'network' }; })
                .then(function (j2) {
                  if (j2.analysisId) {
                    pollAnalysis(j2.analysisId, out, 'URL', 6);
                  } else {
                    out.innerHTML = verdictCard(j2, 'URL');
                  }
                });
            });
          }
        } else {
          out.innerHTML = verdictCard(j, 'URL');
        }
      });
    });
  }

  // ---- File scanning (hash-first; upload only as explicit fallback) ----------
  var fileForm = $('scan-file-form');
  if (fileForm) {
    fileForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = $('scan-file-result');
      var input = $('scan-file-input');
      var file = input.files && input.files[0];
      if (!file) { out.innerHTML = verdictCard({ error: 'no_file' }, 'file'); return; }
      if (file.size > 32 * 1024 * 1024) {
        out.innerHTML = verdictCard({ error: 'too_large', reason: 'Files are capped at 32 MB on the VirusTotal public API.' }, 'file');
        return;
      }
      setLoading(out, 'Hashing locally \u2014 the file has not left your device\u2026');
      file.arrayBuffer().then(function (buf) {
        return crypto.subtle.digest('SHA-256', buf);
      }).then(function (digest) {
        var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        setLoading(out, 'Hash computed. Looking up known reports\u2026');
        return getJSON(SCAN_BASE + '/file?sha256=' + hex).then(function (j) {
          if (j.verdict === 'unknown') {
            out.innerHTML = verdictCard(Object.assign({ sha256: hex }, j), 'file') +
              '<p><button type="button" class="btn btn-secondary" id="scan-file-upload">Upload this file for analysis</button> ' +
              '<span class="retrieved">The file is not in VirusTotal&rsquo;s corpus. Uploading sends this file to VirusTotal.</span></p>';
            var upBtn = $('scan-file-upload');
            if (upBtn) {
              upBtn.addEventListener('click', function () {
                setLoading(out, 'Uploading to VirusTotal\u2026');
                var fd = new FormData();
                fd.set('file', file, file.name || 'upload.bin');
                fetch(SCAN_BASE + '/file', { method: 'POST', body: fd })
                  .then(function (r) { return r.json(); }).catch(function () { return { error: 'network' }; })
                  .then(function (j2) {
                    if (j2.analysisId) {
                      pollAnalysis(j2.analysisId, out, 'file', 8);
                    } else {
                      out.innerHTML = verdictCard(j2, 'file');
                    }
                  });
              });
            }
          } else {
            out.innerHTML = verdictCard(Object.assign({ sha256: hex }, j), 'file') +
              '<p class="retrieved">Matched by fingerprint (SHA-256) — the file never left your device.</p>';
          }
        });
      }).catch(function () {
        out.innerHTML = verdictCard({ error: 'network' }, 'file');
      });
    });
  }

  // ---- Analysis polling -------------------------------------------------------
  function pollAnalysis(id, out, kindLabel, attemptsLeft) {
    if (attemptsLeft <= 0) {
      out.innerHTML = verdictCard({ verdict: 'unknown', submitted: true, analysisId: id }, kindLabel) +
        '<p class="retrieved">Analysis queued on VirusTotal — check the report link in a minute or two.</p>';
      return;
    }
    getJSON(SCAN_BASE + '/analysis?id=' + encodeURIComponent(id)).then(function (j) {
      if (j.status === 'completed') {
        out.innerHTML = verdictCard(j, kindLabel);
      } else {
        setLoading(out, 'Engines are still running (' + esc(j.status || 'queued') + ')\u2026');
        setTimeout(function () { pollAnalysis(id, out, kindLabel, attemptsLeft - 1); }, 5000);
      }
    });
  }
})();
