#!/usr/bin/env python3
"""Generate the original Cubic World launcher icon set and splash background.

The icon is an original design: a floating emerald terrain cube with a glowing
cyan Worldheart crystal above it, on a deep dusk-blue sky. Drawn procedurally --
no external art is used.
"""
import math
import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), "..", "android", "src", "main", "res")

SKY_TOP = (24, 32, 62)
SKY_BOT = (52, 84, 128)
GRASS_TOP = (96, 190, 92)
GRASS_SIDE = (72, 150, 74)
DIRT = (122, 86, 58)
DIRT_DARK = (96, 66, 44)
CRYSTAL = (120, 226, 255)
CRYSTAL_CORE = (215, 250, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 108.0  # design on a 108 grid

    # Rounded sky tile background
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=lerp(SKY_TOP, SKY_BOT, t) + (255,))

    cx, cy = 54 * s, 66 * s
    w, h = 30 * s, 15 * s  # isometric cube half-extents

    def iso(px, py, pz):
        # px right, py up, pz toward viewer-left
        return (cx + (px - pz) * w / 30, cy - py * s + (px + pz) * h / 30)

    # Cube: top face (grass), left face (dirt), right face (grass side over dirt)
    top = [iso(-15, 22, -15), iso(15, 22, -15), iso(15, 22, 15), iso(-15, 22, 15)]
    left = [iso(-15, 22, 15), iso(15, 22, 15), iso(15, -8, 15), iso(-15, -8, 15)]
    right = [iso(15, 22, 15), iso(15, 22, -15), iso(15, -8, -15), iso(15, -8, 15)]
    d.polygon(left, fill=DIRT + (255,))
    d.polygon(right, fill=DIRT_DARK + (255,))
    # grass lip on the vertical faces
    lip = 6 * s
    d.polygon([left[0], left[1], (left[1][0], left[1][1] + lip), (left[0][0], left[0][1] + lip)],
              fill=GRASS_SIDE + (255,))
    d.polygon([right[0], right[1], (right[1][0], right[1][1] + lip), (right[0][0], right[0][1] + lip)],
              fill=(58, 128, 62, 255))
    d.polygon(top, fill=GRASS_TOP + (255,))

    # Pixel speckles on the top face for a hand-painted feel
    rng_seed = 12345
    def prand():
        nonlocal rng_seed
        rng_seed = (rng_seed * 1103515245 + 12345) & 0x7FFFFFFF
        return rng_seed / 0x7FFFFFFF
    for _ in range(int(40 * s * s)):
        u, v = prand() * 26 - 13, prand() * 26 - 13
        px, py = iso(u, 22, v)
        c = (126, 214, 116, 255) if prand() > 0.5 else (82, 168, 84, 255)
        r = max(1, int(1.2 * s))
        d.rectangle([px, py, px + r, py + r], fill=c)

    # Worldheart crystal floating above: a faceted diamond
    ccx, ccy = 54 * s, 26 * s
    cw, ch = 11 * s, 16 * s
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([ccx - cw * 2.2, ccy - ch * 1.6, ccx + cw * 2.2, ccy + ch * 1.6],
               fill=CRYSTAL + (70,))
    img.alpha_composite(glow)
    d.polygon([(ccx, ccy - ch), (ccx + cw, ccy), (ccx, ccy + ch), (ccx - cw, ccy)],
              fill=CRYSTAL + (255,))
    d.polygon([(ccx, ccy - ch), (ccx + cw * 0.35, ccy), (ccx, ccy + ch), (ccx - cw * 0.2, ccy - ch * 0.15)],
              fill=CRYSTAL_CORE + (255,))
    # small orbit shards
    for ang, dist in ((0.6, 1.9), (2.4, 1.7), (4.2, 2.0)):
        sx = ccx + math.cos(ang) * cw * dist
        sy = ccy + math.sin(ang) * ch * 0.8 * dist * 0.5
        r = 2.4 * s
        d.polygon([(sx, sy - r), (sx + r * 0.7, sy), (sx, sy + r), (sx - r * 0.7, sy)],
                  fill=CRYSTAL + (230,))
    return img


def rounded(img, radius_frac=0.18):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

for dpi, px in DENSITIES.items():
    icon = rounded(draw_icon(px * 2).resize((px, px), Image.LANCZOS))
    path = os.path.join(RES, f"mipmap-{dpi}")
    os.makedirs(path, exist_ok=True)
    icon.save(os.path.join(path, "ic_launcher.png"))
    # foreground for adaptive icons: same art on transparent, inset to safe zone
    fg_px = int(px * 108 / 48)
    fg = Image.new("RGBA", (fg_px, fg_px), (0, 0, 0, 0))
    art = draw_icon(int(fg_px * 0.6)).resize((int(fg_px * 0.6), int(fg_px * 0.6)), Image.LANCZOS)
    fg.paste(art, (int(fg_px * 0.2), int(fg_px * 0.2)))
    fg.save(os.path.join(path, "ic_launcher_foreground.png"))

# Splash: simple vertical dusk gradient, 1x1 stretchable strip is enough
splash = Image.new("RGB", (4, 512))
sd = ImageDraw.Draw(splash)
for y in range(512):
    sd.line([(0, y), (4, y)], fill=lerp(SKY_TOP, SKY_BOT, y / 512))
os.makedirs(os.path.join(RES, "drawable"), exist_ok=True)
splash.save(os.path.join(RES, "drawable", "splash_gradient.png"))

print("icons + splash generated")
