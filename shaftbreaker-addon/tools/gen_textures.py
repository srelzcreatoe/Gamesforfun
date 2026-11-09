#!/usr/bin/env python3
"""Procedural pixel-art texture generator for "The Shaftbreaker" Bedrock add-on.

Run from anywhere:  python3 tools/gen_textures.py

* Fully deterministic: every texture draws from its own RNG seeded from its
  name (plus SEED), so tweaking one texture never changes the others.
* Output: 16x16 RGBA PNGs (flipbooks are 16 x 16*frames vertical strips).
  - blocks  -> RP/textures/blocks/
  - items   -> RP/textures/items/
  - preview -> previews/textures_sheet.png, previews/blocks_iso.png
* Opaque block textures have alpha 255 everywhere; sprites/items use binary
  alpha (0 or 255) only, because they render with alpha-test.
* Style rules: hard pixels, small palettes, rank-quantised noise (no smooth
  gradients), deliberate highlight/shadow sides (light from the top-left).
"""
import math
import os
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFont

N = 16
SEED = 1337
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCK_DIR = os.path.join(ROOT, 'RP', 'textures', 'blocks')
ITEM_DIR = os.path.join(ROOT, 'RP', 'textures', 'items')
PREVIEW_DIR = os.path.join(ROOT, 'previews')

# --------------------------------------------------------------------------
# basic helpers
# --------------------------------------------------------------------------


def R(name):
    """Per-texture RNG."""
    return np.random.default_rng((zlib.crc32(name.encode()) + SEED) & 0xFFFFFFFF)


def hx(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def P(*hs):
    return [hx(h) for h in hs]


def sh(a, dy, dx):
    """Wrapped shift: result[y, x] = a[y - dy, x - dx]."""
    return np.roll(np.roll(a, dy, 0), dx, 1)


def vnoise(r, cx, cy=None, n=N):
    """Tileable value noise; cx/cy = number of lattice cells across n px."""
    cy = cx if cy is None else cy
    g = r.random((cy, cx))
    xs = (np.arange(n) + 0.5) * cx / n - 0.5
    ys = (np.arange(n) + 0.5) * cy / n - 0.5
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    tx = xs - x0
    ty = ys - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    x1 = (x0 + 1) % cx
    y1 = (y0 + 1) % cy
    x0 %= cx
    y0 %= cy
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]
    d = g[np.ix_(y1, x1)]
    tx = tx[None, :]
    ty = ty[:, None]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def quant(f, weights, mask=None):
    """Rank-quantise field f into len(weights) levels with the given share of
    pixels per level (optionally only inside mask). Returns int levels."""
    out = np.zeros(f.shape, int)
    sel = np.ones(f.shape, bool) if mask is None else mask
    vals = f[sel]
    if vals.size == 0:
        return out
    order = np.argsort(vals, kind='stable')
    ranks = np.empty(vals.size)
    ranks[order] = (np.arange(vals.size) + 0.5) / vals.size
    cum = np.cumsum(weights) / float(sum(weights))
    lv = np.searchsorted(cum, ranks, side='right')
    out[sel] = np.minimum(lv, len(weights) - 1)
    return out


def colorize(idx, pal):
    return np.array(pal, np.uint8)[np.clip(idx, 0, len(pal) - 1)]


def opaque(rgb):
    a = np.full(rgb.shape[:2] + (1,), 255, np.uint8)
    return np.concatenate([rgb.astype(np.uint8), a], axis=2)


def voronoi(pts, n=N):
    """Tileable Voronoi. Returns F1, F2, nearest id, signed offset to nearest."""
    ys, xs = np.mgrid[0:n, 0:n] + 0.5
    ds, vx, vy = [], [], []
    for px, py in pts:
        dx = (xs - px + n / 2) % n - n / 2
        dy = (ys - py + n / 2) % n - n / 2
        ds.append(np.sqrt(dx * dx + dy * dy))
        vx.append(dx)
        vy.append(dy)
    ds = np.array(ds)
    vx = np.array(vx)
    vy = np.array(vy)
    order = np.argsort(ds, axis=0)
    f1 = np.take_along_axis(ds, order[:1], 0)[0]
    f2 = np.take_along_axis(ds, order[1:2], 0)[0]
    oid = order[0]
    ox = np.take_along_axis(vx, order[:1], 0)[0]
    oy = np.take_along_axis(vy, order[:1], 0)[0]
    return f1, f2, oid, ox, oy


def wrapd(x, y, cx, cy, n=N):
    dx = (x - cx + n / 2) % n - n / 2
    dy = (y - cy + n / 2) % n - n / 2
    return dx, dy


DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def walk(r, x, y, d, length, turn=0.35, spread=1):
    """8-direction random walk that never strays more than `spread` steps
    (of 45 deg) from its starting heading. Coordinates wrap (tileable)."""
    d0 = d
    pts = []
    for _ in range(length):
        pts.append((x % N, y % N))
        if r.random() < turn:
            nd = (d + (1 if r.random() < 0.5 else -1)) % 8
            if abs(((nd - d0 + 4) % 8) - 4) <= spread:
                d = nd
        dx, dy = DIRS[d]
        x += dx
        y += dy
    return pts


def line_pts(x0, y0, x1, y1):
    """Bresenham."""
    pts = []
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return pts


def edge4(mask):
    """Pixels of mask with at least one 4-neighbour outside mask (no wrap)."""
    m = np.pad(mask, 1)
    inner = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
    return mask & ~inner


def nb_any(mask, wrap=False):
    """Pixels that have a 4-neighbour inside mask."""
    if wrap:
        return sh(mask, 1, 0) | sh(mask, -1, 0) | sh(mask, 0, 1) | sh(mask, 0, -1)
    m = np.pad(mask, 1)
    return m[:-2, 1:-1] | m[2:, 1:-1] | m[1:-1, :-2] | m[1:-1, 2:]


# --------------------------------------------------------------------------
# sprite canvas
# --------------------------------------------------------------------------


class Spr:
    """RGB + material-id canvas. material 0 = transparent."""

    def __init__(self, n=N):
        self.n = n
        self.c = np.zeros((n, n, 3), np.uint8)
        self.m = np.zeros((n, n), np.int16)

    def px(self, x, y, col, mat=1):
        if 0 <= x < self.n and 0 <= y < self.n:
            self.c[y, x] = hx(col) if isinstance(col, str) else col
            self.m[y, x] = mat

    def clear(self, x, y):
        if 0 <= x < self.n and 0 <= y < self.n:
            self.m[y, x] = 0
            self.c[y, x] = 0

    def get(self, x, y):
        return tuple(self.c[y, x])

    def art(self, rows, legend, ox=0, oy=0, mats=None):
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in '. ':
                    continue
                if ch == '_':  # explicit erase
                    self.clear(x + ox, y + oy)
                    continue
                mat = (mats or {}).get(ch, 1)
                self.px(x + ox, y + oy, legend[ch], mat)

    def outline(self, color_by_mat, default='#1a1010', diag=False):
        mask = self.m > 0
        add = []
        for y in range(self.n):
            for x in range(self.n):
                if mask[y, x]:
                    continue
                nbs = [(0, -1), (0, 1), (-1, 0), (1, 0)]
                if diag:
                    nbs += [(-1, -1), (1, -1), (-1, 1), (1, 1)]
                found = None
                for dx, dy in nbs:
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < self.n and 0 <= yy < self.n and mask[yy, xx]:
                        if default is None and int(self.m[yy, xx]) not in color_by_mat:
                            continue
                        found = int(self.m[yy, xx])
                        break
                if found is not None:
                    add.append((x, y, color_by_mat.get(found, default)))
        for x, y, c in add:
            self.px(x, y, c, 99)

    def rgba(self):
        a = np.where(self.m > 0, 255, 0).astype(np.uint8)[..., None]
        return np.concatenate([self.c, a], axis=2)


def from_rgba(arr):
    s = Spr(arr.shape[1])
    s.c = arr[..., :3].copy()
    s.m = (arr[..., 3] > 0).astype(np.int16)
    return s


# --------------------------------------------------------------------------
# registry
# --------------------------------------------------------------------------

REG = []


def emit(kind, name, arr, frames=1):
    """kind: 'block' (opaque), 'sprite' (block, binary alpha) or 'item'."""
    REG.append(dict(kind=kind, name=name, arr=np.ascontiguousarray(arr, np.uint8), frames=frames))
    return arr


def get(name):
    for e in REG:
        if e['name'] == name:
            return e['arr']
    raise KeyError(name)


# --------------------------------------------------------------------------
# palettes
# --------------------------------------------------------------------------

STONE = P('#666264', '#6f6b6d', '#787476', '#817d7f', '#8a8688', '#949092')
VEIN = P('#3d0b0e', '#5c1216', '#7a1a1d')
VEIN_FADE = hx('#6a5052')  # vein dipping under the stone surface
DEEP = P('#2c2c32', '#35353b', '#3e3e44', '#47474d', '#505056', '#5a5a60', '#65656a')
DEEP_VEIN = P('#4a0d10', '#6a1519', '#8c2226')
DEEP_FADE = hx('#4a383c')
FLESH = P('#330a0d', '#4a1014', '#5c151a', '#6e1a1e', '#8c2a2a', '#a8443c')
MOSS = P('#2e0a0c', '#3b0d10', '#4c1114', '#5e1518', '#701b1c', '#8a2424', '#a63a30')
BONE = P('#6e6450', '#8f8366', '#b3a585', '#cfc3a5', '#e3d9c0', '#efe8d6')
STAIN = P('#5a1a16', '#7e2a22')


# --------------------------------------------------------------------------
# stone / deepslate bases
# --------------------------------------------------------------------------


def stone_idx(seed='stone_base'):
    """Vanilla-stone-like index map (6 levels): soft 2-4 px clusters plus
    short dark pits with a lit lower lip."""
    r = R(seed)
    f = 0.4 * vnoise(r, 4) + 0.42 * vnoise(r, 8) + 0.34 * r.random((N, N))
    idx = quant(f, [4, 14, 30, 30, 16, 6])
    for _ in range(6):
        x, y = (int(v) for v in r.integers(N, size=2))
        L = int(r.integers(2, 5))
        for i in range(L):
            xx = (x + i) % N
            idx[y, xx] = min(idx[y, xx], 1 if i in (0, L - 1) else 0)
        xx = (x + int(r.integers(L))) % N
        idx[(y + 1) % N, xx] = max(idx[(y + 1) % N, xx], 4)
    return idx


def deep_idx(seed='deep_base'):
    """Deepslate side: horizontal streaky layering."""
    r = R(seed)
    f = 0.5 * vnoise(r, 4, 16) + 0.3 * vnoise(r, 2, 8) + 0.22 * r.random((N, N))
    idx = quant(f, [4, 12, 22, 27, 20, 11, 4])
    for _ in range(6):
        x, y = (int(v) for v in r.integers(N, size=2))
        L = int(r.integers(3, 7))
        for i in range(L):
            xx = (x + i) % N
            idx[y, xx] = 0 if 0 < i < L - 1 else min(idx[y, xx], 1)
            if r.random() < 0.5:
                idx[(y - 1) % N, xx] = max(idx[(y - 1) % N, xx], 5)
    return idx


def deep_top_idx(seed='deep_top_base'):
    r = R(seed)
    f = 0.45 * vnoise(r, 4) + 0.38 * vnoise(r, 8) + 0.36 * r.random((N, N))
    idx = quant(f, [4, 12, 24, 28, 20, 9, 3])
    for _ in range(5):  # small dark cell outlines like vanilla deepslate_top
        x, y = (int(v) for v in r.integers(N, size=2))
        for (xx, yy) in walk(r, x, y, int(r.integers(8)), int(r.integers(3, 6)), turn=0.6, spread=2):
            idx[yy, xx] = min(idx[yy, xx], 1)
    return idx


def smooth1d(r, L, step=4):
    k = L // step + 2
    g = r.random(k)
    t = np.arange(L) / step
    i = np.floor(t).astype(int)
    f = t - i
    f = f * f * (3 - 2 * f)
    return g[i] * (1 - f) + g[i + 1] * f


def vein_paths(r, n, length=(15, 21), branches=(1, 2), dirs=None, turn=0.5, spread=2, target=32):
    paths = []
    for _ in range(n):
        x, y = int(r.integers(N)), int(r.integers(N))
        d = int(r.choice(dirs)) if dirs is not None else int(r.integers(8))
        main = walk(r, x, y, d, int(r.integers(*length)), turn=turn, spread=spread)
        paths.append(('main', main))
        for _ in range(int(r.integers(branches[0], branches[1] + 1))):
            i = int(r.integers(4, len(main) - 4))
            bx, by = main[i]
            bd = (d + (2 if r.random() < 0.5 else -2)) % 8
            br = walk(r, bx, by, bd, int(r.integers(4, 7)), turn=0.4)[1:]
            paths.append(('branch', br))
    return paths


def pick_veins(r, tries=40, **kw):
    """Deterministically try several vein layouts and keep the one that is
    best spread over the tile without clumping (looks deliberate, tiles well)."""
    best = None
    for _ in range(tries):
        paths = vein_paths(r, **kw)
        m = np.zeros((N, N), bool)
        for _, pts in paths:
            for x, y in pts:
                m[y, x] = True
        nb = sum(sh(m, dy, dx).astype(int) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        clump = int((m & (nb >= 4)).sum())
        cover = int(m.any(0).sum() + m.any(1).sum())
        score = cover - 3 * clump - 0.15 * abs(int(m.sum()) - kw.get('target', 32))
        if best is None or score > best[0]:
            best = (score, paths)
    return best[1]


def draw_veins(rgb, idx, base_pal, paths, vp, fade, r, shade_drop=1, fade_t=0.33, bright_t=0.68):
    """Veins: dark ends, mostly mid colour, a few bright stretches and some
    'submerged' stretches drawn in a stone-red blend. Shadow below."""
    out = rgb.copy()
    vm = np.zeros((N, N), bool)
    for _, pts in paths:
        for x, y in pts:
            vm[y, x] = True
    cols = []
    for kind, pts in paths:
        L = len(pts)
        dn = smooth1d(r, L)
        for i, (x, y) in enumerate(pts):
            end = min(i, L - 1 - i)
            if kind == 'branch':
                c = 0 if (L - 1 - i) < 2 else 1
            elif end < 1:
                c = 0
            elif dn[i] < fade_t:
                c = 3
            elif dn[i] > bright_t and end > 1:
                c = 2
            else:
                c = 1
            cols.append((x, y, c))
    for x, y, c in cols:
        yy = (y + 1) % N
        if c in (1, 2) and not vm[yy, x]:
            out[yy, x] = base_pal[max(idx[yy, x] - shade_drop, 0)]
    for x, y, c in cols:
        out[y, x] = fade if c == 3 else vp[c]
    return out, vm


# --------------------------------------------------------------------------
# 1-3  veinstone family
# --------------------------------------------------------------------------


def gen_veinstone():
    idx = stone_idx()
    r = R('veinstone')
    paths = pick_veins(r, n=2, branches=(1, 2), turn=0.4, spread=1)
    rgb, _ = draw_veins(colorize(idx, STONE), idx, STONE, paths, VEIN, VEIN_FADE, r, fade_t=0.4, bright_t=0.76)
    emit('block', 'veinstone.png', opaque(rgb))


def gen_deep_veinstone():
    idx = deep_idx()
    r = R('deep_veinstone')
    paths = pick_veins(r, n=2, branches=(1, 1), dirs=[0, 4], turn=0.3, spread=1, target=30)
    rgb, _ = draw_veins(colorize(idx, DEEP), idx, DEEP, paths, DEEP_VEIN, DEEP_FADE, r)
    emit('block', 'deep_veinstone.png', opaque(rgb))

    idx = deep_top_idx()
    r = R('deep_veinstone_top')
    paths = pick_veins(r, n=2, length=(10, 15), branches=(0, 1), target=24)
    rgb, _ = draw_veins(colorize(idx, DEEP), idx, DEEP, paths, DEEP_VEIN, DEEP_FADE, r)
    emit('block', 'deep_veinstone_top.png', opaque(rgb))


CRACK = P('#8a1410', '#d42a1e', '#ff5a3c', '#ffa064')
LIT_STONE = hx('#8e6c66')


def gen_cracked_veinstone():
    idx = np.minimum(stone_idx(), 4)  # 5 stone shades leave room for the glow
    r = R('cracked_veinstone')
    rgb = colorize(idx, STONE)
    vpaths = pick_veins(R('veinstone'), n=2, branches=(1, 2), turn=0.4, spread=1)
    rgb, _ = draw_veins(rgb, idx, STONE, vpaths, VEIN, VEIN_FADE, r, fade_t=0.45, bright_t=0.9)
    paths = []
    for (sx, sy, d, L) in [(2, 2, 1, 18), (13, 0, 3, 16)]:
        pts = walk(r, sx, sy, d, L, turn=0.55, spread=1)
        paths.append(('main', pts))
        i = int(r.integers(6, L - 6))
        paths.append(('branch', walk(r, pts[i][0], pts[i][1], (d + 2) % 8, int(r.integers(4, 6)), turn=0.5)[1:]))
    core = np.zeros((N, N), bool)
    for _, pts in paths:
        for x, y in pts:
            core[y, x] = True
    # widen the middle of the main cracks to 2 px in places
    mid = np.zeros((N, N), bool)
    for kind, pts in paths:
        if kind != 'main':
            continue
        for i, (x, y) in enumerate(pts):
            if 4 < i < len(pts) - 5 and r.random() < 0.4:
                xx, yy = ((x + 1) % N, y)
                if not core[yy, xx]:
                    mid[yy, xx] = True
    glow = core | mid
    # dark-red scorched rim only directly below/right of the crack, lit stone above
    below = sh(glow, 1, 0) & ~glow
    right = sh(glow, 0, 1) & ~glow
    above = sh(glow, -1, 0) & ~glow
    rnd = r.random((N, N))
    rgb[above & (rnd < 0.45)] = LIT_STONE
    rgb[(below | right) & (rnd < 0.7)] = CRACK[0]
    rgb[mid] = CRACK[1]
    for kind, pts in paths:
        L = len(pts)
        for i, (x, y) in enumerate(pts):
            end = min(i, L - 1 - i) if kind == 'main' else L - 1 - i
            rgb[y, x] = CRACK[2] if end >= 2 else CRACK[1] if end >= 1 else CRACK[0]
    # white-hot pixels where the crack is widest
    for y, x in zip(*np.nonzero(core & sh(mid, 0, -1))):
        if r.random() < 0.5:
            rgb[y, x] = CRACK[3]
    emit('block', 'cracked_veinstone.png', opaque(rgb))


# --------------------------------------------------------------------------
# 4-5  flesh
# --------------------------------------------------------------------------

STONE_FRAG = [
    ['.ab', 'abc', 'bc.'],
    ['ab', 'bc'],
]


def flesh_lumps(r, npts=14, jitter=1.0, soft=2.2):
    """Pillow-like lumps: flat-ish tops, slopes toward thin crevices."""
    pts = r.random((npts, 2)) * N
    f1, f2, oid, ox, oy = voronoi(pts)
    border = (f2 - f1) + jitter * (vnoise(r, 8) - 0.5)
    h = np.clip(border / soft, 0, 1)
    lit = h - sh(h, 1, 1)
    return h, lit, border


def gen_fleshstone():
    r = R('fleshstone')
    h, lit, border = flesh_lumps(r)
    f = 0.55 * h + 1.5 * lit + 0.18 * r.random((N, N))
    idx = quant(f, [0, 13, 27, 30, 21, 9])  # levels 1..5
    crev = border < 0.5
    idx[crev] = np.where(r.random((N, N)) < 0.75, 0, 1)[crev]
    rgb = colorize(idx, FLESH)
    frag_pal = {'a': hx('#948f91'), 'b': hx('#77737a'), 'c': hx('#58545a')}
    for (fx, fy), shape in zip([(3, 2), (11, 10)], STONE_FRAG):
        for yy, row in enumerate(shape):
            for xx, ch in enumerate(row):
                if ch != '.':
                    rgb[(fy + yy) % N, (fx + xx) % N] = frag_pal[ch]
        rgb[(fy + len(shape)) % N, (fx + 1) % N] = FLESH[0]  # flesh pinches under it
        rgb[(fy + 1) % N, (fx + len(shape[0])) % N] = FLESH[0]
    emit('block', 'fleshstone.png', opaque(rgb))


PULSE = P('#260709', '#3e0d10', '#561316', '#6e1a1e', '#8c2a2a', '#a8443c', '#c0453a', '#e06a52')
BEAT = [0.0, 0.45, 1.0, 0.8, 0.5, 0.3, 0.15, 0.05]  # loops: 0.05 -> 0.0


def gen_pulsing_flesh():
    r = R('pulsing_flesh')
    h, lit, border = flesh_lumps(r, npts=13)
    f = 0.55 * h + 1.3 * lit + 0.15 * r.random((N, N))
    base = quant(f, [0, 16, 40, 34, 10])  # levels 1..4: calmer than the nodules
    base[border < 0.45] = 1
    veins = []
    for pts in [walk(r, 0, 7, 0, 17, 0.45), walk(r, 9, 0, 2, 17, 0.45)]:
        veins += pts
    nods = [(4.5, 4.5, 2.0, 0), (11.5, 11.0, 2.3, 1), (12.5, 3.0, 1.4, 2)]
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    frames = []
    for fi in range(8):
        lv = base.copy()
        for x, y in veins:
            lv[y, x] = 0
            if (x, (y + 1) % N) not in veins:
                lv[(y + 1) % N, x] = min(lv[(y + 1) % N, x], 2)
        for (cx, cy, r0, lag) in nods:
            b = BEAT[(fi - lag) % 8]
            rr = r0 + 0.85 * b
            dx, dy = wrapd(xs, ys, cx, cy)
            d = np.sqrt(dx * dx + dy * dy)
            inside = d <= rr
            z = np.sqrt(np.clip(1 - (d / rr) ** 2, 0, 1))
            s = -(dx + dy) / (1.414 * rr)
            light = 0.55 * z + 0.5 * s
            nl = np.clip(3 + np.floor(light * 2.8) + (1 if b > 0.5 else 0), 2, 6).astype(int)
            rim = (d > rr) & (d <= rr + 0.9)
            lv[rim & ((dx + dy) > -0.5)] = 0
            lv[rim & ((dx + dy) <= -0.5)] = 1
            lv[inside] = nl[inside]
            hxp, hyp = int(math.floor(cx - 0.5 * rr)) % N, int(math.floor(cy - 0.5 * rr)) % N
            lv[hyp, hxp] = 7 if b > 0.55 else 6 if b > 0.2 else 5
        frames.append(colorize(lv, PULSE))
    emit('block', 'pulsing_flesh.png', opaque(np.concatenate(frames, 0)), frames=8)


# --------------------------------------------------------------------------
# 6-8  organs
# --------------------------------------------------------------------------

PLATE = P('#1e0608', '#310a0d', '#470f13', '#5e1518', '#7a1f22', '#a03a33', '#d4705e')
GLOW = P('#3a0a0a', '#5e0e0e', '#8a1410', '#d42a1e', '#ff5a3c', '#ff9a6a')
GLOW_CURVE = [0.45, 0.75, 1.0, 1.0, 0.7, 0.45, 0.2, 0.2]
def hex_pts(r, jitter=1.2, rows=4, cols=2):
    """Jittered hex lattice that tiles 16x16 (even plate sizes)."""
    pts = []
    for j in range(rows):
        for i in range(cols):
            x = (i + 0.5 * (j % 2)) * N / cols + 1.0
            y = (j + 0.5) * N / rows
            pts.append(((x + r.uniform(-jitter, jitter)) % N, (y + r.uniform(-jitter, jitter)) % N))
    return np.array(pts)


def poisson_pts(r, n, mind, tries=4000):
    """Dart-throwing on the torus: irregular but evenly spaced points."""
    pts = []
    for _ in range(tries):
        if len(pts) == n:
            break
        x, y = r.random() * N, r.random() * N
        if all(math.hypot(*wrapd(x, y, px, py)) >= mind for px, py in pts):
            pts.append((x, y))
    return np.array(pts)


ORGAN_PTS = poisson_pts(R('organ_layout'), 7, 5.2)


def organ_layout():
    return voronoi(ORGAN_PTS)


def plate_shade(r, f1, f2, ox, oy, crack, weights, noise=0.2, radius=4.5):
    """Dome-shaded plates, lit from the top-left, darker toward their rims."""
    h = np.clip((f2 - f1) / 2.5, 0, 1)
    lit = -(ox + oy) / (f1 + 1.2)
    f = 0.8 * h + 0.6 * lit + noise * r.random((N, N))
    return quant(f, weights, mask=~crack)


def bevel_plates(oid, crack, h, r, noise=0.25):
    """Plate levels 0..4: lit rim on the top-left edge of each plate, dark rim
    bottom-right, domed interior."""
    up = sh(crack, 1, 0) | (sh(oid, 1, 0) != oid)
    left = sh(crack, 0, 1) | (sh(oid, 0, 1) != oid)
    down = sh(crack, -1, 0) | (sh(oid, -1, 0) != oid)
    right = sh(crack, 0, -1) | (sh(oid, 0, -1) != oid)
    f = h + noise * r.random((N, N))
    lv = np.where(f > 0.8, 3, 2)
    lv[(down | right)] = 1
    lv[(up | left) & ~(down | right)] = 4
    lv[(down & right)] = 0
    return lv


def gen_organ_core():
    r = R('organ_core')
    f1, f2, oid, ox, oy = organ_layout()
    gap = f2 - f1
    crack = gap < 0.5
    h = np.clip(1 - f1 / 4.0, 0, 1)
    plate = bevel_plates(oid, crack, h, r, noise=0.15)
    # dark veins: a short branching line across each plate, from the bottom-right
    for (px, py) in ORGAN_PTS:
        d0 = int(r.choice([0, 1, 2, 7]))
        pts = walk(r, int(px + 1) % N, int(py + 1) % N, d0, 5, 0.4)
        for k, (xx, yy) in enumerate(pts):
            if crack[yy, xx] or plate[yy, xx] in (0, 4):
                break
            plate[yy, xx] = 1
    spec = []
    for (px, py) in ORGAN_PTS:
        sx, sy = int(px - 1.0) % N, int(py - 1.0) % N
        if not crack[sy, sx] and not crack[sy, (sx + 1) % N]:
            spec.append((sx, sy))
    nbc = (sh(crack, 1, 0).astype(int) + sh(crack, -1, 0) + sh(crack, 0, 1) + sh(crack, 0, -1))
    junction = crack & (nbc >= 3) & (gap < 0.25)
    frames = []
    for fi in range(8):
        g = GLOW_CURVE[fi]
        pl = plate.copy()
        if g >= 0.7:  # glow spills onto the plate rims
            spill = nb_any(crack, wrap=True) & ~crack
            pl[spill] = np.minimum(pl[spill] + 1, 4)
        rgb = colorize(pl, PLATE)
        for (sx, sy) in spec:
            rgb[sy, sx] = PLATE[6]
            rgb[sy, (sx + 1) % N] = PLATE[5]
        gl = np.full((N, N), int(round(g * 3.2)) + 1)
        gl = np.clip(gl - (gap > 0.3), 0, 4)
        gl[junction] = min(int(round(g * 3.2)) + 2, 5)
        rgb[crack] = colorize(gl, GLOW)[crack]
        frames.append(rgb)
    emit('block', 'organ_core.png', opaque(np.concatenate(frames, 0)), frames=8)


HUSK = P('#1a1010', '#2e2220', '#423230', '#564440', '#6a5650', '#806a60')
HUSK_M = P('#1a1010', '#341a1a', '#4a2624', '#5e322e', '#723e38', '#864c44')


def gen_cracked_organ_core():
    r = R('cracked_organ_core')
    f1, f2, oid, ox, oy = organ_layout()
    gap = f2 - f1
    crack = gap < 0.75
    lv = plate_shade(r, f1, f2, ox, oy, crack, [0, 14, 30, 32, 18, 6], noise=0.45)
    lv[crack] = 0
    lip = sh(crack, 1, 1) & ~crack  # plate edge below/right of a crack is shadowed
    lv[lip] = np.minimum(lv[lip], 1)
    top = sh(crack, -1, -1) & ~crack  # upper lip catches light: dry curled edge
    lv[top] = np.maximum(lv[top], 4)
    for _ in range(5):  # dry fissures
        x, y = (int(v) for v in r.integers(N, size=2))
        for xx, yy in walk(r, x, y, int(r.integers(8)), int(r.integers(3, 6)), 0.6, 2):
            lv[yy, xx] = 1
    rgb = colorize(lv, HUSK)
    maroon = (oid % 3) == 0
    rgb[maroon] = colorize(lv, HUSK_M)[maroon]
    for _ in range(5):  # dusty flecks
        x, y = (int(v) for v in r.integers(N, size=2))
        if lv[y, x] >= 2:
            rgb[y, x] = hx('#968070')
    emit('block', 'cracked_organ_core.png', opaque(rgb))


HEART_MEM = P('#1e0507', '#2e080b', '#440d11', '#5e1418', '#7a1e20', '#a83c34', '#c8584a')
CORE = P('#7a1414', '#b02a1e', '#e04a34', '#ff7a5a', '#ffb48a')
THROB = [0.35, 1.0, 0.85, 0.55, 0.35, 0.2, 0.15, 0.2]


def gen_dwelling_heart():
    r = R('dwelling_heart')
    pts = r.random((9, 2)) * N
    f1, f2, oid, ox, oy = voronoi(pts)
    mcrack = (f2 - f1) < 0.6
    base = plate_shade(r, f1, f2, ox, oy, mcrack, [10, 28, 34, 20, 8], noise=0.12)  # 0..4
    base[mcrack] = 0
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    cx, cy = 8.0, 8.0
    angles = [-100, -40, 15, 70, 125, 165, 215, 260, 300]
    vein_d = np.full((N, N), 99.0)
    vein_side = np.zeros((N, N))
    for a in angles:
        a = math.radians(a + r.uniform(-8, 8))
        wob = r.uniform(-0.8, 0.8)
        for t in np.linspace(0, 1, 40):
            rad = 2.0 + t * 10.5
            aa = a + wob * t * t
            px, py = cx + rad * math.cos(aa), cy + rad * math.sin(aa)
            w = 1.3 * (1 - t) + 0.45
            d = np.sqrt((xs - px) ** 2 + (ys - py) ** 2) - w
            upd = d < vein_d
            vein_d[upd] = d[upd]
            nx, ny = -math.sin(aa), math.cos(aa)
            sidev = (xs - px) * nx + (ys - py) * ny
            vein_side[upd] = (sidev * (-(nx + ny)))[upd]
    vein = vein_d <= 0
    frames = []
    for fi in range(8):
        c = THROB[fi]
        lv = base.copy()
        W = 1.9 + 1.5 * c
        H = 6.0 + 1.0 * c
        dyn = (ys - cy) / H
        lens_w = W * np.clip(1 - dyn * dyn, 0, 1)  # pointed (vesica) split
        lens = (np.abs(xs - cx) < lens_w) & (np.abs(dyn) < 1)
        lip = ~lens & (np.abs(xs - cx) < lens_w + 1.3) & (np.abs(dyn) < 1.12)
        vlv = np.where(vein_side > 0.3, 4, np.where(vein_side < -0.3, 2, 3))
        if c > 0.8:
            vlv = vlv + 1
        lv[vein] = vlv[vein]
        vsh = sh(vein, 1, 1) & ~vein
        lv[vsh] = 0
        rgb = colorize(lv, HEART_MEM)
        lipc = np.where(xs < cx, 6 if c > 0.5 else 5, 4 if c > 0.5 else 3)
        rgb[lip] = colorize(lipc.astype(int), HEART_MEM)[lip]
        rn = np.sqrt(((xs - cx) / (W + 0.4)) ** 2 + dyn ** 2)
        cl = np.clip(np.floor((1.0 - rn) * (3.0 + 1.6 * c)), 0, 4).astype(int)
        if c < 0.5:
            cl = np.minimum(cl, 3)
        rgb[lens] = colorize(cl, CORE)[lens]
        if c > 0.5:  # hairline glow cracks near the core at peak
            hc = mcrack & (np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) < 3.0 + 3 * c) & ~lens & ~lip & ~vein
            rgb[hc] = CORE[1] if c > 0.9 else CORE[0]
        frames.append(rgb)
    emit('block', 'dwelling_heart.png', opaque(np.concatenate(frames, 0)), frames=8)


# --------------------------------------------------------------------------
# 9-10 bloodmoss
# --------------------------------------------------------------------------


def moss_idx():
    """Clumpy moss: small tufts lit on their top-left, dark gaps between."""
    r = R('bloodmoss')
    pts = r.random((24, 2)) * N
    f1, f2, oid, ox, oy = voronoi(pts)
    h = np.clip((f2 - f1) / 1.6, 0, 1)
    lit = -(ox + oy) / (f1 + 0.8)
    f = 0.55 * h + 0.45 * lit + 0.35 * r.random((N, N))
    idx = quant(f, [4, 9, 18, 25, 22, 15, 7])
    idx = np.minimum(idx, 5)
    for _ in range(5):  # lighter strands with a dark root
        x, y = (int(v) for v in r.integers(N, size=2))
        d = int(r.choice([1, 2, 3]))
        L = int(r.integers(2, 4))
        for i in range(L):
            idx[(y + DIRS[d][1] * i) % N, (x + DIRS[d][0] * i) % N] = 6 if i < L - 1 else 5
        idx[(y + DIRS[d][1] * L) % N, (x + DIRS[d][0] * L) % N] = 1
    return idx


def gen_bloodmoss():
    emit('block', 'bloodmoss.png', opaque(colorize(moss_idx(), MOSS)))


def gen_bloodmoss_side():
    r = R('bloodmoss_side')
    midx = moss_idx()
    sidx = stone_idx('stone_side_base')
    rgb = colorize(sidx, STONE)
    depth = np.zeros(N, int)
    d = 5
    for x in range(N):
        d = int(np.clip(d + r.integers(-1, 2), 4, 6))
        depth[x] = d
    depth[N - 1] = int(np.clip(depth[N - 1], depth[0] - 1, depth[0] + 1))
    drips = {2: 3, 7: 5, 8: 2, 12: 4, 14: 1}
    for x in range(N):
        bottom = depth[x] + drips.get(x, 0)
        for y in range(bottom):
            if y < depth[x]:
                rgb[y, x] = MOSS[midx[y, x]]
            else:
                rgb[y, x] = MOSS[3] if (y - depth[x]) % 2 == 0 else MOSS[4]
        if x in drips:
            rgb[bottom - 1, x] = MOSS[6]  # wet glint at the tip
        # shadow on stone under the moss
        rgb[bottom, x] = STONE[max(sidx[bottom, x] - 2, 0)]
        if bottom + 1 < N and x not in drips:
            rgb[bottom + 1, x] = STONE[max(sidx[bottom + 1, x] - 1, 0)]
    emit('block', 'bloodmoss_side.png', opaque(rgb))


# --------------------------------------------------------------------------
# 11 ribstone
# --------------------------------------------------------------------------


def gen_ribstone():
    r = R('ribstone')
    # side: three rounded rib bones (lit top, shaded underside) separated by
    # dark gaps; every column is the same profile shifted by a gentle wave so
    # the ribs bend together (tiles in both directions)
    profile = [4, 5, 3, 2, 0, 4, 5, 3, 2, 0, 4, 4, 3, 3, 2, 0]
    ph = r.uniform(0, 2 * math.pi)
    off = [int(round(1.0 * math.sin(2 * math.pi * x / 16 + ph))) for x in range(N)]
    grain = vnoise(r, 2, 16)
    noise = r.random((N, N))
    lv = np.zeros((N, N), int)
    for x in range(N):
        for y in range(N):
            v = profile[(y - off[x]) % N]
            if v == 3 and grain[y, x] < 0.3:
                v = 2  # long grain streaks
            if v == 5 and noise[y, x] < 0.25:
                v = 4
            if v == 0 and noise[y, x] < 0.3:
                v = 1
            lv[y, x] = v
    for _ in range(6):  # pores
        x, y = (int(v) for v in r.integers(N, size=2))
        if lv[y, x] in (3, 4):
            lv[y, x] = 2
    rgb = colorize(np.where(lv == 5, 5, lv), BONE)
    # dried blood seeping out of two gaps
    for (x, gy, sidx) in [(6, 4, 0), (7, 4, 1), (7, 5, 0), (13, 15, 1), (14, 15, 0), (2, 9, 1)]:
        rgb[(gy + off[x]) % N, x] = STAIN[sidx]
    emit('block', 'ribstone_side.png', opaque(rgb))

    # top: cross-section of fused bones
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    lv = quant(0.6 * vnoise(r, 8) + 0.6 * r.random((N, N)), [12, 40, 36, 12]) + 1  # matrix 1..4
    lv = np.minimum(lv, 3)
    circles = [(4.0, 4.0, 3.4), (12.0, 4.5, 3.0), (4.5, 12.0, 3.0), (12.0, 12.0, 3.4), (8.0, 8.0, 1.6)]
    marrow = []
    for (cx, cy, rad) in circles:
        dx, dy = wrapd(xs, ys, cx, cy)
        d = np.sqrt(dx * dx + dy * dy)
        gap = (d > rad) & (d <= rad + 0.8)
        ring = (d <= rad) & (d > rad - 1.0)
        inner = d <= rad - 1.0
        tl = (dx + dy) < 0
        lv[gap] = 1
        lv[gap & ~tl] = 0
        lv[ring & tl] = 4
        lv[ring & ~tl] = 3
        lv[inner] = 3
        lv[inner & (dx + dy > 0.5)] = 2  # concave: inside lit from bottom-right
        if rad > 2:
            marrow.append((int(cx) % N, int(cy) % N))
    rgb = colorize(lv, BONE)
    for (mx, my) in marrow:
        rgb[my, mx] = hx('#6a3a2a')
        rgb[my, (mx - 1) % N] = hx('#8a5a40')
        rgb[(my - 1) % N, (mx - 1) % N] = hx('#8f8366')
    rgb[12, 13] = STAIN[0]
    rgb[11, 12] = STAIN[1]
    rgb[3, 9] = STAIN[1]
    emit('block', 'ribstone_top.png', opaque(rgb))


# --------------------------------------------------------------------------
# 12 dripfang (pointed-dripstone style, hanging)
# --------------------------------------------------------------------------

DRIP = P('#3e3532', '#5d5450', '#7a6f68', '#9a8e85', '#b2a69b')
DSTREAK = P('#4a1012', '#7a1e1c')


def dripfang_piece(name, widths, streaks, drop=False):
    r = R(name)
    s = Spr()
    jit = R('dripfang_jitter').integers(0, 2, size=N)
    cols = R('dripfang_cols').integers(-1, 2, size=N)
    last = None
    for y in range(N):
        w = widths[y]
        if w <= 0:
            continue
        left = 8 - w // 2 - (w % 2) * int(jit[y])
        for x in range(left, left + w):
            u = (x - left + 0.5) / w
            if w <= 2:
                lv = 2 if x == left else 1
            else:
                lv = 2 if u < 0.2 else 3 if u < 0.5 else 2 if u < 0.72 else 1 if u < 0.9 else 0
                if 0 < x - left < w - 1 and r.random() < 0.55:
                    lv = int(np.clip(lv + cols[x], 1, 3))
                if lv == 3 and r.random() < 0.22:
                    lv = 4
            s.px(x, y, DRIP[lv])
        for (u0, y0, y1) in streaks:
            if y0 <= y < y1 and w >= 3:
                x = left + int(u0 * w)
                s.px(x, y, DSTREAK[0] if y in (y0, y1 - 1) else DSTREAK[1])
        last = (left, w, y)
    if drop:
        left, w, y = last
        x = left + w // 2
        s.px(x, y + 1, '#8a1410')
        s.px(x, y + 2, '#d23a2a')
    return s.rgba()


def gen_dripfang():
    base_w = [12, 12, 12, 11, 11, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 8]
    mid_w = [8, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6]
    tip_w = [6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 1, 0, 0]
    emit('sprite', 'dripfang_base.png', dripfang_piece('dripfang_base', base_w, [(0.3, 3, 16), (0.62, 0, 9)]))
    emit('sprite', 'dripfang_middle.png', dripfang_piece('dripfang_middle', mid_w, [(0.3, 0, 12), (0.62, 6, 16)]))
    emit('sprite', 'dripfang_tip.png', dripfang_piece('dripfang_tip', tip_w, [(0.3, 0, 7), (0.62, 0, 10)], drop=True))


# --------------------------------------------------------------------------
# 13 bloodroot vines
# --------------------------------------------------------------------------

ROOT_C = P('#2e0608', '#5a0f12', '#8a1a1a', '#b33a2e', '#d8624c')
# base x, width, phase, wobble amplitude, end row (for _end)
STRANDS = [(2, 2, 0.3, 0.7, 11), (7, 1, 2.0, 0.6, 6), (10, 2, 3.6, 0.7, 13), (14, 1, 5.0, 0.6, 8)]
KNOTS = [(0, 6), (2, 3), (2, 10)]
HAIRS = [(0, 12, -1), (2, 7, 1), (1, 2, 1)]


def strand_x(base, phase, amp, y):
    return base + int(round(amp * math.sin(2 * math.pi * y / 16 + phase)))


def gen_bloodroot():
    for end in (False, True):
        s = Spr()
        for si, (bx, w, ph, amp, e) in enumerate(STRANDS):
            stop = e if end else 16
            for y in range(stop):
                x = strand_x(bx, ph, amp, y)
                if w == 2:
                    gl = math.sin(2 * math.pi * y / 8 + si) > 0.55  # glossy stretch
                    first = gl and not (math.sin(2 * math.pi * (y - 1) / 8 + si) > 0.55)
                    s.px(x, y, ROOT_C[4] if first else ROOT_C[3] if gl else ROOT_C[2])
                    s.px(x + 1, y, ROOT_C[1])
                else:
                    s.px(x, y, ROOT_C[2] if y % 5 else ROOT_C[3])
            for (ks, ky) in KNOTS:
                if ks == si and ky < stop - 1:
                    x = strand_x(bx, ph, amp, ky)
                    s.px(x - 1, ky, ROOT_C[2])
                    s.px(x + w, ky, ROOT_C[1])
                    s.px(x, ky, ROOT_C[3])
            for (hs, hy, side) in HAIRS:
                if hs == si and hy < stop - 2:
                    x = strand_x(bx, ph, amp, hy)
                    ox = x - 1 if side < 0 else x + w
                    s.px(ox, hy, ROOT_C[1])
                    s.px(ox + side, hy + 1, ROOT_C[1])
            if end:
                x = strand_x(bx, ph, amp, stop)
                if w == 2:
                    s.art(['.hm.', 'hmmd', 'mmdd', '.dd.', '..m.'],
                          {'h': '#d8624c', 'm': '#8a1a1a', 'd': '#5a0f12'}, ox=x - 1, oy=stop)
                else:
                    s.art(['hm', 'md', '.d'], {'h': '#b33a2e', 'm': '#8a1a1a', 'd': '#5a0f12'}, ox=x, oy=stop)
        emit('sprite', 'bloodroot_vines_end.png' if end else 'bloodroot_vines.png', s.rgba())


# --------------------------------------------------------------------------
# 14 hanging tissue
# --------------------------------------------------------------------------

TISSUE = P('#3a0c10', '#4a1014', '#7a2228', '#a33e3a', '#c4625a', '#dc8274')
FLAPS = [(1, 4, 0.5), (6, 5, 2.4), (12, 3, 4.2)]


def gen_hanging_tissue():
    for end in (False, True):
        r = R('hanging_tissue_end' if end else 'hanging_tissue')
        s = Spr()
        ends = [12, 14, 9]
        for fi, (x0, w0, ph) in enumerate(FLAPS):
            fib = R('tissue_fibre%d' % fi).integers(1, w0, size=2)
            stop = ends[fi] if end else 16
            jag = r.integers(-2, 2, size=8)
            for y in range(N):
                left = x0 + int(round(0.7 * math.sin(2 * math.pi * y / 16 + ph)))
                w = w0 + int(round(0.7 * math.sin(2 * math.pi * y / 16 + ph * 1.7)))
                for i in range(w):
                    x = left + i
                    yend = stop + (int(jag[i % 8]) if end else 0)
                    if y >= yend:
                        continue
                    if i == 0:
                        c = TISSUE[4]
                    elif i == w - 1:
                        c = TISSUE[1]
                    elif i == 1:
                        c = TISSUE[4] if w > 3 else TISSUE[3]
                    else:
                        c = TISSUE[3] if i < w - 2 else TISSUE[2]
                    if i in fib and 0 < i < w - 1 and (y + i) % 3 != 0:
                        c = TISSUE[2]  # fibres
                    if end and y == yend - 1:
                        c = TISSUE[1] if i % 2 else TISSUE[0]  # raw torn edge
                    s.px(x, y, c)
                    if end and y == yend - 1 and r.random() < 0.3:
                        s.px(x, y + 1, TISSUE[2])
                        if r.random() < 0.5:
                            s.px(x, y + 2, TISSUE[1])
            # glossy wet highlights
            for y in range(1, stop - 2, 5):
                left = x0 + int(round(0.7 * math.sin(2 * math.pi * y / 16 + ph)))
                if s.m[y, left + 1]:
                    s.px(left + 1, y, TISSUE[5])
        # a small hole in the widest flap
        if s.m[5, 8]:
            s.clear(8, 5)
            s.px(8, 6, TISSUE[1])
        emit('sprite', 'hanging_tissue_end.png' if end else 'hanging_tissue.png', s.rgba())


# --------------------------------------------------------------------------
# 15 crimson thorns
# --------------------------------------------------------------------------

THORN = P('#3a080c', '#5a0c12', '#8c1a1e', '#d23a32', '#ff6a50', '#ffb090')


def gen_crimson_thorns():
    s = Spr()
    # (base left x, base right x, apex x, apex y): drawn back to front
    shards = [(4.6, 11.4, 8.4, 2.0), (0.6, 6.4, 1.4, 6.4), (9.4, 15.2, 14.0, 4.4),
              (-0.8, 3.2, 0.3, 10.4), (12.6, 16.8, 15.4, 9.6), (6.0, 10.2, 5.8, 9.4)]
    for (bl, br, ax, ay) in shards:
        by = 16.0

        def tri(xs, ys, bl=bl, br=br, ax=ax, ay=ay):
            t = np.clip((by - ys) / (by - ay), 0, 1)
            lx = bl + (ax - bl) * t
            rx = br + (ax - br) * t
            return (ys >= ay) & (xs >= lx) & (xs <= rx)

        m = ss_mask(tri) > 0.45
        bm = (bl + br) / 2
        for y in range(N):
            for x in range(N):
                if not m[y, x]:
                    continue
                t = np.clip((by - (y + 0.5)) / (by - ay), 0, 1)
                spine = bm + (ax - bm) * t
                rel = x + 0.5 - spine
                right_edge = (x + 1 >= N) or not m[y, x + 1]
                left_edge = (x == 0) or not m[y, x - 1]
                width = int(m[y].sum())
                if width == 1:
                    col = THORN[4] if t > 0.45 else THORN[3]
                elif width == 2:
                    col = THORN[2] if right_edge else (THORN[4] if t > 0.45 else THORN[3])
                elif right_edge and rel > -0.2:
                    col = THORN[1]
                elif rel > 0.5:
                    col = THORN[2]
                elif rel > -0.6:
                    col = THORN[4] if t > 0.3 else THORN[3]
                else:
                    col = THORN[2] if left_edge and t < 0.4 else THORN[3]
                s.px(x, y, col)
        tipy = int(math.ceil(ay))
        for x in range(N):
            if m[tipy, x]:
                s.px(x, tipy, THORN[5])
                break
    emit('sprite', 'crimson_thorns.png', s.rgba())


# --------------------------------------------------------------------------
# 16 glowspore cluster
# --------------------------------------------------------------------------

GLOW_LEG = {'H': '#ffe0b0', 'A': '#ffb070', 'B': '#ff8a5a', 'C': '#e0603c', 'D': '#a83e28',
            's': '#cdbfa8', 't': '#a8987e', 'u': '#e8dccb'}


def gen_glowspore():
    s = Spr()
    s.art([
        '................',
        '................',
        '................',
        '................',
        '.......AAAB.....',
        '......AHHAAB....',
        '.....AHAAAABB...',
        '.....BAAABBBC...',
        '......CDDDDC....',
        '.AAB....ut......',
        'AHAAB...ut......',
        'BAABC...ut..AAB.',
        '.CDC....ut.AHAB.',
        '..s.....ut.BABC.',
        '..s..AB.ut..DC..',
        '..t.HAAB.ut..s..',
    ], GLOW_LEG)
    s.art(['................'] * 15 + ['.....CDC.....t..'], GLOW_LEG)
    emit('sprite', 'glowspore_cluster.png', s.rgba())


# --------------------------------------------------------------------------
# 17 skull pile
# --------------------------------------------------------------------------

SK = {'W': '#e6dcc4', 'w': '#c8bb9c', 'o': '#8f8366', 'd': '#5e5444', 'k': '#1e1614',
      'K': '#3a302a', 'r': '#6a1a16', 'R': '#8e2a22'}


def gen_skull_pile():
    s = Spr()
    s.art([
        '................',
        '................',
        '................',
        '.....WWWWWWw....',
        '....WWWWWWWwo...',
        '....WWWWWWwwo...',
        '....WkkWWkkwo...',
        '....WkKWWkKoo...',
        '....wWWkkWwwo...',
        '.....wkwkwko....',
        '..Ww.wwwwwo..Ww.',
        '.WwwWdoooodWWwwo',
        'WWwwwwwwwwwwwwo.',
        'oo.ooooooRroo.Ww',
        '.WwWw.WWwrwWWwwo',
        'WwwwwowwwwwoowWw',
    ], SK)
    emit('sprite', 'skull_pile.png', s.rgba())


# --------------------------------------------------------------------------
# 18 dweller droppings (top-down tar splats)
# --------------------------------------------------------------------------

TAR = P('#120607', '#2a0a0c', '#4a1012', '#6a2020')


def gen_droppings():
    r = R('dweller_droppings')
    f = 0.62 * vnoise(r, 4) + 0.38 * vnoise(r, 8) + 0.1 * r.random((N, N))
    mask = f > np.quantile(f, 0.53)
    for _ in range(6):  # splatter specks
        x, y = (int(v) for v in r.integers(N, size=2))
        mask[y, x] = True
    up_empty = ~sh(mask, 1, 0)
    left_empty = ~sh(mask, 0, 1)
    edge = mask & (up_empty | left_empty | ~sh(mask, -1, 0) | ~sh(mask, 0, -1))
    lv = np.where(edge, 1, 0)
    lv[mask & (up_empty | left_empty)] = 2  # glossy rim catches light on the top-left
    core = mask & ~edge
    deep = core & sh(core, 1, 0) & sh(core, 0, 1) & sh(core, -1, 0) & sh(core, 0, -1)
    used = []
    for y, x in sorted(zip(*np.nonzero(deep)), key=lambda t: t[0] + t[1]):
        if all(abs(((y - uy + 8) % 16) - 8) + abs(((x - ux + 8) % 16) - 8) > 6 for uy, ux in used):
            lv[y, x] = 3
            lv[y, (x + 1) % N] = 2
            used.append((y, x))
    rgb = colorize(lv, TAR)
    a = np.where(mask, 255, 0).astype(np.uint8)
    emit('sprite', 'dweller_droppings.png', np.concatenate([rgb, a[..., None]], 2))


# --------------------------------------------------------------------------
# 19 sinew membrane
# --------------------------------------------------------------------------

SINEW = P('#3a0c10', '#6e1a1e', '#9c3430', '#c45a4c', '#dc7a68')


def gen_sinew():
    """Meaty cobweb: taut sinews anchored to the frame, ragged membrane sheets
    stretched between them, irregular holes."""
    r = R('sinew_membrane')
    thick = [((0, 3), (15, 6)), ((0, 11), (15, 9)), ((3, 0), (6, 15)), ((12, 0), (9, 15))]
    thin = [((0, 0), (15, 14)), ((15, 1), (1, 15)), ((7, 0), (15, 4)), ((0, 7), (5, 15))]
    light = np.zeros((N, N), bool)
    dark = np.zeros((N, N), bool)
    for (a, b) in thick:
        horiz = abs(b[0] - a[0]) > abs(b[1] - a[1])
        for x, y in line_pts(a[0], a[1], b[0], b[1]):
            light[y, x] = True
            ox, oy = (x, y + 1) if horiz else (x + 1, y)
            if 0 <= ox < N and 0 <= oy < N:
                dark[oy, ox] = True
    thin_m = np.zeros((N, N), bool)
    for (a, b) in thin:
        for x, y in line_pts(a[0], a[1], b[0], b[1]):
            thin_m[y, x] = True
    strands = light | dark | thin_m
    f = 0.55 * vnoise(r, 4) + 0.3 * vnoise(r, 8) + 0.3 * r.random((N, N))
    near = nb_any(strands) | strands
    near2 = nb_any(near) | near
    best = None
    for q in np.linspace(0.1, 0.95, 60):
        mem = (f > np.quantile(f, q)) & near2
        cov = (mem | strands).mean()
        if best is None or abs(cov - 0.63) < abs(best[1] - 0.63):
            best = (mem, cov)
    mem = best[0] & ~strands
    mask = mem | strands
    lv = np.zeros((N, N), int)
    lv[mem] = 1
    hole_edge = mem & (~np.pad(mask, 1)[2:, 1:-1] | ~np.pad(mask, 1)[1:-1, 2:])
    lv[hole_edge] = 0
    lv[thin_m] = 2
    lv[dark] = 2
    lv[light] = 3
    lv[light & (r.random((N, N)) < 0.2)] = 4
    rgb = colorize(lv, SINEW)
    a = np.where(mask, 255, 0).astype(np.uint8)
    emit('sprite', 'sinew_membrane.png', np.concatenate([rgb, a[..., None]], 2))


# --------------------------------------------------------------------------
# 20-21 watcher pod
# --------------------------------------------------------------------------

POD = P('#22080a', '#3e1012', '#5e1a1a', '#7e2a24', '#9a3c30')
SEAM = P('#8a1410', '#d42a1e', '#ff5a3c')
POD_IN = P('#8c2a2a', '#b04a3e')  # inner (fleshy) side of a pod plate


def scale_owner(depth=6.0, curv=0.27, rows=2, cols=2):
    """Dragon-scale lattice: rows 8 px apart, U-shaped plates 8 px wide, odd
    rows offset by 4. Upper plates overlap lower ones. Returns owner id, local
    dx, dy (tileable)."""
    sy = N / rows
    sx = N / cols
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    owner = np.full((N, N), -1)
    ldx = np.zeros((N, N))
    ldy = np.zeros((N, N))
    for row in range(-2, rows + 2):
        cy = row * sy
        best = np.full((N, N), 1e9)
        rid = np.full((N, N), -1)
        rdx = np.zeros((N, N))
        rdy = np.zeros((N, N))
        for col in range(-1, cols + 1):
            cx = col * sx + (sx / 2 if row % 2 else 0.0)
            dx = (xs - cx + N / 2) % N - N / 2
            dy = ys - cy
            d = np.abs(dx)
            inside = (dy <= depth - curv * dx * dx) & (dy >= -sy) & (np.abs(dx) <= sx / 2 + 0.01)
            upd = inside & (d < best)
            best[upd] = d[upd]
            rid[upd] = (row % rows) * cols + (col % cols)
            rdx[upd] = dx[upd]
            rdy[upd] = dy[upd]
        take = (rid >= 0) & (owner < 0)
        owner[take] = rid[take]
        ldx[take] = rdx[take]
        ldy[take] = rdy[take]
    return owner, ldx, ldy


def seam_col(v, hot=1.0):
    if v > 1 - 0.06 * hot:
        return SEAM[2]
    if v > 1 - 0.3 * hot:
        return SEAM[1]
    return SEAM[0]


def petals(cx, cy, k, twist=0.0, offset=0.0):
    """Per-pixel petal coordinate: (radius, fraction across petal 0..1)."""
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    dx, dy = xs - cx, ys - cy
    rad = np.sqrt(dx * dx + dy * dy)
    ang = np.arctan2(dy, dx) + twist * rad + offset
    sec = ang / (2 * math.pi / k)
    return rad, sec - np.floor(sec), dx, dy


def gen_watcher_pod():
    r = R('watcher_pod')
    owner, ldx, ldy = scale_owner()
    noise = r.random((N, N))
    seam = owner != sh(owner, 1, 0)              # top edge of each visible plate
    side = (owner != sh(owner, 0, 1)) & ~seam    # vertical joins inside a row
    rim = sh(seam, -1, 0) & ~seam                # overhanging lower lip of a plate
    lvf = 1.0 + 0.3 * (ldy + 1.5) - 0.12 * ldx + 0.55 * (noise - 0.5)
    lv = np.clip(np.round(lvf), 1, 3).astype(int)
    under = sh(seam, 1, 0) & ~seam               # just below a seam: in shadow
    lv[under] = 1
    lv[rim] = np.where(ldx[rim] < 1.0, 4, 3)
    lv[side] = 0
    rgb = colorize(lv, POD)
    for y, x in zip(*np.nonzero(seam)):
        rgb[y, x] = seam_col(noise[y, x])
    for y, x in zip(*np.nonzero(side)):
        if noise[y, x] > 0.75:
            rgb[y, x] = SEAM[0]
    emit('block', 'watcher_pod.png', opaque(rgb))

    # top: spiral petals converging on a closed centre
    rad, frac, dx, dy = petals(8.0, 8.0, 5, twist=0.22, offset=0.5)
    body = 0.9 + 2.6 * (1 - frac) - 0.05 * (dx + dy) + 0.35 * (noise - 0.5)
    lv = np.clip(np.round(body), 1, 3).astype(int)
    lv[(frac > 0.07) & (frac < 0.2)] = 4         # lifted lip of the overlapping petal
    lv[frac > 0.84] = 1                          # tucked under the next petal
    lv[(frac > 0.93)] = 0
    seamm = (frac <= 0.07) & (rad > 1.6)
    rgb = colorize(lv, POD)
    for y, x in zip(*np.nonzero(seamm)):
        rgb[y, x] = seam_col(noise[(y + 3) % N, (x + 5) % N])
    for (x, y, c) in [(7, 7, POD[0]), (8, 7, POD[0]), (7, 8, POD[0]), (8, 8, POD[0]), (7, 7, SEAM[1])]:
        rgb[y, x] = c
    emit('block', 'watcher_pod_top.png', opaque(rgb))


EYE = {'S': '#e8d8c8', 's': '#c8b0a0', 'z': '#9c8478', 'v': '#b0302a', 'I': '#ff7a3a',
       'i': '#c44a1e', 'J': '#ffb060', 'p': '#0e0404', 'g': '#fff4e8', 'k': '#1a0406',
       'l': '#3a0a0c'}


def gen_watcher_pod_open():
    r = R('watcher_pod_open')
    noise = r.random((N, N))
    # peeled-back plates radiating from the opening
    rad, frac, dx, dy = petals(7.5, 8.0, 7, twist=-0.05, offset=0.2)
    ell = np.sqrt((dx / 6.6) ** 2 + (dy / 5.3) ** 2)
    lv = np.clip(np.round(3.3 - 2.2 * frac + 0.6 * (noise - 0.5)), 1, 4).astype(int)
    rgb = colorize(lv, POD)
    for y, x in zip(*np.nonzero(frac > 0.88)):
        rgb[y, x] = seam_col(noise[(y + 2) % N, (x + 7) % N], hot=0.4)
    lipm = (ell < 1.22) & (ell >= 1.0)
    rgb[lipm] = np.where((dx + dy < 0)[..., None], np.array(POD_IN[1], np.uint8), np.array(POD_IN[0], np.uint8))[lipm]
    s = from_rgba(opaque(rgb))
    # the eye, hand placed (rows 3..12)
    s.art([
        '................',
        '................',
        '................',
        '....llllllll....',
        '...lkzssssszkl..',
        '..lkzsSSSSSsskl.',
        '..lssSSvIIISsskl',
        '.lksSSviJpJiSsvl',
        '.lksSSSiJpJiSvsl',
        '..lsSSSiIpIissl.',
        '..lkzsSSiIisszl.',
        '...lkzssssszkl..',
        '....lllkkklll...',
        '................',
        '................',
        '................',
    ], EYE)
    s.px(6, 6, EYE['g'])  # wet glint on the iris
    emit('block', 'watcher_pod_open.png', opaque(s.rgba()[..., :3]))

    # open top: peeled plates around a glowing wet interior
    r = R('watcher_pod_open_top')
    noise = r.random((N, N))
    rad, frac, dx, dy = petals(8.0, 8.0, 8, twist=0.0, offset=0.4)
    rgb = np.zeros((N, N, 3), np.uint8)
    inner = P('#ffb48a', '#ff5a3c', '#d42a1e', '#8a1410', '#4a0c0e')
    for y in range(N):
        for x in range(N):
            rr = rad[y, x] + 0.5 * (noise[y, x] - 0.5)
            if rr < 1.5:
                c = inner[0]
            elif rr < 2.7:
                c = inner[1]
            elif rr < 3.7:
                c = inner[2]
            elif rr < 4.5:
                c = inner[3]
            elif rr < 5.1:
                c = inner[4]
            elif rr < 6.3:
                c = POD_IN[1] if (dx[y, x] + dy[y, x]) < 0 else POD_IN[0]
            else:
                f = frac[y, x]
                c = POD[int(np.clip(round(3.3 - 2.2 * f + 0.6 * (noise[y, x] - 0.5)), 1, 4))]
                if f > 0.9:
                    c = seam_col(noise[(y + 4) % N, x], hot=0.4)
            rgb[y, x] = c
    for (x, y) in [(5, 9), (6, 10), (10, 5), (10, 6)]:  # membrane strands across the cavity
        rgb[y, x] = hx('#5a1416')
    for (x, y) in [(6, 6), (9, 9)]:
        rgb[y, x] = hx('#ffe0c0')
    emit('block', 'watcher_pod_open_top.png', opaque(rgb))


# --------------------------------------------------------------------------
# 22-23 scored stone / deepslate
# --------------------------------------------------------------------------


def claw_sets():
    """Claw-mark sets: (intro level, list of lines). Shared by stone and
    deepslate. Steep (2:1) slashes, fingers ~4 px apart."""
    def slash(x0, y0, L, dx=1):
        return ((x0, y0), (x0 + dx * (L // 2), y0 + L))
    return [
        (0, [slash(3, 2, 6), slash(11, 8, 5), slash(13, 1, 4, -1)]),                 # faint scratches
        (1, [slash(4, 2, 11), slash(8, 1, 12), slash(12, 3, 10)]),                    # one clear set of 3
        (2, [slash(9, 8, 8, -1), slash(13, 7, 8, -1), slash(17, 8, 7, -1)]),          # second set, crossing
        (2, [slash(0, 9, 6), slash(-4, 10, 5)]),
        (3, [slash(5, -3, 7, -1), slash(1, -2, 6, -1)]),                              # frantic extra gouges
        (3, [slash(6, 10, 5), slash(2, 11, 4), slash(15, 0, 5)]),
    ]


def gen_scored(kind):
    if kind == 'stone':
        base = stone_idx()
        pal = STONE
        groove = P('#241e1e', '#3a3434', '#4a4546', '#59555a')
        light = P('#9c9899', '#a8a8a8')
        smear = P('#5e3a3a', '#4e2626')
    else:
        base = deep_idx()
        pal = DEEP
        groove = P('#111114', '#18181c', '#222227', '#2a2a2f')
        light = P('#686870', '#7a7a80')
        smear = P('#3e2226', '#381418')
    sets = claw_sets()
    for level in range(4):
        rgb = colorize(base, pal)
        if level == 3:  # faint dried smear first, under the gouges
            r = R('smear_' + kind)
            for (x, y) in line_pts(2, 12, 11, 7) + line_pts(3, 13, 12, 8) + line_pts(4, 13, 9, 11) + line_pts(3, 11, 7, 9):
                if r.random() < 0.75:
                    rgb[y % N, x % N] = smear[0] if r.random() < 0.6 else smear[1]
        for intro, lines in sets:
            if intro > level:
                continue
            depth = level - intro
            for (x0, y0), (x1, y1) in lines:
                pts = line_pts(x0, y0, x1, y1)
                own = set((p[0] % N, p[1] % N) for p in pts)
                L = len(pts)
                for i, (x, y) in enumerate(pts):
                    xx, yy = x % N, y % N
                    taper = min(i, L - 1 - i)
                    if intro == 0 and depth == 0:  # faint scratch
                        rgb[yy, xx] = groove[3] if taper >= 1 else pal[max(base[yy, xx] - 2, 0)]
                        continue
                    if intro == 0:  # old faint scratches only darken a little
                        g = groove[3] if taper < 2 else groove[2]
                    elif taper == 0:
                        g = groove[3]
                    elif taper == 1:
                        g = groove[2]
                    else:
                        g = groove[[2, 1, 0, 0][min(depth, 3)]]
                    rgb[yy, xx] = g
                    # lit lip on the right-hand wall of the groove
                    lx = (xx + 1) % N
                    if taper >= 1 and intro > 0 and (lx, yy) not in own:
                        if depth >= 1 or i % 2 == 0:
                            rgb[yy, lx] = light[1] if depth >= 1 else light[0]
                    if depth >= 2 and taper >= 2 and intro > 0:  # deepest gouges are 2 px wide
                        rx = (xx - 1) % N
                        if (rx, yy) not in own:
                            rgb[yy, rx] = groove[2]
        emit('block', 'scored_%s_%d.png' % (kind, level), opaque(rgb))


# --------------------------------------------------------------------------
# 24 bone chime (block sprite)
# --------------------------------------------------------------------------

CH = {'k': '#3e2c20', 'K': '#5e4630', 'W': '#e6dcc4', 'w': '#c8bb9c', 'o': '#8f8366', 'r': '#6a1a16',
      'd': '#5e5444'}


def gen_bone_chime():
    s = Spr()
    s.art([
        '..k....k....k..k',
        '..k....k....K..k',
        '..K...wWo...k..K',
        '..k....k....k..k',
        '..k...WWw..WWw.k',
        '..k...Wwo...wo.k',
        '..o....wo...o..K',
        '.WWw...o....k.Wo',
        '.WWo........k.wo',
        '..wo.......wWo.o',
        '..wo.......WWw..',
        '..wo.......Wwo..',
        '..wo........wo..',
        '.WWwo.......wo..',
        '.ww.o......Wwwo.',
        '...........ww.o.',
    ], CH)
    emit('sprite', 'bone_chime.png', s.rgba())


# --------------------------------------------------------------------------
# ITEMS
# --------------------------------------------------------------------------


def ss_mask(fn, ss=8):
    """Coverage of a shape defined at sub-pixel precision -> crisp mask."""
    acc = np.zeros((N, N))
    for sy in range(ss):
        for sx in range(ss):
            ys, xs = np.mgrid[0:N, 0:N].astype(float)
            acc += fn(xs + (sx + 0.5) / ss, ys + (sy + 0.5) / ss)
    return acc / (ss * ss)


COG = [
    '......oooo......',
    '......oMMo......',
    '..ooo.oMMo.ooo..',
    '..oMMooMMooMMo..',
    '..oMMMMMMMMMMo..',
    '...oMMddddMMo...',
    'oooMMdGGGGdMMooo',
    'oMMMMdGHEGdMMMMo',
    'oMMMMdGEGgdMMMMo',
    'oooMMdGGggdMMooo',
    '...oMMddddMMo...',
    '..oMMMMMMMMMMo..',
    '..oMMooMMooMMo..',
    '..ooo.oMMo.ooo..',
    '......oMMo......',
    '......oooo......',
]


def item_config_wheel():
    """Hand-drawn cog silhouette; metal shading and rust are procedural."""
    r = R('config_wheel')
    s = Spr()
    iron = P('#3e3634', '#5a504c', '#7a6e68', '#9a8e86', '#bcb0a6')
    rust = P('#4a2414', '#6e3618', '#9a4e24', '#c06a34', '#d88a4a')
    gemc = {'G': '#d42a1e', 'E': '#ff6a4a', 'H': '#ffc8a8', 'g': '#8a0e0e'}
    metal = np.array([[ch == 'M' for ch in row] for row in COG])
    rn = vnoise(r, 8) + 0.5 * r.random((N, N))
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    rn += 0.05 * ((xs - 8) + (ys - 8))  # rust gathers on the lower right
    rust_m = rn > np.quantile(rn[metal], 0.78)
    for y, row in enumerate(COG):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            if ch == 'o':
                s.px(x, y, '#24181a', 1)
            elif ch == 'd':
                s.px(x, y, '#3e3634', 1)
            elif ch in gemc:
                s.px(x, y, gemc[ch], 2)
            else:
                dx, dy = xs[y, x] - 8.0, ys[y, x] - 8.0
                rr = math.hypot(dx, dy)
                facing = -(dx + dy) / (rr * 1.414 + 1e-6)
                lit_edge = COG[y - 1][x] == 'o' or COG[y][x - 1] == 'o'
                dark_edge = COG[y + 1][x] == 'o' or COG[y][x + 1] == 'o'
                lv = 3 if facing > 0.4 else 2 if facing > -0.4 else 1
                if lit_edge and facing > -0.2:
                    lv = 4 if facing > 0.5 else 3
                if dark_edge and facing < 0.2:
                    lv = 1
                if COG[y + 1][x] == 'd' or COG[y][x + 1] == 'd':
                    lv = min(lv + 1, 4)   # inner rim around the setting
                ramp = rust if rust_m[y, x] else iron
                s.px(x, y, ramp[lv], 1)
    return s.rgba()


def item_field_journal():
    s = Spr()
    s.art([
        '................',
        '...oooooooooo...',
        '..oSHLLLLLLLMo..',
        '..oSLMMMMMMMDpo.',
        '..oSLMRMRMRMDpo.',
        '..oSLMRMRMRrDpo.',
        '..oSLrRRRRRMDbbo',
        '..oSLMrRRRrMbBBco',
        '..oSLMMRRrMMDbco',
        '..oSLMMMMMMMDpo.',
        '..oSLMMMMMHMDpo.',
        '..oSLMMMMMMMDpo.',
        '..oSDDDDDDDDDpo.',
        '..ooqqqqqqqqqqo.',
        '...ooooooooooo..',
        '................',
    ], {'o': '#24140c', 'S': '#3a2014', 'D': '#4a2a1a', 'M': '#6a3e24', 'L': '#8a5632',
        'H': '#a46c40', 'p': '#e0d4b4', 'q': '#b8a888', 'r': '#7a1010', 'R': '#a01c18',
        'b': '#e6dcc4', 'B': '#f2ead8', 'c': '#a89a7c'})
    for (x, y) in [(6, 3), (8, 3), (10, 4)]:  # fingertips smear
        s.px(x, y, '#7a1010')
    # worn scuffs and stitching on the spine
    for (x, y) in [(3, 4), (3, 7), (3, 10)]:
        s.px(x, y, '#6a4a2a')
    for (x, y) in [(10, 3), (6, 11), (9, 9)]:
        s.px(x, y, '#5a3420')
    return s.rgba()


def bone_diag(s, x0, y0, L, light='#e6dcc4', mid='#c8bb9c', dark='#9a8e72', mat=1):
    """Small diagonal ('/') bone: 2 px shaft from bottom-left (x0,y0), length L,
    two-lobed knobs at both ends (vanilla bone style)."""
    for i in range(L + 1):
        s.px(x0 + i, y0 - i, light, mat)
        s.px(x0 + i + 1, y0 - i, mid, mat)
    xe, ye = x0 + L, y0 - L
    for (dx, dy, c) in [(0, -2, light), (1, -2, light), (0, -1, light), (1, -1, light), (2, -1, mid), (2, 0, dark)]:
        s.px(xe + dx, ye + dy, c, mat)
    s.clear(xe + 2, ye - 2)
    s.px(xe + 1, ye - 1, mid, mat)
    for (dx, dy, c) in [(-1, 0, light), (-1, 1, light), (0, 1, mid), (0, 2, dark), (1, 2, dark), (1, 1, dark)]:
        s.px(x0 + dx, y0 + dy, c, mat)
    s.clear(x0 - 1, y0 + 2)
    s.px(x0, y0 + 1, mid, mat)


def item_rattlebone():
    s = Spr()
    bone_diag(s, 2, 9, 6, light='#d8cdb2', mid='#b8ab8c', dark='#8a7e64', mat=1)
    bone_diag(s, 6, 13, 6, light='#d8cdb2', mid='#b8ab8c', dark='#8a7e64', mat=1)
    bone_diag(s, 3, 12, 8, mat=2)
    # string wrapped around the middle, with a dangling end
    for i, (x, y) in enumerate([(4, 6), (5, 7), (6, 8), (7, 9), (8, 10), (9, 11)]):
        s.px(x, y, '#b08048', 3)
        s.px(x + 1, y, '#6a4626', 3)
    for (x, y, c) in [(11, 12, '#6a4626'), (11, 13, '#b08048'), (12, 14, '#6a4626')]:
        s.px(x, y, c, 3)
    s.outline({1: '#4a4234', 2: '#4a4234', 3: '#2e2016'})
    return s.rgba()


def item_organ_muffler():
    r = R('organ_muffler')
    s = Spr()
    wool = P('#5e5e62', '#7e7e82', '#98989c', '#b2b2b6', '#cbcbcf')
    mask = np.zeros((N, N), bool)
    mask[3:13, 2:14] = True
    for (x, y) in [(2, 3), (13, 3), (2, 12), (13, 12)]:
        mask[y, x] = False
    n = vnoise(r, 8) + 0.6 * r.random((N, N))
    lv = quant(n, [0, 20, 60, 20], mask=mask) + 1
    yy, xx = np.mgrid[0:N, 0:N]
    knit = (xx + 2 * (yy % 2)) % 4
    lv = np.where(knit == 0, np.minimum(lv + 1, 4), np.where(knit == 2, np.maximum(lv - 1, 1), lv))
    e = edge4(mask)
    for y in range(N):
        for x in range(N):
            if not mask[y, x]:
                continue
            l = lv[y, x]
            if e[y, x]:
                l = 2 if (y == 3 or x == 2) else 0
            elif (y == 4 or x == 3):
                l = min(l + 1, 4)
            elif (y == 11 or x == 12):
                l = max(l - 1, 1)
            s.px(x, y, wool[l], 1)
    for y in range(3, 13):  # string
        s.px(5, y, '#8a6a42' if y % 2 else '#6a4e30', 2)
        s.px(10, y, '#8a6a42' if y % 2 == 0 else '#6a4e30', 2)
    for x in range(2, 14):  # tissue strip
        s.px(x, 7, '#c4625a' if x % 3 else '#dc8274', 3)
        s.px(x, 8, '#a33e3a', 3)
        s.px(x, 9, '#6e1a1e', 3)
    s.px(14, 8, '#a33e3a', 3)
    s.px(14, 9, '#6e1a1e', 3)
    s.px(14, 10, '#6e1a1e', 3)
    s.outline({1: '#2e2e32', 2: '#2e2016', 3: '#3a0a0e'})
    return s.rgba()


def item_glowspore_flare():
    s = Spr()
    stick = [(2, 14), (3, 13), (4, 12), (5, 11), (6, 10), (7, 9), (8, 8)]
    for (x, y) in stick:
        s.px(x, y, '#896727', 1)
        s.px(x + 1, y, '#684e1e', 1)
        s.px(x, y + 1, '#4a3416', 1) if not s.m[y + 1, x] else None
    s.art([
        '................',
        '..........AAB...',
        '.........AHHAB..',
        '........AHAAABC.',
        '........AAAABBC.',
        '........BAABBCD.',
        '.........CBCCD..',
        '..........DD....',
    ], {'H': '#fff0c8', 'A': '#ffb070', 'B': '#ff8a5a', 'C': '#e0603c', 'D': '#a83e28'},
        mats={k: 2 for k in 'HABCD'})
    s.px(12, 3, '#ffe0b0', 2)
    s.outline({1: '#28190a', 2: '#6a2410'})
    return s.rgba()


def item_bone_chime():
    s = Spr()
    s.art([
        '................',
        '..W.........W...',
        '.WWWWWWWWWWWWWw.',
        '..wwwooooooowo..',
        '...k....k...k...',
        '...k....k...k...',
        '...K....K...K...',
        '..WWw...k..WWw..',
        '..Wwo..WWw..wo..',
        '...wo..Wwo..wo..',
        '...wo...wo..o...',
        '...wo...o.......',
        '..Wwwo..........',
        '..ww.o..........',
        '................',
        '................',
    ], CH, mats={'k': 2, 'K': 2})
    s.outline({1: '#3a3226'}, default=None)
    return s.rgba()


def item_organ_tissue():
    r = R('organ_tissue')
    s = Spr()
    ramp = P('#3a0a0e', '#5a1216', '#7e1e22', '#a03430', '#c45244')
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    m = np.zeros((N, N))
    for (cx, cy, rx, ry) in [(7.5, 8.5, 5.2, 4.2), (10.5, 6.0, 3.2, 3.0), (5.0, 10.5, 3.4, 2.8), (11.0, 10.5, 2.4, 2.2)]:
        m = np.maximum(m, 1 - ((xs - cx) / rx) ** 2 - ((ys - cy) / ry) ** 2)
    mask = m > 0
    h = m
    lit = h - np.roll(np.roll(h, 1, 0), 1, 1)
    f = 0.7 * h + 2.2 * lit + 0.25 * r.random((N, N))
    lv = quant(f, [14, 30, 32, 24], mask=mask)
    e = edge4(mask)
    for y in range(N):
        for x in range(N):
            if mask[y, x]:
                l = lv[y, x]
                if e[y, x]:
                    l = min(l, 1)
                s.px(x, y, ramp[l], 1)
    # a raised vein
    for i, (x, y) in enumerate([(3, 10), (4, 9), (5, 9), (6, 8), (7, 8), (8, 7), (9, 7), (10, 6), (11, 6)]):
        s.px(x, y, '#5a1430', 1)
        if s.m[y - 1, x]:
            s.px(x, y - 1, '#8a3a50', 1)
    for (x, y) in [(6, 5), (7, 5), (10, 4), (4, 8)]:
        s.px(x, y, '#e8907c', 1)
    s.outline({1: '#24060a'})
    return s.rgba()


def item_claw():
    s = Spr()
    claw = P('#3a3532', '#57504b', '#746c65', '#948a80', '#b8ada0')
    blood = P('#2a0e0c', '#44160f', '#5e2216', '#7a3020')
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    ctrl = [np.array(v) for v in [(4.0, 13.0), (2.5, 4.0), (10.0, 0.8), (14.2, 5.8)]]
    best = np.full((N, N), 9.0)
    tb = np.zeros((N, N))
    nxv = np.zeros((N, N))
    nyv = np.zeros((N, N))
    for t in np.linspace(0, 1, 240):
        p = ((1 - t) ** 3 * ctrl[0] + 3 * (1 - t) ** 2 * t * ctrl[1] + 3 * (1 - t) * t * t * ctrl[2]
             + t ** 3 * ctrl[3])
        w = 2.1 * (1 - t) ** 1.15 + 0.28
        d = np.sqrt((xs - p[0]) ** 2 + (ys - p[1]) ** 2)
        rel = d - w
        upd = rel < best
        best[upd] = rel[upd]
        tb[upd] = t
        nxv[upd] = ((xs - p[0]) / (d + 1e-6))[upd]
        nyv[upd] = ((ys - p[1]) / (d + 1e-6))[upd]
    mask = best <= 0
    for y in range(N):
        for x in range(N):
            if not mask[y, x]:
                continue
            facing = -(nxv[y, x] + nyv[y, x]) / 1.414
            if tb[y, x] < 0.07:
                l = 3 if facing > 0.4 else 2 if facing > -0.3 else 1
                s.px(x, y, blood[l], 2)
            else:
                l = 3 if facing > 0.35 else 2 if facing > -0.4 else 1
                if facing > 0.8 and 0.25 < tb[y, x] < 0.8:
                    l = 4
                s.px(x, y, claw[l], 1)
    # dried blood creeping up the claw in a ragged line
    for (x, y) in [(2, 10), (5, 11), (3, 9)]:
        if s.m[y, x]:
            s.px(x, y, blood[2], 2)
    s.outline({1: '#1e1a18', 2: '#1e0606'})
    return s.rgba()


def item_moth_dust():
    r = R('moth_dust')
    s = Spr()
    ramp = P('#3e342c', '#5a4e44', '#76695c', '#938676', '#b0a490')
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    mound = ((xs - 8) / 6.5) ** 2 + ((ys - 12.5) / 4.6) ** 2 < 1
    mound &= ys < 15.5
    n = r.random((N, N))
    mask = mound & ~((n > 0.85) & edge4(mound))
    for (x, y) in [(2, 8), (13, 7), (4, 5), (11, 4), (14, 11), (1, 12), (8, 6)]:
        mask[y, x] = True
    h = np.clip(1 - ((xs - 8) / 6.5) ** 2 - ((ys - 12.5) / 4.6) ** 2, 0, 1)
    f = 0.9 * h - 0.15 * (xs - 8) / 6 + 0.6 * n
    lv = quant(f, [12, 26, 32, 22, 8], mask=mask)
    e = edge4(mask)
    for y in range(N):
        for x in range(N):
            if mask[y, x]:
                l = lv[y, x]
                if e[y, x] and y > 10:
                    l = min(l, 1)
                s.px(x, y, ramp[l], 1)
    for (x, y, c) in [(6, 10, '#ff9a40'), (10, 12, '#d4702a'), (8, 13, '#ff9a40'), (4, 13, '#d4702a'),
                      (11, 10, '#ffb860'), (13, 7, '#d4702a')]:
        s.px(x, y, c, 1)
    return s.rgba()


def item_veinstone_shard():
    r = R('veinstone_shard')
    s = Spr()
    poly = [(2.5, 14.5), (4.0, 8.5), (8.5, 3.0), (13.8, 1.2), (12.5, 6.5), (7.5, 12.0), (4.5, 15.2)]
    img = Image.new('L', (N, N), 0)
    ImageDraw.Draw(img).polygon(poly, fill=255)
    mask = np.array(img) > 0
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    # ridge from base to tip splits a lit facet (top-left) from a shadow facet
    ridge = (xs - 3.5) * (1.2 - 14.8) - (ys - 14.8) * (13.8 - 3.5)
    n = r.random((N, N))
    e = edge4(mask)
    for y in range(N):
        for x in range(N):
            if not mask[y, x]:
                continue
            if ridge[y, x] > 0:
                l = 4 if n[y, x] > 0.75 else 3
            else:
                l = 2 if n[y, x] > 0.3 else 1
            if e[y, x]:
                l = 2 if ridge[y, x] > 0 else 0
            s.px(x, y, STONE[l] if l > 0 else hx('#4e4a4c'), 1)
    for (x, y) in [(5, 12), (6, 11), (6, 10), (7, 9), (8, 9), (9, 8), (10, 7), (10, 6), (11, 5)]:
        if s.m[y, x]:
            s.px(x, y, '#7a1a1d' if (x + y) % 3 else '#a8302a', 1)
    s.px(12, 2, '#c4c0c0', 1)
    s.px(9, 4, '#a8a4a6', 1)
    s.outline({1: '#2e2a2c'})
    return s.rgba()


# --------------------------------------------------------------------------
# previews
# --------------------------------------------------------------------------

BG = (0x14, 0x10, 0x12)


def font(sz=12):
    try:
        return ImageFont.load_default(size=sz)
    except Exception:  # very old Pillow
        return ImageFont.load_default()


def up(arr, k):
    return Image.fromarray(arr, 'RGBA').resize((arr.shape[1] * k, arr.shape[0] * k), Image.NEAREST)


def checker(w, h, cell=8):
    c = Image.new('RGBA', (w, h), BG + (255,))
    d = ImageDraw.Draw(c)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(0x1e, 0x19, 0x1c, 255))
    return c


def make_sheet():
    f = font(12)
    ft = font(16)
    sections = [
        ('Blocks', [e for e in REG if e['kind'] == 'block' and e['frames'] == 1]),
        ('Animated blocks (frame 0 + all frames)', [e for e in REG if e['frames'] > 1]),
        ('Block sprites (alpha-tested)', [e for e in REG if e['kind'] == 'sprite']),
        ('Items', [e for e in REG if e['kind'] == 'item']),
    ]
    W = 1480
    pad = 14
    cellw, cellh = 168, 128 + 22
    animw = 128 + 8 + 256 + 24
    # layout pass
    placements = []
    y = pad
    for title, items in sections:
        placements.append(('title', title, pad, y))
        y += 26
        x = pad
        for e in items:
            w = animw if e['frames'] > 1 else cellw
            if x + w > W - pad:
                x = pad
                y += cellh + pad
            placements.append(('tex', e, x, y))
            x += w
        y += cellh + pad + 10
    H = y
    sheet = Image.new('RGBA', (W, H), BG + (255,))
    d = ImageDraw.Draw(sheet)
    for kind, obj, x, y in placements:
        if kind == 'title':
            d.text((x, y), obj, fill=(0xd8, 0x9a, 0x8a, 255), font=ft)
            continue
        e = obj
        arr = e['arr']
        transparent = e['kind'] != 'block'
        if e['frames'] > 1:
            f0 = arr[:N]
            sheet.paste(up(f0, 8), (x, y))
            for i in range(e['frames']):
                fr = arr[i * N:(i + 1) * N]
                sheet.paste(up(fr, 4), (x + 136 + (i % 4) * 64, y + (i // 4) * 64))
                d.text((x + 136 + (i % 4) * 64 + 2, y + (i // 4) * 64 + 1), str(i), fill=(255, 255, 255, 160), font=font(10))
        else:
            if transparent:
                bgc = checker(128, 128)
                bgc.alpha_composite(up(arr, 8))
                sheet.paste(bgc, (x, y))
            else:
                sheet.paste(up(arr, 8), (x, y))
        d.text((x, y + 131), e['name'], fill=(0xe0, 0xd6, 0xd0, 255), font=f)
    sheet.convert('RGB').save(os.path.join(PREVIEW_DIR, 'textures_sheet.png'))


def iso_block(top, left, right, W=96):
    Hs = int(round(W * 0.58))
    H = W // 2 + Hs
    out = np.zeros((H + 1, W, 4), np.uint8)
    ys, xs = np.mgrid[0:H + 1, 0:W] + 0.5
    faces = [
        (top, (W / 2, 0), (W / 2, W / 4), (-W / 2, W / 4), 1.0),
        (left, (0, W / 4), (W / 2, W / 4), (0, Hs), 0.8),
        (right, (W / 2, W / 2), (W / 2, -W / 4), (0, Hs), 0.6),
    ]
    for tex, O, A, B, shade in faces:
        M = np.array([[A[0], B[0]], [A[1], B[1]]], float)
        Mi = np.linalg.inv(M)
        px = xs - O[0]
        py = ys - O[1]
        a = Mi[0, 0] * px + Mi[0, 1] * py
        b = Mi[1, 0] * px + Mi[1, 1] * py
        inside = (a >= 0) & (a < 1) & (b >= 0) & (b < 1) & (out[..., 3] == 0)
        u = np.clip((a * N).astype(int), 0, N - 1)
        v = np.clip((b * N).astype(int), 0, N - 1)
        col = tex[v, u, :3].astype(float) * shade
        out[inside, :3] = np.clip(col[inside], 0, 255).astype(np.uint8)
        out[inside, 3] = 255
    return Image.fromarray(out, 'RGBA')


def make_iso():
    f = font(12)
    blocks = [
        ('veinstone', 'veinstone.png', 'veinstone.png'),
        ('deep_veinstone', 'deep_veinstone_top.png', 'deep_veinstone.png'),
        ('cracked_veinstone', 'cracked_veinstone.png', 'cracked_veinstone.png'),
        ('fleshstone', 'fleshstone.png', 'fleshstone.png'),
        ('pulsing_flesh', 'pulsing_flesh.png', 'pulsing_flesh.png'),
        ('organ_core', 'organ_core.png', 'organ_core.png'),
        ('cracked_organ_core', 'cracked_organ_core.png', 'cracked_organ_core.png'),
        ('dwelling_heart', 'dwelling_heart.png', 'dwelling_heart.png'),
        ('bloodmoss', 'bloodmoss.png', 'bloodmoss_side.png'),
        ('ribstone', 'ribstone_top.png', 'ribstone_side.png'),
        ('watcher_pod', 'watcher_pod_top.png', 'watcher_pod.png'),
        ('watcher_pod_open', 'watcher_pod_open_top.png', 'watcher_pod_open.png'),
        ('scored_stone_3', 'scored_stone_3.png', 'scored_stone_3.png'),
    ]
    cols = 7
    cw, ch = 150, 96 // 2 + 56 + 34
    rows = (len(blocks) + cols - 1) // cols
    img = Image.new('RGBA', (cols * cw + 20, rows * ch + 20), BG + (255,))
    d = ImageDraw.Draw(img)
    for i, (label, top, side) in enumerate(blocks):
        t = get(top)[:N]
        s = get(side)[:N]
        b = iso_block(t, s, s)
        x = 10 + (i % cols) * cw + (cw - b.width) // 2
        y = 10 + (i // cols) * ch
        img.alpha_composite(b, (x, y))
        tw = d.textlength(label, font=f)
        d.text((10 + (i % cols) * cw + (cw - tw) / 2, y + b.height + 6), label, fill=(0xe0, 0xd6, 0xd0, 255), font=f)
    img.convert('RGB').save(os.path.join(PREVIEW_DIR, 'blocks_iso.png'))


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def validate():
    for e in REG:
        a = e['arr']
        assert a.dtype == np.uint8 and a.ndim == 3 and a.shape[2] == 4, e['name']
        assert a.shape[1] == N and a.shape[0] == N * e['frames'], (e['name'], a.shape)
        alpha = a[..., 3]
        if e['kind'] == 'block':
            assert (alpha == 255).all(), e['name'] + ' must be opaque'
        else:
            assert np.isin(alpha, (0, 255)).all(), e['name'] + ' must have binary alpha'
            assert (alpha == 0).any(), e['name'] + ' should have transparency'
            a[alpha == 0, :3] = 0


def main():
    for dpath in (BLOCK_DIR, ITEM_DIR, PREVIEW_DIR):
        os.makedirs(dpath, exist_ok=True)
    gen_veinstone()
    gen_deep_veinstone()
    gen_cracked_veinstone()
    gen_fleshstone()
    gen_pulsing_flesh()
    gen_organ_core()
    gen_cracked_organ_core()
    gen_dwelling_heart()
    gen_bloodmoss()
    gen_bloodmoss_side()
    gen_ribstone()
    gen_dripfang()
    gen_bloodroot()
    gen_hanging_tissue()
    gen_crimson_thorns()
    gen_glowspore()
    gen_skull_pile()
    gen_droppings()
    gen_sinew()
    gen_watcher_pod()
    gen_watcher_pod_open()
    gen_scored('stone')
    gen_scored('deepslate')
    gen_bone_chime()

    emit('item', 'config_wheel.png', item_config_wheel())
    emit('item', 'field_journal.png', item_field_journal())
    emit('item', 'rattlebone.png', item_rattlebone())
    emit('item', 'organ_muffler.png', item_organ_muffler())
    emit('item', 'glowspore_flare.png', item_glowspore_flare())
    emit('item', 'bone_chime_item.png', item_bone_chime())
    emit('item', 'organ_tissue.png', item_organ_tissue())
    emit('item', 'shaftbreaker_claw.png', item_claw())
    emit('item', 'moth_dust.png', item_moth_dust())
    emit('item', 'veinstone_shard.png', item_veinstone_shard())

    validate()
    for e in REG:
        folder = ITEM_DIR if e['kind'] == 'item' else BLOCK_DIR
        Image.fromarray(e['arr'], 'RGBA').save(os.path.join(folder, e['name']))
    make_sheet()
    make_iso()
    for e in REG:
        a = e['arr']
        ncol = len(np.unique(a[a[..., 3] > 0][:, :3], axis=0))
        print('%-32s %3dx%-4d colours=%d' % (e['name'], a.shape[1], a.shape[0], ncol))


if __name__ == '__main__':
    main()
