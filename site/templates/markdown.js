// Minimal, dependency-free Markdown renderer for the docs-backed pages
// (/sources, /corrections). Supports headings, paragraphs, lists (with
// indented continuation lines), links, tables, inline code, bold, and
// horizontal rules — the subset the docs use.
//
// Safety properties (audited):
// - escapeHtml runs BEFORE inline processing, so no raw HTML survives.
// - Link hrefs are restricted to https/http/mailto/relative; anything else
//   (javascript:, data:, ...) renders as plain text.
// - Code spans are placeholder-protected: no bold/link processing inside them.
// - Every block branch consumes at least one line — no input can hang the
//   build (a hung build is the opposite of failing loudly).

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_HREF = /^(https?:\/\/|\/|#|mailto:)/i;

function inline(s) {
  // s is already HTML-escaped. Protect code spans first so no other inline
  // rule applies inside them.
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // URL may contain one level of balanced parentheses (common in statute links).
  s = s.replace(/\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g, (match, text, url) =>
    SAFE_HREF.test(url) ? `<a href="${url}">${text}</a>` : match
  );
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[Number(n)]}</code>`);
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^---+\s*$/;
const RE_ITEM = /^\s*[-*]\s+/;
const RE_TABLE = /^\s*\|/;
const RE_SEP_CELL = /^:?-+:?$/;

function isBlockStart(line) {
  return RE_HEADING.test(line) || RE_HR.test(line) || RE_ITEM.test(line) || RE_TABLE.test(line);
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i++; continue;
    }

    if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

    if (RE_ITEM.test(line)) {
      const items = [];
      while (i < lines.length && RE_ITEM.test(lines[i])) {
        let text = lines[i].replace(RE_ITEM, '');
        i++;
        // Indented continuation lines belong to the current item.
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !isBlockStart(lines[i])) {
          text += ' ' + lines[i].trim();
          i++;
        }
        items.push(`<li>${inline(escapeHtml(text))}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (RE_TABLE.test(line)) {
      const rows = [];
      while (i < lines.length && RE_TABLE.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const isSep = (r) => r.every((c) => RE_SEP_CELL.test(c));
      let header = null;
      let body = rows;
      if (rows.length >= 2 && isSep(rows[1])) {
        header = rows[0];
        body = rows.slice(2);
      } else {
        body = rows.filter((r) => !isSep(r)); // stray separator rows render nothing
      }
      if (header || body.length) {
        const th = header
          ? `<thead><tr>${header.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join('')}</tr></thead>`
          : '';
        const trs = body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join('')}</tr>`)
          .join('');
        out.push(`<table>${th}<tbody>${trs}</tbody></table>`);
      }
      continue;
    }

    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (!para.length) { i++; continue; } // defensive: guarantee forward progress
    out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`);
  }
  return out.join('\n');
}

module.exports = { renderMarkdown, escapeHtml };
