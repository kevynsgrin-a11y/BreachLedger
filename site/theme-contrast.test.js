// WCAG contrast guard for both themes.
//
// The palette is a set of CSS custom properties, so a "small" colour tweak can
// silently drop a pairing below AA somewhere it is never looked at — faint text
// inside a zebra-striped row is the case that actually regressed once. This
// reads the real stylesheet and checks every foreground/background pairing the
// templates can produce, in both themes.
//
// Ratios follow WCAG 2.1: AA is 4.5:1 for normal text, 3:1 for a non-text UI
// component. Purely decorative pairings (a hairline rule) are exempt and are
// not asserted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, 'assets', 'styles.css'), 'utf8');

function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(CSS);
const light = tokensIn(rootBlock ? rootBlock[1] : '');
const darkBlock = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/.exec(CSS);
const dark = { ...light, ...tokensIn(darkBlock ? darkBlock[1] : '') };

function relativeLuminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [description, foreground token, background token, minimum ratio]
const PAIRINGS = [
  ['body text on the page', '--ink', '--paper', 4.5],
  ['secondary text on the page', '--ink-soft', '--paper', 4.5],
  ['faint text on the page', '--ink-faint', '--paper', 4.5],
  ['links on the page', '--accent', '--paper', 4.5],
  ['deadline amber on the page', '--deadline-amber', '--paper', 4.5],
  ['table header text on a panel', '--ink-soft', '--panel', 4.5],
  ['faint text on a panel', '--ink-faint', '--panel', 4.5],
  ['body text on a zebra row', '--ink', '--zebra', 4.5],
  // .not-disclosed renders here, which is how the light theme regressed.
  ['faint text on a zebra row', '--ink-faint', '--zebra', 4.5],
  ['links on a zebra row', '--accent', '--zebra', 4.5],
  ['skip link text on its own ground', '--paper', '--ink', 4.5],
  ['code on a panel', '--ink', '--panel', 4.5],
  ['severity bar fill against its track', '--ink-soft', '--panel', 3.0],
];

for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  test(`${themeName} theme defines every colour token`, () => {
    for (const tok of ['--ink', '--ink-soft', '--ink-faint', '--paper', '--panel', '--zebra', '--rule', '--accent', '--deadline-amber']) {
      assert.match(theme[tok] || '', /^#[0-9a-fA-F]{6}$/, `${tok} missing from the ${themeName} theme`);
    }
  });

  for (const [what, fg, bg, min] of PAIRINGS) {
    test(`${themeName} theme: ${what} meets ${min}:1`, () => {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(
        ratio >= min,
        `${fg} (${theme[fg]}) on ${bg} (${theme[bg]}) is ${ratio.toFixed(2)}:1, below ${min}:1`
      );
    });
  }
}

test('a dark theme is actually defined, and is not just the light one', () => {
  assert.ok(darkBlock, 'no prefers-color-scheme: dark block in styles.css');
  assert.notEqual(dark['--paper'], light['--paper'], 'dark theme must change the page ground');
  assert.notEqual(dark['--ink'], light['--ink'], 'dark theme must change the text colour');
});

test('the dark theme actually inverts: its ground is darker than its text', () => {
  assert.ok(
    relativeLuminance(dark['--paper']) < relativeLuminance(dark['--ink']),
    'dark theme ground must be darker than its ink'
  );
  assert.ok(
    relativeLuminance(light['--paper']) > relativeLuminance(light['--ink']),
    'light theme ground must be lighter than its ink'
  );
});

test('the theme follows the system setting and needs no JavaScript', () => {
  // A class-based toggle would need a script, and the site ships none.
  assert.ok(!/\.theme-dark|\[data-theme/.test(CSS), 'theme must not depend on a scripted toggle');
});
