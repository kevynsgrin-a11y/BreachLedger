#!/usr/bin/env python3
"""Generate BreachBook's raster brand assets from the site's own design tokens.

    python3 scripts/make-brand-assets.py     # requires Pillow

NOT part of the build. `npm run build` copies the committed PNGs from
site/assets as-is; this script exists so those binaries are reproducible rather
than opaque, and so a palette change can be reapplied to them exactly. Rerun it
only when a token below changes, then commit the regenerated files.

Outputs (site/assets/):
  icon-192.png, icon-512.png   PWA/app icons — BB monogram, matching favicon.svg
  og-default.png               1200x630 link preview, site-wide

Tokens mirror site/assets/styles.css:
  --ink #1c1e21   --paper #fbfbfa   --ink-faint #6e737a   --rule #d6d6d1

The preview image deliberately carries no breach-specific text: it is shared
site-wide, and a record from the 42 CFR Part 2 listing must not disclose its
regime through a link card (see docs/EDITORIAL.md).
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

ASSETS = pathlib.Path("/home/user/BreachLedger/site/assets")

INK = (28, 30, 33)
PAPER = (251, 251, 250)
INK_FAINT = (110, 115, 122)
RULE = (214, 214, 209)

SERIF_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
]
SANS_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def load(cands, size):
    for c in cands:
        if pathlib.Path(c).exists():
            try:
                return ImageFont.truetype(c, size)
            except OSError:
                continue
    return ImageFont.load_default()


def centered(draw, box, text, font, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    draw.text((x0 + (x1 - x0 - (r - l)) / 2 - l, y0 + (y1 - y0 - (b - t)) / 2 - t), text, font=font, fill=fill)


def make_icon(size, path):
    """App icon: the BB monogram, matching favicon.svg (ink ground, paper mark)."""
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    centered(d, (0, 0, size, size * 0.94), "BB", load(SERIF_CANDIDATES, int(size * 0.46)), PAPER)
    img.save(path, "PNG", optimize=True)
    return path


def make_og(path):
    """1200x630 link preview. Paper ground so it reads as a document, not an app
    tile — the same institutional register as the site."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # Masthead rule, echoing the site header.
    d.rectangle([0, 0, W, 10], fill=INK)

    title_font = load(SERIF_CANDIDATES, 92)
    tag_font = load(SANS_CANDIDATES, 38)
    foot_font = load(SANS_CANDIDATES, 27)

    d.text((84, 176), "BreachBook", font=title_font, fill=INK)
    d.text((84, 306), "A public record of disclosed", font=tag_font, fill=INK_FAINT)
    d.text((84, 358), "U.S. data breaches", font=tag_font, fill=INK_FAINT)

    d.line([84, 462, W - 84, 462], fill=RULE, width=2)
    d.text((84, 492), "Every entry cites a government or court source.", font=foot_font, fill=INK_FAINT)

    img.save(path, "PNG", optimize=True)
    return path


if __name__ == "__main__":
    for p in [
        make_icon(192, ASSETS / "icon-192.png"),
        make_icon(512, ASSETS / "icon-512.png"),
        make_og(ASSETS / "og-default.png"),
    ]:
        print(f"{p}  {p.stat().st_size / 1024:.1f} KB")
