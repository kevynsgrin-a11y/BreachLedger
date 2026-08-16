# BreachBook — image and content audit

Audit date **2026-08-16**, against the live site (7,784 pages, ~7,760 records) at commit `822ad12`.

Two independent audits were run — one on visual assets, one on content — and their load-bearing
claims were verified against the running code before being written down here. Where a number
appears below it was computed, not estimated. Where a claim was checked, the check is shown.

This document is meant to be worked from. Every item states what to change, which file and line,
and the actual asset source or copy to insert. Nothing here is an outline.

---

## Part 0 — The finding that governs everything else

**This site should generate no decorative imagery. No illustration, no photography, no abstract
art, no AI-generated hero images, on any page, ever.**

That is the answer to "what images does this site need," and it is not a stylistic preference.
Four reasons, each specific to this site:

**It converges with the scam set instead of separating from it.** The competing vertical —
credit-monitoring lead-gen, mass-tort intake, "was I breached?" funnels — is visually unanimous:
hooded figures, padlocks, glowing shields, circuit-board blue, red alert glyphs. That vocabulary
*is* the vertical's signature. A reader landing on a breach page has statistically already seen
several of those pages this month. Any illustration — including a tasteful, muted, non-cliché one
— moves this site from the reference class it wants (HHS OCR, CourtListener, SEC EDGAR, the
Federal Register) into the one it exists to escape. Every government source this site cites ships
zero decorative images. That is the register, not an oversight.

**An unsourced image contradicts the site's only claim.** The masthead on all 7,784 pages says
"Every entry cites a government or court source." An illustration is a visual assertion with no
citation, on a page whose citation block is deliberately built as first-class furniture. AI
imagery makes this worse: it is increasingly legible as AI-generated to ordinary readers, and it
has itself become a low-trust marker in exactly this YMYL-adjacent territory. A site whose moat
is provenance cannot ship a picture with no provenance.

**Abstract art does not escape it.** The tempting middle path — muted geometry, no padlocks —
fails differently: it has no referent in the data. Every mark on this site should be a fact or the
furniture holding a fact. An abstract header is a claim of *brand*, and brand on a record is
noise. The build spec already settles it: *"choose the option that makes the site look more like a
government record and less like a lead-gen page."*

**The one legitimate generated image is a picture of the site's own text.** A social preview card
is not decoration; it is a typographic plate replacing the platform's default gray box. That is
the entire carve-out, specified in §1.4.

So the imagery budget goes to three places instead: **a correct icon set** (browser tabs, search
results, iOS home screens are surfaces CSS cannot reach, and missing icons read as *unfinished*),
**making the data the picture** (build-time inline SVG generated from the record set, which
carries its citation by construction), and **fixing what is already drawn**.

---

## Part 1 — Image and asset work

### 1.1 — P0 · Two live WCAG AA contrast failures

`--ink-faint: #6e737a` passes on `--paper` but fails on the two other backgrounds the site puts
it on. Computed, not estimated:

| Text | Background | Ratio | |
| --- | --- | --- | --- |
| `.retrieved` — source retrieval dates | `--panel` `#f2f2ef` (citation block) | **4.26** | FAIL |
| `.not-disclosed` — even table rows | `--zebra` `#f7f7f5` | **4.45** | FAIL |
| `.not-disclosed` — odd table rows | `--paper` `#fbfbfa` | 4.61 | pass |

Neither is an edge case. `.retrieved` sits inside the citation block on **every one of the ~7,760
breach pages** — the retrieval date is a load-bearing provenance fact and it is the least legible
text on the page. `.not-disclosed` is the site's honesty marker, and it currently passes on odd
rows and fails on even rows of the same table.

**Fix** — `site/assets/styles.css:9`:

```css
  --ink-faint: #686d74;   /* was #6e737a */
```

Verified: 5.03 on paper, 4.86 on zebra, 4.65 on panel. Visually indistinguishable from the
current value. Every other pair in the palette already clears AA (`--ink` 14.9–16.1, `--ink-soft`
7.5–8.1, `--accent` 6.4–6.9, `--deadline-amber` 4.76–5.15).

### 1.2 — P0 · The favicon is frozen for a year by the immutable cache header

`_headers` sets `/assets/*` to `Cache-Control: public, max-age=31536000, immutable`. Only `.css`
files are content-hashed. `favicon.svg` ships at the fixed path `/assets/favicon.svg`, so **it is
cached immutably for twelve months at a URL that never changes** — any edit is invisible to
returning visitors. This is live today, and it means the fix must also change the URL.

It matters more than it sounds: Google renders a favicon beside every organic result, and this
site's distribution is search across ~7,760 record pages, so the favicon is rendered more often
than any other asset the site owns. Today `/favicon.ico` and `/apple-touch-icon.png` do not exist.

**Fix — move icons to the site root**, which is outside the `/assets/*` rule and is where
browsers, crawlers and iOS probe anyway.

Create `site/assets-root/` as a **sibling** of `site/assets/` — not a subdirectory. A subdirectory
would crash the build: `site/build.js` calls `readFileSync` on every `readdirSync(ASSETS)` entry
and throws `EISDIR` on a directory.

Insert in `site/build.js` immediately after the asset loop closes:

```js
  // Root-level assets. These MUST NOT live under /assets/*: that prefix is
  // Cache-Control: immutable for a year, which would freeze an icon we could
  // never replace. Root is also where browsers, crawlers and iOS probe.
  const ROOT_ASSETS = path.join(ROOT, 'site/assets-root');
  if (fs.existsSync(ROOT_ASSETS)) {
    for (const f of fs.readdirSync(ROOT_ASSETS)) {
      const raw = fs.readFileSync(path.join(ROOT_ASSETS, f));
      if (/\.(css|js|svg|txt|xml)$/.test(f) && EMOJI_RE.test(raw.toString('utf8'))) {
        throw new Error(`build guard failed for root asset ${f}: emoji found (spec section 10)`);
      }
      fs.writeFileSync(path.join(OUT, f), raw);
    }
  }
```

Add to the `_headers` array (the file limit is 100 rules; two are in use):

```
/favicon.ico
  Cache-Control: public, max-age=604800

/favicon.svg
  Cache-Control: public, max-age=604800

/apple-touch-icon.png
  Cache-Control: public, max-age=604800

/og-default.png
  Cache-Control: public, max-age=604800
```

Then delete `site/assets/favicon.svg`.

### 1.3 — P0 · Replacement favicon, with two real defects fixed

The current favicon has two problems, both verified by rasterizing it:

1. **It nearly vanishes against dark browser chrome.** A `#1c1e21` full-bleed square on Chrome's
   dark tab strip (`#35363a`) is ~1.3:1 — the icon reads as a smudge with no edge.
2. **Its `<text>` element depends on fonts on the viewer's machine.** SVG favicons are rasterized
   by the browser using local fonts. Georgia is absent on most Linux and Android systems, so the
   fallback serif's metrics decide whether "BB" fits the box. Nothing constrains it today.

**`site/assets-root/favicon.svg`** — passes the emoji guard, ASCII-only:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>
.bg{fill:#1c1e21}.fg{fill:#fbfbfa}
@media(prefers-color-scheme:dark){.bg{fill:#fbfbfa}.fg{fill:#1c1e21}}
</style>
<rect class="bg" width="32" height="32"/>
<text class="fg" x="16" y="22.5" text-anchor="middle" textLength="21" lengthAdjust="spacingAndGlyphs" font-family="Charter,Georgia,'Times New Roman','Liberation Serif','DejaVu Serif','Noto Serif',serif" font-size="15" font-weight="600">BB</text>
</svg>
```

`textLength="21" lengthAdjust="spacingAndGlyphs"` forces the pair to occupy exactly 21 of 32 units
whichever serif resolves, removing the font-metric risk entirely. The `@media` block inverts the
mark on dark chrome; Safari ignores it and falls back to the light variant, which is current
behaviour, so there is no regression.

CSP: safe. `img-src 'self' data:` permits a same-origin favicon, and the `<style>` element is
inside a separately-fetched image resource, so the document's `style-src 'self'` does not apply.

### 1.4 — P0 · Raster icons

Both are static. Generate once, commit as binaries; these are not build outputs.

| File | Dimensions | Format | Note |
| --- | --- | --- | --- |
| `site/assets-root/favicon.ico` | 16, 32, **48** | multi-size ICO | 48px required — Google needs a square that is a multiple of 48 |
| `site/assets-root/apple-touch-icon.png` | 180×180 | PNG, opaque, no alpha | full-bleed; iOS applies its own corner mask |

Use the **light** variant for both — an ICO cannot adapt to colour scheme, and its main surfaces
(Google results, bookmark bars) are light.

**These are drawn assets, and the correct generator is a rasterizer, not an image model.** Keep an
unshipped source at `design/icon-light.svg` — not in `site/assets/`, or the build copies it to
`dist/assets/` as dead weight:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" fill="#1c1e21"/>
<text x="16" y="22.5" text-anchor="middle" textLength="21" lengthAdjust="spacingAndGlyphs" font-family="Charter,Georgia,'Times New Roman',serif" font-size="15" font-weight="600" fill="#fbfbfa">BB</text>
</svg>
```

```bash
# apple-touch-icon
npx sharp-cli -i design/icon-light.svg -o site/assets-root/apple-touch-icon.png \
  resize 180 180 --density 900 -- png --palette

# ICO layers, then assemble
for s in 16 32 48; do
  npx sharp-cli -i design/icon-light.svg -o /tmp/bb-$s.png resize $s $s --density 900
done
magick /tmp/bb-16.png /tmp/bb-32.png /tmp/bb-48.png site/assets-root/favicon.ico
```

Run on a machine where Georgia exists (macOS or Windows). **Verification step:** open the PNG at
100% and confirm the letters have visible serifs. If they render as a grotesque, Georgia was not
found and the file was generated on the wrong machine.

At 16px "BB" is two soft blobs with no serifs. That is normal and acceptable — every seal-style
government favicon behaves the same way, and the tab title carries the name. **Do not** try to fix
it by simplifying the mark into a shield, a lock, or ledger lines; all three read either as the
scam vocabulary or as a hamburger menu at that size.

**No web manifest, and no 192/512 PNGs.** Hard reason: `manifest-src` falls back to `default-src`,
which is `'none'`, so a `<link rel="manifest">` is blocked outright unless the CSP is amended.
Editorial reason: a manifest exists to make a site installable. A record people reach from search,
read, cite and leave has no use for installability, and an install prompt is off-register.

### 1.5 — P0 · The `<link>` block

Replace the single line at `site/templates/layout.js:32`:

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1e21" media="(prefers-color-scheme: dark)">
```

Order is load-bearing: browsers that understand SVG take the later declaration, those that do not
fall back to the ICO. The `theme-color` pair costs zero asset bytes and stops mobile browsers
painting default chrome above the masthead.

### 1.6 — P1 · One social card, and only one

Today `layout.js` deliberately omits `og:image`, reasoning that a tag pointing at a nonexistent
file is worse than none. Correct reasoning; the conclusion changes once the file exists. Current
behaviour: LinkedIn and Facebook render a gray placeholder, Slack and Discord render text-only,
iMessage renders a bare link. For a site whose growth path is being *cited* — in newsrooms, in
security research, in Slack threads at companies checking a vendor — the gray box is a small
credibility tax paid every time someone shares a record.

**Composition is centered, and that is a constraint rather than a taste.** X/Twitter center-crops
`og:image` to 1:1 for `summary` cards, so everything essential must fit the central **630×630 safe
zone (x: 285–915)**. Centered type is also the correct register — it is how a government report
title page is set. **No numbers on the card:** a static card cannot carry "7,760 records" without
going stale, and a stale count on a record site is exactly the wrong failure.

**`design/og-default.svg`** (rasterizes to ~39 KB):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fbfbfa"/>
  <rect x="0" y="0" width="1200" height="12" fill="#1c1e21"/>
  <rect x="0" y="624" width="1200" height="6" fill="#1c1e21"/>
  <text x="600" y="268" text-anchor="middle" font-family="Charter,Georgia,'Times New Roman',serif" font-size="66" font-weight="600" fill="#1c1e21">BreachBook</text>
  <rect x="540" y="300" width="120" height="2" fill="#1c1e21"/>
  <text x="600" y="352" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="23" fill="#4a4e54">A public record of disclosed U.S. data breaches</text>
  <text x="600" y="390" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="20" fill="#6e737a">Every entry cites a government or court source.</text>
  <text x="600" y="472" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="19" letter-spacing="2" fill="#4a4e54">breachbook.org</text>
</svg>
```

```bash
npx sharp-cli -i design/og-default.svg -o site/assets-root/og-default.png --density 300 -- png
```

Insert in `layout.js`, inside the `social` literal after `og:locale`:

```html
<meta property="og:image" content="${site.origin}/og-default.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="BreachBook. A public record of disclosed U.S. data breaches. Every entry cites a government or court source.">
```

**Leave `twitter:card` as `summary`.** With one generic card across 7,784 pages,
`summary_large_image` would make every shared link a large identical information-free block that
buries the title and description — and those are the payload.

### 1.7 — P1 · Per-record social cards: no. Here is the arithmetic.

Technically feasible, still wrong. Three reasons in order of decisiveness:

1. **The page budget is the binding constraint.** Cloudflare Pages caps at 20,000 files (free) /
   100,000 (paid). Current: ~7,786. The route registry already commits to
   `/breach/[slug]/what-to-do` at phase 3 — another ~7,760 pages — plus entity hubs, 51 state
   pages, settlements and guides. That reaches ~20,000 on pages alone. Spending 7,760 files on
   images forces the plan upgrade a phase early and consumes the remaining headroom for something
   that is not a record.
2. **It needs a rasterizer in CI, where the fonts do not exist.** Georgia and Charter are absent
   on `ubuntu-latest`. All 7,760 cards would silently render in DejaVu Serif and nothing in the
   build would catch it.
3. **The editorial argument settles it even if the other two vanished.** The obvious design leads
   with the severity score in large type. A "91 / 100" card is optimised for sharing outrage — a
   countdown timer in a different costume — and it detaches the number from the breakdown table
   that exists precisely so it does not read as invented. A card omitting the score carries only
   the entity name and date, which the title and description already carry better.

**One constraint to record if this is ever revisited:** `EDITORIAL.md` states the 42 CFR Part 2
regime must not appear in any og tag. A generated card is an og asset. Any future generator must
build only from fields already in the title and description, and must never branch on
`source_type === 'hhs_part2'`.

### 1.8 — P1 · The severity bar has an invisible track

Measured:

| | Colours | Contrast |
| --- | --- | --- |
| Track vs page | `#f2f2ef` on `#fbfbfa` | **1.08** |
| Track border vs page | `#d6d6d1` on `#fbfbfa` | **1.41** |
| Fill vs track | `#4a4e54` on `#f2f2ef` | 7.46 |

The unfilled portion is effectively invisible, so a score of 25 renders as a small dark stub with
no visible right-hand boundary — a bar with no apparent maximum. This is the site's only graphic
and it appears on every breach page. It under-communicates the one thing a bar exists to
communicate: proportion.

```css
.severity-bar {
  background-color: var(--panel);
  /* quarter ticks: the bar must read as a 0-100 scale, not an unbounded stub */
  background-image: repeating-linear-gradient(to right,
    transparent 0 calc(25% - 1px), var(--rule) calc(25% - 1px), var(--rule) 25%);
  border: 1px solid var(--ink-faint);   /* was --rule, at 1.41:1 */
  height: 14px; width: 100%; max-width: 28rem;
}
```

With the §1.1 value that border is 5.03:1 — a defined edge, well over the 3:1 non-text threshold.
The shorthand must be split into `background-color` + `background-image` or it resets the image.
No markup change; the generated `.sev-N` mechanism is untouched.

### 1.9 — P1 · Print gaps on a document designed to be printed

The `@media print` block is thoughtful — it spells out external link targets, repeats `thead`,
keeps citations from splitting. Three gaps:

1. **The severity bar prints empty.** The fill is a background colour, and browsers suppress those
   in print. A printed record shows an outlined box with nothing in it, on a document whose whole
   purpose is to be citable offline.
2. **Internal links print with no URL.** External links are expanded; `<a href="/severity/">` is
   not. A printed record's reference to the scoring method is unfollowable.
3. **Zebra striping is not reset**, so even rows attempt a background that mostly will not render.

```css
  /* The severity bar is a graphic on a citable record; keep it on paper. */
  .severity-bar { border-color: #000; background-image: none; }
  .severity-bar-fill {
    background: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .chart rect { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tbody tr:nth-child(even) { background: transparent; }
  main a[href^="/"]::after { content: " (breachbook.org" attr(href) ")"; font-size: 0.85em; }
  main nav a::after { content: none; }
```

**The highest-value line in the whole print block** is one CSS cannot produce: a printed page
carries no indication of which URL it is. Emit in `layout.js` before `</main>`:

```html
<p class="print-provenance">${url}</p>
```
```css
.print-provenance { display: none; }
@media print { .print-provenance { display: block; font-family: var(--mono); font-size: 9pt;
  color: #000; border-top: 1px solid #000; padding-top: 0.5em; margin-top: 1.5em; } }
```

For a site that expects pages to be printed and attached to filings, that is worth more than the
rest of the block combined.

### 1.10 — P1 · Two accessibility fixes in the table system

**Wide tables are not keyboard-reachable in Safari.** `.table-scroll` is an `overflow-x: auto`
container with no `tabindex`. Chrome and Firefox focus scrollable containers automatically; Safari
does not, so a keyboard-only user cannot scroll a wide table sideways — a WCAG 2.1.1 failure on a
site made mostly of wide tables.

```css
.table-scroll:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
```
plus `tabindex="0"` on every `.table-scroll` emitter: `breach-table.js`, `markdown.js`,
`breach-detail.js` (5 sites), `severity.js` (4 sites).

**The timeline table has no row headers.** `breach-detail.js:111` emits a two-column key/value
table with no header cells at all. Change `<td>${label}</td>` to `<th scope="row">${label}</th>`,
and add — required, or the existing `th` rule renders the labels uppercase on a panel background:

```css
tbody th[scope="row"] {
  background: transparent; color: var(--ink); font-weight: 600;
  font-size: 0.9rem; text-transform: none; letter-spacing: 0;
}
```

**Already correct, do not touch:** focus states are a 2px `--ink` outline at 16:1 with an offset —
better than most sites. Nothing conveys information by colour alone: the severity bar is redundant
to "25 out of 100" in 1.5rem type plus a full breakdown table, and `.deadline` amber is always
paired with `font-weight: 600` and an explicit label.

### 1.11 — P2 · One chart, and only one

| Candidate | Verdict |
| --- | --- |
| Breaches over time | **No** |
| Breaches or records per sector | **No** |
| Distribution of severity scores | **Yes** |

**Time series is a no, and this is the load-bearing distinction.** Any time series over this
corpus measures *what the site has ingested* as much as what happened. Coverage expands by phase
and lags at the recent edge. A rising line reads as "breaches are increasing" — a claim with no
government source behind it. `year-archive.js` already states the weaker version of this caveat in
prose; a chart states the opposite louder than the caveat can retract it.

**Per-sector is a no.** Sector totals are dominated by two or three mega-breaches, so the bar
chart is really a chart of the largest single incident in each sector wearing a sector's name. The
sorted table already there is strictly more honest.

**The severity distribution is a yes, specifically** because it is the one chart fully sourced by
construction: it is not a claim about the world but about the site's own published rubric applied
to its own published corpus, both of which are on the site. And it answers the exact objection a
sceptic brings to a severity score invented by a website — *does this thing actually discriminate,
or does everything score "severe"?* A histogram showing real spread is evidence for the rubric's
honesty. It belongs on `/severity/` and nowhere else.

**The CSP insight that makes this cheap:** inline SVG geometry uses *presentation attributes*
(`x`, `y`, `width`, `fill`), which are attributes, not inline styles. `style-src 'self'` blocks
`style="..."` — which is why the severity bar needs 101 generated `.sev-N` classes — but it does
not touch `<rect fill="#4a4e54" width="55">`. Build-time SVG charts need **zero** new CSS and
**zero** CSP changes. Inline SVG also triggers no fetch, and its `<text>` inherits the document
font stack, so there is no rasterizer and no font-availability problem.

Generator, added to `site/templates/severity.js` (`ctx.breaches` is already in scope):

```js
function severityHistogram(scores) {
  const BINS = 10, W = 640, H = 210, PADL = 44, PADR = 8, PADT = 10, PADB = 34;
  const counts = new Array(BINS).fill(0);
  for (const s of scores) {
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    counts[Math.min(BINS - 1, Math.floor(n / 10))]++;
  }
  const max = Math.max(1, ...counts);
  const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const slot = plotW / BINS, bw = Math.round(slot - 4);
  const bars = counts.map((c, i) => {
    const h = Math.round((c / max) * plotH);
    return `<rect x="${Math.round(PADL + i * slot + 2)}" y="${PADT + plotH - h}" width="${bw}" height="${h}" fill="#4a4e54"/>`;
  }).join('');
  const xlabels = counts.map((_, i) =>
    `<text x="${Math.round(PADL + i * slot + slot / 2)}" y="${H - 16}" text-anchor="middle" font-size="11" fill="#4a4e54">${i * 10}</text>`
  ).join('');
  const ticks = [0, Math.round(max / 2), max].map((v) => {
    const y = PADT + plotH - Math.round((v / max) * plotH);
    return `<text x="${PADL - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6e737a">${v.toLocaleString('en-US')}</text>`
         + `<rect x="${PADL}" y="${y}" width="${plotW}" height="1" fill="#d6d6d1"/>`;
  }).join('');
  const total = counts.reduce((a, b) => a + b, 0);
  return { counts, total, svg: `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="sevdist-t sevdist-d">
<title id="sevdist-t">Distribution of severity scores across ${total.toLocaleString('en-US')} published records</title>
<desc id="sevdist-d">A histogram in ten-point bins. The same figures are listed in the table below.</desc>
${ticks}${bars}
<rect x="${PADL}" y="${PADT + plotH}" width="${plotW}" height="1" fill="#1c1e21"/>
${xlabels}
<text x="${PADL + plotW / 2}" y="${H - 2}" text-anchor="middle" font-size="11" fill="#6e737a">severity score</text>
</svg>` };
}
```

Rendered before `<h2>Rubric provenance</h2>`, **always with its table** — tables over cards; the
chart is redundant to the table, never a replacement. That single rule keeps it screen-reader
accessible, print-safe and on-doctrine at once.

```css
.chart { display: block; width: 100%; max-width: 40rem; height: auto; margin: 0.9rem 0 0.4rem; }
```

**What it must not do.** No colour coding by band — the moment a bar turns red the site has joined
the alarm vocabulary. No gradients, shadows, rounded bars or animation. No truncated y-axis. No
cumulative "total individuals affected" in any chart: summing `records_affected` counts
notification events, not people. **And no US map, ever** — `states_notified` records notification
jurisdiction, not where affected people live, so a choropleth would assert something no source
says while being the single most recognisable lead-gen-dashboard tell in the genre.

### 1.12 — P2 · Typography

**The type system is right. Do not change it, and do not add a web font.** Charter/Georgia serif
over system sans is the Federal Register / court-docket idiom, and Charter is the correct specific
choice — Carter designed it for low-resolution output, so it reads as *document* rather than
*publication*. There is also a hard reason: `font-src` falls back to `default-src 'none'`, so any
web font — even self-hosted — requires amending the CSP, plus 40–80 KB blocking first paint across
7,784 pages on a site whose speed is itself a trust signal.

**No SVG wordmark on the page.** It would stop being selectable and copyable on a site whose
masthead is what people copy when citing it, stop scaling with the reader's font size, print at a
fixed size, and make the most identity-bearing line of a *textual record* not text. The one place
a wordmark is genuinely needed is the OG card, where text is not an option — and it is in §1.6.

Two refinements worth making:

```css
/* A score is a measurement. Georgia's old-style figures render "25 out of 100"
   with descending digits, inconsistent with the lining figures in td.num. */
.severity-value { font-variant-numeric: lining-nums tabular-nums; }
table { font-variant-numeric: tabular-nums; }
```

---

## Part 2 — Content work

### 2.1 — P0 · The site is anonymous. This is the single largest gap.

There is no page identifying who publishes this, why, how it is funded, or whether anyone stands
behind it. There is a masthead, a disclaimer, and 7,784 pages of assertions about named
organizations, published by nobody.

The project's own brief says the vertical is scam-adjacent and trust is the only durable moat.
**Anonymity is the defining characteristic of the sites this one is trying not to resemble.**
Every scraped-breach-data lead-gen site is anonymous. A reader trying to tell this apart from those
has no evidence to work with. Every other trust signal here — the rubric, the citations, the
corrections policy — is downstream of somebody being accountable, and nobody is named.

Three strings must be supplied before this ships, marked below. **A pseudonymous version is worse
than no page**, because it converts an absence into a claim.

```markdown
# About this record

BreachBook is a public record of disclosed U.S. data breaches. It holds 7,760 records, each one
retrieved from a government listing and each one citing the listing it came from. It publishes
what those sources state and nothing else.

## Who publishes it

BreachBook is published by [OPERATOR NAME], [one sentence: role and relevant background], and is
an independent project. It is not affiliated with, endorsed by, or funded by the U.S. Department
of Health and Human Services, any state attorney general, any regulator, any law firm, or any
organization named in this record.

Correspondence, including corrections and source disputes, goes to [corrections@breachbook.org].
Every message is read.

## Why it exists

The information on this site is already public. HHS publishes its breach listing; state attorneys
general publish theirs; federal courts publish their dockets. What none of them publishes is a
single record you can browse, search, cite, and check — the HHS portal is a session-bound form
application whose individual entries have no web address, so a specific breach cannot be linked to
at all. This site exists to give each disclosed breach a permanent, citable address, and to state
precisely where every fact on it came from.

That is the whole of the ambition. This site does not investigate breaches, rate companies,
estimate harm, or tell anyone what to do about anything.

## How it is funded, and what commercial interest exists

BreachBook currently carries no advertising, no affiliate links, no sponsored placements, and no
paid inclusion or removal of any kind. No organization named in this record has paid this site
anything, and no organization named in this record can pay to change, soften, or remove its entry.
There is no arrangement under which that could happen.

The site's running costs are met by its publisher.

If any commercial arrangement is introduced later, it will be disclosed on this page and above the
fold on every page it touches, in the form the Federal Trade Commission's endorsement guides
require, and the change will be dated in the correction log. Two things will not change
regardless: no fee will ever affect whether a record is published or what it says, and this site
will never collect claim information, sell personal information, or accept payment from a party to
a matter it reports.

## What this site will not do

- **No email lookup, no "check if you were breached."** That function exists at
  [Have I Been Pwned](https://haveibeenpwned.com/), which this site links to and never proxies or
  replicates. Building it here would require collecting exactly the personal information this
  record exists to document the exposure of.
- **No legal advice, and no claims processing.** This site is not a law firm, is not a settlement
  administrator, and cannot file, process, or advise on a claim. Settlement pages, when they
  exist, will link to the official administrator's own site and nowhere else.
- **No paid removal, no reputation service.** A record is published because a government source
  published it. It is corrected when it is wrong and retracted when it is unfounded, and in both
  cases the change is logged publicly. Neither is available for purchase.
- **No personal information about individuals.** Every record here names an organization. None
  names, describes, or identifies any affected person.
- **No urgency, and no estimates of what anyone might be owed.** Deadlines are published only
  where a court or an administrator set one, and payouts only where a settlement agreement states
  them, cited.

## What this record is not evidence of

An organization appears here because federal or state law required it to report a breach to a
government body, and it did. That is a report, not a finding. Nothing on this site should be read
as a determination that an organization broke a law, failed a duty, or was penalised — those
determinations are made by regulators and courts, and where one exists and is published, this
record cites it and says so.

The reverse is equally true. An organization absent from this record has not been shown to be
secure. It may not be covered by any listing this site draws from, may have had no breach meeting
a reporting threshold, or may have had one that has not yet been published.

## Reuse and licensing

The underlying government records are works of the United States government and of state agencies.
This site claims no rights in them.

The compilation, the severity rubric, the reference tables, and the written text of these pages
are published by BreachBook and may be reused, including commercially, with attribution to
BreachBook and a link to the record page or pages relied on. Re-publishing a severity score
requires stating the rubric version it was computed under, because the score is meaningless
without it.

If you are citing this record in research, litigation, or reporting, cite the government source
listed on the record page rather than this site. This site is a finding aid for those sources, not
a substitute for them, and its own copy can be wrong in ways the source is not.

## How current this is

The HHS listing is retrieved daily at 06:00 UTC and the site rebuilds when the retrieval changes a
record. Records whose facts have not changed are not re-dated: a record's "last changed" date
moves only when a published fact on it moved. The current state of each source, its retrieval
schedule, and the date it was last verified are in the source registry on
[sources and methodology](/sources/).
```

### 2.2 — P0 · 7,735 of 7,784 pages have no path from the front door

Nav is four links. The home page shows 25 of ~7,760 records and links to no sector hub and no year
archive. Year archives are reachable only from a breach page; sector hubs only from a breach page.
There is no `/breaches/` index and no `/sector/` index route at all.

**A public record you cannot browse is a search-engine artefact, not a record.** This is the
largest structural gap on the site and it is invisible from any single page.

Target nav:

```html
<a href="/">Record</a>
<a href="/breaches/">By year</a>
<a href="/severity/">Severity rubric</a>
<a href="/sources/">Sources &amp; methodology</a>
<a href="/corrections/">Corrections</a>
<a href="/about/">About</a>
```

Home page, replacing the bare `<h2>Recent breaches</h2>`:

```html
<h2>Most recently reported</h2>
<p>The 25 most recent records to enter the government listing. The full record is browsable by
year and by sector below.</p>
${breachTable}
<p class="related"><a href="/breaches/">Browse every year</a> &middot;
<a href="/sector/healthcare/">All healthcare breaches</a></p>

<h2>Browse the full record</h2>
<p>Every record on this site is reachable from one of these listings. Years are the year the
breach was reported to the government, which is not the year it occurred.</p>
${yearIndexTable}
```

Requires two new routes at phase 1: `/breaches` (year index) and `/sector` (sector index).

### 2.3 — P0 · The severity score is systematically misread

For an HHS-only record: `medical` = 22, remediation = 0 (never reported by HHS), lag = 0 (no
discovery date published), scale ∈ {0,3,6,9,12,15}. **Every published page scores exactly one of
22, 25, 28, 31, 34, 37 — out of 100.** The only variable is headcount.

The bar renders that as ~25% filled. A reader parses "25 out of 100" and a quarter-full bar as
*this breach was mild*. It means *this source disclosed four fields*. The number is measuring the
government record's completeness, and its variation across the whole corpus is a proxy for how
many people were affected.

This is the most consequential honesty problem on the site, because it is the one visual element on
the page and it is read backwards.

```html
<p>This score is computed, not assigned. Every component is shown below, and the method is
published in full at <a href="/severity/">the severity rubric</a>.</p>
<p class="record-note">Read this number as a measure of what the source disclosed, not as a
ranking of how bad the breach was. Two of the four components — how long the entity took to give
notice, and what remediation it offered — cannot be scored from this record, because HHS does not
collect either field. They score zero here, and a zero on an unscorable component is not a good
result. It is a blank. A record sourced only from the HHS listing can score no higher than 37 out
of 100 whatever happened, and the only thing that moves it within that range is the number of
individuals reported. Scores are comparable between records drawn from the same sources, and not
between records drawn from different ones.</p>
```

### 2.4 — P0 · "What was exposed: Medical records or diagnoses" overstates the source

The ingest code is scrupulous about this — `'medical'` is asserted from the statute, because the
HIPAA rule is triggered by breaches of protected health information, and nothing else is asserted.
**None of that honesty reaches the page.** The page renders "What was exposed" over "Medical
records or diagnoses" on 7,760 records, when HHS never states diagnoses were exposed and publishes
no data-category field at all. A reader who clicks through will not find that phrase anywhere. It
is also 22 of the 25 points on a typical page.

Change the heading `What was exposed` → **`Categories of information involved`**, and add:

```html
<p class="record-note">HHS does not publish which categories of personal information a breach
exposed. What it publishes is the location the information was held in — a network server, an
email account, paper records. The single class shown above is not drawn from that field and is not
an inference from it. It follows from the rule that put this record on the public list: the HIPAA
Breach Notification Rule is triggered by breaches of unsecured protected health information, so
every record on this listing involves health information by the definition that required it to be
reported. Nothing beyond that is asserted. Whether Social Security numbers, dates of birth,
financial details, or any other category were also involved is not stated by this source, and this
page does not guess.</p>
```

### 2.5 — P0 · The correction channel does not work for the people most likely to use it

`/sources` points corrections at a GitHub issue tracker. Six distinct failures:

1. It requires a GitHub account. The people best placed to catch errors — a hospital compliance
   officer, a records clerk, a person holding a notification letter — do not have one.
2. It is a developer artefact, and landing on an issue tracker tells a reader this is a side
   project, undercutting every other signal.
3. **It forces public disclosure to contest.** An organization that believes its record is wrong
   must publicly restate the allegation before it can dispute it. A Fortune 500 legal department
   will not use it — they will send a letter, to an address that does not exist.
4. It leaks the naming inconsistency (`BreachLedger` repo vs BreachBook site).
5. It commits to nothing — no acknowledgement, no timeline.
6. It contradicts two other pages: `CORRECTIONS.md` sends readers to "the contact information on
   the sources page," and `fetch-util.js` advertises `/sources` as this bot's contact URL to every
   government server it touches. Both point at a page with no address.

```markdown
## Contact

**Corrections and source disputes:** corrections@breachbook.org

Every message to that address is read by a person. A report is acknowledged within two business
days, and a report that cites the government or court document supporting it is actioned as soon
as it is verified against that document — usually the same day, because verification is a matter
of opening the source.

What to include: the record's URL, the fact you believe is wrong, and what the government or court
source says instead. A citation is not required to report an error, but it is the standard the
correction itself has to meet, so a report that includes one moves fastest.

**If you are an organization named in this record** and you believe an entry about you is
inaccurate, that address is the right one, and correspondence to it is not published. What is
published is the correction itself, if one is made: an entry in the correction log stating the
date, the record, what changed, and why.

Two things to know before writing. A record is corrected when it misstates what the source says,
and it is retracted when the underlying report is shown to be unfounded. Neither is available on
request otherwise: this record publishes what the government listing publishes, and an entry is
not removed because it is unwelcome. If the government listing itself is wrong, the correction has
to be made there first — the agency that published it is the only body that can change it — and
this record follows the source once it does.
```

### 2.6 — P1 · Six HHS fields are ingested, stored, and then thrown away before render

This is the answer to the thin-page problem, and it requires no writing at all.

The ingest captures a provenance blob and `run.js` correctly deletes it before the write, because
provenance belongs in `sources.raw_payload` — where the full CSV row is stored. Then
`scripts/export-data.js` strips `raw_payload` from the build input. So these are in D1 and reach no
page:

| HHS column | Rendered | Value |
| --- | --- | --- |
| **Web Description** | no | **OCR's own post-investigation narrative**, present on ~78% of archive rows |
| State | no | the covered entity's state |
| Covered Entity Type | no | provider / plan / clearing house / business associate |
| Location of Breached Information | no | network server, email, paper, laptop, EMR… |
| Business Associate Present | no | yes/no |
| Type of Breach | mapped to 5 internal values | HHS's own wording |

**Web Description alone answers the thin-page problem.** It is the government's account of the
incident, in the government's words, quotable verbatim, on thousands of records. No inference, no
writing. It is the largest unused content asset on this project — bigger than the remediation
modules and state-rights rows combined, because it is per-record.

```html
<h3>The government's account</h3>
<blockquote class="record-note">[Web Description verbatim]</blockquote>
<p class="retrieved">Quoted verbatim from the "Web Description" field of the HHS Office for Civil
Rights breach portal, which OCR publishes on cases whose investigation has closed. Retrieved
7 August 2026.</p>
```

`export-data.js` must stop stripping `raw_payload` wholesale and instead project the six named
columns into a `source_facts` object — not the whole blob; the build-input size concern is valid.

### 2.7 — P1 · "Verifying this record yourself"

The highest-trust addition available, and it is short:

```html
<h2>Verifying this record yourself</h2>
<p>Every fact above can be checked against the government listing directly, without going through
this site.</p>
<ol>
<li>Open the HHS Office for Civil Rights breach portal at
<a href="https://ocrportal.hhs.gov/ocr/breach/breach_report_hip.jsf">ocrportal.hhs.gov</a>.</li>
<li>Search the organization's name in the portal's own filter. Cases reported in roughly the last
24 months appear under "Breaches Currently Under Investigation"; older closed cases are under the
archive tab.</li>
<li>Compare the organization name, state, submission date, individuals affected, breach type, and
location of breached information against the fields above.</li>
</ol>
<p class="record-note">The portal does not give each case its own web address, so this page cannot
link to the individual entry — only to the listing it was retrieved from. Where the two disagree,
the government listing is correct and this record is wrong: the correction channel is on the
<a href="/corrections/">corrections page</a> and a report citing the portal entry is actioned
immediately.</p>
```

That closing sentence — *the government listing is correct and this record is wrong* — is worth
more than any trust badge.

### 2.8 — P1 · Sector and year pages sum record counts into a headcount of people

Both templates render *"The 412 records that disclose a count total 8,204,111 individuals
affected."* That is a sum of per-breach counts: one person appearing in nine breaches is counted
nine times. "Individuals affected" states a population; the arithmetic produces a count of affected
*records*. At corpus scale the overstatement is large, and it is the number most likely to be
quoted off this site.

> The 412 records that disclose a count report 8,204,111 affected individuals between them. That
> figure is the sum of what each entity reported and is not a count of distinct people: one person
> can appear in several breaches, and these sources do not permit deduplication.

### 2.9 — P1 · The rubric changelog is published nowhere

`rubric.json` holds a specific, creditable v1.0→v1.1 entry explaining that v1.0 penalised entities
10 points for a gap in the government record. **That is the single best evidence on this project
that the scoring is maintained honestly — and `/severity` renders only the version number.**

```html
<h2>Rubric changes</h2>
<p>Every change to this rubric is versioned and recorded here. A score carries the version that
produced it, so a number published under an earlier version can be traced to the rules in force
when it was computed. Rubric changes are not corrections and are not logged on the corrections
page: a correction fixes a wrong fact, a rubric change alters how correct facts are weighed.</p>
<h3>Version 1.1 — 6 August 2026</h3>
<p>The remediation gap component now distinguishes a source that affirmatively reports no
remediation was offered (10 points) from a source that does not cover remediation at all (0
points, flagged "not reported by this source"). Under version 1.0 both scored 10, which penalised
an entity for a gap in the government record rather than for its own conduct. This matters at
scale: the HHS breach portal never reports remediation, so every record drawn from it carried an
unearned 10 points.</p>
```

### 2.10 — P1 · Other content items, in brief

- **Home page opening paragraph describes a different site.** It promises "what remediation the
  entity offered, and the litigation that followed" — both render as "not reported" on all 7,760
  pages — and cites "federal **and state** government filings" when no state source is ingested.
  Full replacement copy in the audit source, including a scale-and-currency statement the front
  page currently lacks entirely.
- **Internal build-phase jargon is published.** "Ingestion … begins in Phase 1", "Settlement
  tracking begins in Phase 4." To a reader that is either meaningless or an admission of an
  undisclosed schedule.
- **Index and detail severity scores come from different places** — the index renders the value
  stored at ingest, the detail page recomputes live from the rubric on disk. They agree only until
  a rubric change lands without a re-ingest, after which the same breach shows two numbers on one
  site. Make the detail page assert equality and fail the build on mismatch.
- **`/company/[slug]` must not aggregate.** No averaged severity, no summed headcount, no "repeat
  offender", no ranking, no logo. Full constraint list and complete copy in the audit source — this
  is the page most likely to do harm.
- **`/rights/[state]` has a trap in the seed data:** `ssn_triggers_notice` and
  `free_credit_freeze` are identical on all 51 rows, so pages built around them would be 51
  near-identical pages. The genuine differentiators are the deadline, threshold, and mandated
  monitoring fields, plus the `_notes` research text that is currently not loaded at all.
- **`/breach/[slug]/what-to-do` needs two build guards** before phase 3: fail if any rendered
  module's source host is not `.gov`, and fail on "you should" / "you are entitled" / "you must" /
  "we can" / "we recommend" outside a quoted agency body. `EDITORIAL.md` calls these
  build-blocking; nothing enforces them.

---

## Part 3 — The discoverability layer

### 3.1 — P0 · No sitemap exists

`build.js` writes `robots.txt`, `_headers`, and `404.html`. That is all. For 7,784 pages, of which
7,735 have no navigational path from the home page (§2.2), there is no way to enumerate the record
except by crawling links that do not exist. `ue.config.js` even comments that phase-gated routes
are "excluded from sitemaps," describing a sitemap that was never built.

For a records site this is not merely an SEO matter — a sitemap is the machine-readable statement
of what the record contains. Generate `/sitemap.xml` with `<lastmod>` from `breaches.updated_at`,
and append to `robots.txt`:

```
Sitemap: https://breachbook.org/sitemap.xml
```

### 3.2 — P1 · The `dateModified` rule governs a field that does not exist

`d1-writer.js` goes to real trouble to bump `updated_at` only when a content column actually
changed, and its header comment says the site publishes it. `EDITORIAL.md` has a rule about it:
*"`dateModified` is bumped only when content actually changed. Fake freshness is a fast way to
lose a YMYL-adjacent site."*

**No template emits `dateModified`.** The machinery feeds nothing.

```html
<p class="retrieved">This record was first published 7 August 2026 and last changed 14 August
2026. It is dated as changed only when a published fact on it changed; a retrieval that finds the
source unaltered does not move this date.</p>
```

That last sentence is worth publishing on its own — almost nothing in this vertical can say it
truthfully.

### 3.3 — P1 · Structured data, and the guard it will trip

No JSON-LD in any template. For a page that is literally a dated report about an organization
citing a government source, its absence means search engines reconstruct all of it by guessing.

**One implementation detail that will otherwise cause someone to disable a load-bearing guard:**
`build.js:81` fails the build on *any* `<script` tag, because a script tag in output means data
reached a page unescaped. JSON-LD is `<script type="application/ld+json">`, so it trips that guard.
Verified. The guard is correct and must not be loosened — it needs a narrow exemption for exactly
that type, with the same escaping applied. CSP is not an obstacle: `application/ld+json` is not
executable, so `default-src 'none'` does not block it.

---

## Part 4 — Published claims that are false

The project has a recurring pattern worth naming: **a rule is written, the documentation asserts
it is in force, and the code does not implement it.** It has now happened with `official_claim_url`
(since fixed), `record._regime` (since removed), robots.txt, `dateModified`, and the items below.
For a site whose only asset is trustworthiness this is the most damaging pattern available, and it
is more important than any single item on this list.

**All five are live right now.**

1. **Every HIPAA breach page cites the wrong URL.** Verified:
   ```
   cited on ~7,760 pages : breach_report.jsf      (the portal's front page)
   actually fetched from : breach_report_hip.jsf  (the HIPAA listing)
   published on /sources : breach_report_hip.jsf
   ```
   `run.js` does not override the default. `hhs_part2` gets this right; only HIPAA is wrong. The
   citation block is the site's entire claim, and a sceptical reader clicks it exactly once —
   landing on a generic portal splash converts "every fact traces to a source" into "there is a
   link, and it goes somewhere adjacent." **This is a one-line fix** plus a one-time
   `UPDATE sources SET source_url`.

2. **`/sources` says each ingest retrieves both HHS views.** The scheduled run uses
   `coverage=current` — under-investigation only. The corpus does cover full history from an
   earlier manual run, but the claim that archived records are being re-checked is false: if OCR
   amends or withdraws an archived record, this site will not notice.

3. **`/sources` says robots.txt is respected.** No code reads robots.txt. Phase 2 makes this
   demonstrably false — `oag.ca.gov` publishes `Crawl-delay: 10`.

4. **`/sources` publishes a dead URL as the Maine endpoint.** It returned 404 on 2026-08-07, and
   Maine's listing is in fact withdrawn by the state.

5. **"Every fact on this page comes from the government records below"** is false on every breach
   page. The severity score is not from those records — `/severity` says so outright — and neither
   is the data class, in the sense a reader will take.

Under `EDITORIAL.md`, corrections are never silent, so **these cannot be fixed quietly.** Draft
correction-log entries for all five are in the audit source. That the first entries in this
project's correction log will be about its own source citations is not a bad look — an empty
correction log on a 7,784-page site is the less credible artefact.

---

## Part 5 — Work order

**P0 — trust-critical**

1. Fix the source URL on ~7,760 citation blocks *(one line + one UPDATE + a log entry)*
2. Correct the four other false `/sources` claims, with correction-log entries
3. `/about` page — the site is anonymous
4. A working correction channel and a real contact address
5. Navigation to the 7,735 unreachable pages; `/breaches` and `/sector` indexes
6. `sitemap.xml` and the `robots.txt` reference
7. Severity framing — the 22–37 ceiling stated on the page
8. "Categories of information involved" reframing
9. Contrast fix `--ink-faint` → `#686d74`
10. Icons out of the immutable cache path; favicon, ICO, apple-touch-icon, `<link>` block

**P1** — OG card · severity bar track · print gaps · table accessibility · the six discarded HHS
fields (Web Description first) · "verifying this record yourself" · summed-headcount wording ·
rubric changelog on `/severity` · `dateModified` · JSON-LD · home page opening copy · index/detail
score divergence

**P2** — severity histogram · typography refinements · 404 copy · label and trailing-slash
consistency · `record-meta` fragments · rubric condition strings rendered as code

---

## Part 6 — Grade

Graded on a Fortune 500 curve, where shipping is the baseline and "meets expectations" is high.

| Dimension | Grade | Note |
| --- | --- | --- |
| Engineering discipline | **A−** | 141 tests, build guards that fail the build, honest change tracking, loud-failure ingest policy |
| Editorial doctrine *as written* | **A** | `EDITORIAL.md` is genuinely exceptional for this vertical |
| Editorial doctrine *as implemented* | **C** | repeated pattern of rules that govern nothing |
| Accuracy of published claims | **D+** | five live false statements, one on every record page |
| Information architecture | **D** | 99.4% of pages unreachable from the home page; no sitemap |
| Trust and accountability | **D−** | anonymous, no contact address, correction channel unusable by its intended users |
| Visual design system | **B+** | correct register, disciplined palette, no decoration — spoiled by an invisible bar track |
| Accessibility | **B** | two AA failures, one Safari keyboard trap; otherwise better than most |
| Discoverability | **D** | no sitemap, no structured data, no social card |
| Per-record content depth | **C−** | thin, and thin partly because six retrieved fields are discarded before render |

### Overall: **C+**

The foundation is genuinely top-decile. The severity rubric published with its full formula and
weights, the corrections policy, the refusal to infer data classes HHS does not state, the
`unauthorized access/disclosure → unknown` mapping, the frozen-slug fix, the build guards — these
are things most commercial sites in this vertical do not do and would not think to do. As
*engineering and doctrine*, this is A-grade work.

The delivered surface does not yet match it. Five published statements are false, including one on
every record page. The site is anonymous in a vertical where anonymity is the scammer's
signature. 99.4% of its pages cannot be reached from its front door. And its single most visible
number is systematically read backwards.

The gap between those two paragraphs is the whole grade. This is not a site that lacks rigour —
it is a site whose rigour has not reached its surface. That is a much better problem to have than
the reverse, and it is why the P0 list is short and mostly mechanical.

**With the ten P0 items done, this grades A−.** The P0 list is roughly a week of work, contains no
research risk, and requires exactly one thing I cannot supply: a real name and a real email address
for §2.1 and §2.5.

---

*Sources for this audit: two independent subagent audits (visual assets; content), with all
load-bearing claims verified against the running code. Contrast ratios computed from the hex values
in `site/assets/styles.css`. Citation-URL, build-guard, and cache-header findings verified directly.*
