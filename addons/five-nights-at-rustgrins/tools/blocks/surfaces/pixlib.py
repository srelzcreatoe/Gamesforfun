"""Shared helpers for the section-A block art (surfaces, signage, lights).

Everything is deterministic: every texture gets its own numpy Generator seeded
from a fixed integer. Textures are built as float/uint8 numpy arrays:

  color  (H, W, 4) uint8  RGBA
  mer    (H, W, 3) uint8  R metalness, G emissive, B roughness
  height (H, W)    uint8  greyscale heightmap (white = high)
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TEX_DIR = os.path.join(ROOT, 'packs', 'RP', 'textures', 'blocks', 'fnar')
PORTRAITS = os.path.join(ROOT, 'assets', 'portraits')


def hexc(h):
    if not isinstance(h, str):
        return np.asarray(h, dtype=np.float64)
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def ramp(*hexes):
    return np.stack([hexc(h) for h in hexes])


def rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------------ noise
def tile_noise(w, h, cell, seed, smooth=True):
    """Tileable value noise in [0,1] with period (w, h); lattice step `cell` px."""
    r = rng(seed)
    gx, gy = max(1, w // cell), max(1, h // cell)
    lat = r.random((gy, gx))
    ys = (np.arange(h) + 0.5) / cell - 0.5
    xs = (np.arange(w) + 0.5) / cell - 0.5
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    fx = xs - x0
    fy = ys - y0
    if smooth:
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
    a = lat[np.ix_(y0 % gy, x0 % gx)]
    b = lat[np.ix_(y0 % gy, (x0 + 1) % gx)]
    c = lat[np.ix_((y0 + 1) % gy, x0 % gx)]
    d = lat[np.ix_((y0 + 1) % gy, (x0 + 1) % gx)]
    fx = fx[None, :]
    fy = fy[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(w, h, seed, cells=(8, 4, 2), weights=(0.5, 0.3, 0.2)):
    out = np.zeros((h, w))
    for i, (c, wt) in enumerate(zip(cells, weights)):
        out += wt * tile_noise(w, h, c, seed * 31 + i)
    return out / sum(weights)


def white(w, h, seed):
    return rng(seed).random((h, w))


def blur_wrap(a, passes=1):
    """3x3 box blur with wrap-around (keeps tiling)."""
    for _ in range(passes):
        s = np.zeros_like(a, dtype=np.float64)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                s += np.roll(np.roll(a, dy, 0), dx, 1)
        a = s / 9.0
    return a


def norm01(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / (hi - lo + 1e-9)


# ------------------------------------------------------------------ palette mapping
def quant(field, pal, edges=None):
    """Map a [0,1] field to discrete palette entries (pal: (n,3) dark->light)."""
    n = len(pal)
    if edges is None:
        idx = np.clip((field * n).astype(int), 0, n - 1)
    else:
        idx = np.digitize(field, edges)
        idx = np.clip(idx, 0, n - 1)
    return pal[idx]


def rgba(rgb, alpha=255):
    h, w = rgb.shape[:2]
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = np.clip(np.rint(rgb), 0, 255)
    out[..., 3] = alpha
    return out


def mix(a, b, t):
    t = np.asarray(t, dtype=np.float64)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1 - t) + b * t


def shade(rgb, k):
    """Multiply brightness (k may be a 2D field)."""
    k = np.asarray(k, dtype=np.float64)
    if k.ndim == 2:
        k = k[..., None]
    return np.clip(rgb * k, 0, 255)


def desat(rgb, amt):
    g = rgb @ np.array([0.299, 0.587, 0.114])
    return mix(rgb, np.repeat(g[..., None], 3, -1), amt)


# ------------------------------------------------------------------ output
class Tex:
    """A texture with its PBR channels."""

    def __init__(self, w=16, h=16, rough=200, metal=0, height=128):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3))
        self.a = np.full((h, w), 255, np.uint8)
        self.metal = np.full((h, w), float(metal))
        self.emit = np.zeros((h, w))
        self.rough = np.full((h, w), float(rough))
        self.height = np.full((h, w), float(height))

    def color(self):
        out = rgba(self.rgb)
        out[..., 3] = self.a
        return out

    def mer(self):
        m = np.stack([self.metal, self.emit, self.rough], -1)
        return np.clip(np.rint(m), 0, 255).astype(np.uint8)

    def save(self, name, out_dir=TEX_DIR):
        os.makedirs(out_dir, exist_ok=True)
        col = self.color()
        # transparent pixels: keep RGB of nearby opaque pixels to avoid dark fringes in mips
        Image.fromarray(col, 'RGBA').save(os.path.join(out_dir, f'{name}.png'))
        mer = self.mer()
        Image.fromarray(mer, 'RGB').save(os.path.join(out_dir, f'{name}_mer.png'))
        hgt = np.clip(np.rint(self.height), 0, 255).astype(np.uint8)
        Image.fromarray(hgt, 'L').save(os.path.join(out_dir, f'{name}_height.png'))
        ts = {"format_version": "1.21.30", "minecraft:texture_set": {
            "color": name, "metalness_emissive_roughness": f'{name}_mer', "heightmap": f'{name}_height'}}
        with open(os.path.join(out_dir, f'{name}.texture_set.json'), 'w') as f:
            json.dump(ts, f, indent=2)
            f.write('\n')
        return name


def load_tex(name, out_dir=TEX_DIR):
    col = np.array(Image.open(os.path.join(out_dir, f'{name}.png')).convert('RGBA'))
    mer = np.array(Image.open(os.path.join(out_dir, f'{name}_mer.png')).convert('RGB'))
    hgt = np.array(Image.open(os.path.join(out_dir, f'{name}_height.png')).convert('L'))
    return col, mer, hgt


# ------------------------------------------------------------------ pixel-art drawing from ASCII
def from_ascii(rows, keymap, w=None, h=None):
    """rows: list of strings; keymap: char -> hex color or None (transparent).
    Returns (rgb float array, alpha uint8 array, key char array)."""
    h = h or len(rows)
    w = w or max(len(r) for r in rows)
    rgb = np.zeros((h, w, 3))
    a = np.zeros((h, w), np.uint8)
    keys = np.full((h, w), ' ', dtype='<U1')
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            keys[y, x] = ch
            c = keymap.get(ch)
            if c is None:
                continue
            rgb[y, x] = hexc(c)
            a[y, x] = 255
    return rgb, a, keys


# ------------------------------------------------------------------ contact sheets
def contact_sheet(items, path, scale=8, tile3=True, cols=4, bg=(32, 32, 36), label=True):
    """items: list of (label, RGBA uint8 array). Draws each at `scale`x, plus a
    3x3 tiling at scale/2 to its right when tile3."""
    from PIL import ImageDraw
    cells = []
    for name, img in items:
        im = Image.fromarray(img, 'RGBA')
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        if tile3:
            s2 = max(1, scale // 2)
            t = Image.new('RGBA', (im.width * 3, im.height * 3))
            for j in range(3):
                for i in range(3):
                    t.paste(im, (i * im.width, j * im.height))
            t = t.resize((t.width * s2, t.height * s2), Image.NEAREST)
            w = big.width + 8 + t.width
            hh = max(big.height, t.height)
            c = Image.new('RGBA', (w, hh), bg + (255,))
            c.alpha_composite(big, (0, 0))
            c.alpha_composite(t, (big.width + 8, 0))
        else:
            c = Image.new('RGBA', big.size, bg + (255,))
            c.alpha_composite(big)
        cells.append((name, c))
    cw = max(c.width for _, c in cells) + 12
    ch = max(c.height for _, c in cells) + (18 if label else 6)
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGBA', (cw * cols, ch * rows), bg + (255,))
    d = ImageDraw.Draw(sheet)
    for i, (name, c) in enumerate(cells):
        x, y = (i % cols) * cw + 6, (i // cols) * ch + 4
        if label:
            d.text((x, y), name, fill=(220, 220, 220, 255))
            y += 14
        sheet.alpha_composite(c, (x, y))
    sheet.save(path)
    return path
