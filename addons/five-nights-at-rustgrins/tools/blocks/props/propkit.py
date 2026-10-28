"""propkit — tiny toolkit for vanilla-style Bedrock prop blocks.

Geometry is authored in *world space* (Blockbench display space):
  x: west(-8) .. east(+8), y: 0 .. 16 (up), z: north(-8) .. south(+8).
Models face north (front towards -Z); wall props have their back at z = +8.
On export x is mirrored to Bedrock geometry space (origin.x = -(x1)) and
rotations become [-rx, -ry, rz] — exactly what Blockbench does.

Texture painting is palette based: every texel stores (material, ramp index)
so shading operations (bevels, grime, wear) just move along the material's
colour ramp, which keeps the limited, vanilla-like palettes. Each material
also carries its PBR intent (metalness, roughness, emissive, height).

UV layout: each face gets its own texel rectangle (1 texel = 1 model pixel),
shelf-packed into the sheet; faces with the same `share` key reuse one
rectangle. Face orientation in the texture (matches Blockbench/Bedrock):
  sides: as seen from outside, top = up
  up:    top = north, left = west
  down:  top = south, left = west
"""
from __future__ import annotations

import json
import math
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
RP = ROOT / 'packs/RP'
BP = ROOT / 'packs/BP'
TEX_DIR = RP / 'textures/blocks/fnar'
GEO_DIR = RP / 'models/blocks'
BLOCK_DIR = BP / 'blocks'
FRAG_DIR = ROOT / 'tools/fragments'

REGISTRY = {}


def prop(fn):
    """Register a prop builder: fn(out) writes geometry, textures, block JSON and fragment entries."""
    REGISTRY[fn.__name__] = fn
    return fn


FACES = ('north', 'south', 'east', 'west', 'up', 'down')


def seed_of(*parts) -> int:
    return zlib.crc32('|'.join(str(p) for p in parts).encode()) & 0x7fffffff


def hexc(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float)


# ----------------------------------------------------------------- noise
def white(w, h, seed):
    return np.random.default_rng(seed).random((h, w))


def value_noise(w, h, seed, cell=3.0):
    """Smooth value noise in [0,1] (bilinear between random lattice values)."""
    rng = np.random.default_rng(seed)
    gw, gh = int(math.ceil(w / cell)) + 2, int(math.ceil(h / cell)) + 2
    g = rng.random((gh, gw))
    ys, xs = (np.arange(h) + 0.5) / cell, (np.arange(w) + 0.5) / cell
    x0, y0 = xs.astype(int), ys.astype(int)
    fx, fy = xs - x0, ys - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]; d = g[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


# ----------------------------------------------------------------- materials
class Mat:
    """A palette ramp (dark -> light) plus PBR intent."""
    reg: list['Mat'] = []

    def __init__(self, name, ramp, metal=0, rough=200, emit=0, h=128, hk=5, base=None):
        self.name = name
        self.ramp = np.array([hexc(c) for c in ramp])
        self.n = len(ramp)
        self.metal = metal
        self.rough = rough
        self.emit = emit if isinstance(emit, (list, tuple)) else [emit] * self.n
        self.h = h
        self.hk = hk
        self.base = (self.n - 1) // 2 if base is None else base
        self.id = len(Mat.reg)
        Mat.reg.append(self)

    def __repr__(self):
        return f'Mat({self.name})'


def solid(name, color, **kw):
    return Mat(name, [color], **kw)


# ----------------------------------------------------------------- sheet / region
class Sheet:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.mat = np.full((h, w), -1, dtype=np.int32)
        self.idx = np.zeros((h, w), dtype=np.int32)
        self.hoff = np.zeros((h, w), dtype=float)
        self.emit = np.full((h, w), np.nan)
        self.rough = np.full((h, w), np.nan)
        self.metal = np.full((h, w), np.nan)

    def images(self):
        H, W = self.h, self.w
        col = np.zeros((H, W, 4), dtype=np.uint8)
        mer = np.zeros((H, W, 3), dtype=np.uint8)
        hgt = np.full((H, W), 128, dtype=np.uint8)
        for y in range(H):
            for x in range(W):
                m = self.mat[y, x]
                if m < 0:
                    continue
                M = Mat.reg[m]
                i = int(np.clip(self.idx[y, x], 0, M.n - 1))
                col[y, x, :3] = M.ramp[i]
                col[y, x, 3] = 255
                metal = M.metal if np.isnan(self.metal[y, x]) else self.metal[y, x]
                rough = M.rough if np.isnan(self.rough[y, x]) else self.rough[y, x]
                rough = rough - (i - M.base) * 4  # lighter texels slightly smoother
                emit = M.emit[i] if np.isnan(self.emit[y, x]) else self.emit[y, x]
                mer[y, x] = [np.clip(metal, 0, 255), np.clip(emit, 0, 255), np.clip(rough, 8, 255)]
                hgt[y, x] = int(np.clip(M.h + (i - M.base) * M.hk + self.hoff[y, x], 0, 255))
        return col, mer, hgt


class Region:
    """A face rectangle on a sheet; local coords x right, y down."""

    def __init__(self, sheet: Sheet, x0, y0, w, h, face=None, cube=None, variant=None, frame=0, world=None, prop=''):
        self.s, self.x0, self.y0, self.w, self.h = sheet, x0, y0, w, h
        self.face, self.cube, self.variant, self.frame = face, cube, variant, frame
        self._world = world
        self.prop = prop
        self.key = f'{prop}:{cube.name if cube else ""}:{face}'

    # ---- helpers
    def seed(self, *extra):
        return seed_of(self.key, *extra)

    def _ok(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def world(self, c, r):
        """World position (x, y, z) of texel (c, r) centre."""
        return self._world(c + 0.5, r + 0.5) if self._world else (0, 0, 0)

    def sub(self, x, y, w, h, **kw):
        r = Region(self.s, self.x0 + x, self.y0 + y, w, h, self.face, self.cube, self.variant, self.frame,
                   None, self.prop)
        r.key = self.key + f'@{x},{y}'
        for k, v in kw.items():
            setattr(r, k, v)
        return r

    # ---- primitive writes
    def px(self, x, y, mat: Mat | None, i=None, emit=None, h=None, rough=None, metal=None):
        x, y = int(round(x)), int(round(y))
        if not self._ok(x, y):
            return
        X, Y = self.x0 + x, self.y0 + y
        if mat is None:
            self.s.mat[Y, X] = -1
            return
        self.s.mat[Y, X] = mat.id
        self.s.idx[Y, X] = mat.base if i is None else int(np.clip(i, 0, mat.n - 1))
        self.s.emit[Y, X] = np.nan if emit is None else emit
        self.s.hoff[Y, X] = 0 if h is None else h
        self.s.rough[Y, X] = np.nan if rough is None else rough
        self.s.metal[Y, X] = np.nan if metal is None else metal

    def get(self, x, y):
        if not self._ok(x, y):
            return None, None
        m = self.s.mat[self.y0 + y, self.x0 + x]
        return (Mat.reg[m] if m >= 0 else None), self.s.idx[self.y0 + y, self.x0 + x]

    def shift(self, x, y, d):
        if not self._ok(x, y):
            return
        X, Y = self.x0 + x, self.y0 + y
        m = self.s.mat[Y, X]
        if m < 0:
            return
        self.s.idx[Y, X] = int(np.clip(self.s.idx[Y, X] + d, 0, Mat.reg[m].n - 1))

    def set_h(self, x, y, dh, add=True):
        if self._ok(x, y):
            Y, X = self.y0 + y, self.x0 + x
            self.s.hoff[Y, X] = self.s.hoff[Y, X] + dh if add else dh

    def set_emit(self, x, y, e):
        if self._ok(x, y):
            self.s.emit[self.y0 + y, self.x0 + x] = e

    def set_rough(self, x, y, v):
        if self._ok(x, y):
            self.s.rough[self.y0 + y, self.x0 + x] = v

    def is_mat(self, x, y, mat):
        m, _ = self.get(x, y)
        return m is mat

    # ---- fills
    def fill(self, mat: Mat, base=None, amp=1.0, cell=3.0, white_amp=0.45, seed=0, rect=None, streak=None):
        """Noisy fill: idx = base + round(noise). streak='h'|'v' stretches noise (brushed metal / wood)."""
        x0, y0, w, h = rect or (0, 0, self.w, self.h)
        if w <= 0 or h <= 0:
            return
        base = mat.base if base is None else base
        s = self.seed('fill', seed)
        if streak in ('h', 'v'):
            # streaks: noise mostly constant along the streak direction (brushed metal, wood grain)
            line = value_noise(w if streak == 'v' else h, 1, s, max(1.0, cell / 2))[0]
            line = (line + white(len(line), 1, s + 7)[0]) / 2
            vn = np.tile(line, (h, 1)) if streak == 'v' else np.tile(line[:, None], (1, w))
            vn = vn * 0.75 + value_noise(w, h, s + 3, cell * 2) * 0.25
        else:
            vn = value_noise(w, h, s, cell)
        wn = white(w, h, s + 1)
        n = (vn - 0.5) * 2.0 * amp + (wn - 0.5) * 2.0 * white_amp
        for yy in range(h):
            for xx in range(w):
                self.px(x0 + xx, y0 + yy, mat, base + int(round(n[yy, xx])))

    def rect(self, x, y, w, h, mat, i=None, **kw):
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                self.px(xx, yy, mat, i, **kw)

    def frame_rect(self, x, y, w, h, mat, i=None, **kw):
        for xx in range(x, x + w):
            self.px(xx, y, mat, i, **kw); self.px(xx, y + h - 1, mat, i, **kw)
        for yy in range(y, y + h):
            self.px(x, yy, mat, i, **kw); self.px(x + w - 1, yy, mat, i, **kw)

    def hline(self, x, y, n, mat, i=None, **kw):
        for k in range(n):
            self.px(x + k, y, mat, i, **kw)

    def vline(self, x, y, n, mat, i=None, **kw):
        for k in range(n):
            self.px(x, y + k, mat, i, **kw)

    def clear(self, x=0, y=0, w=None, h=None):
        w = self.w if w is None else w
        h = self.h if h is None else h
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, None)

    def disc(self, cx, cy, rad, mat, i=None, ring=None, **kw):
        """Filled pixel disc centred at (cx, cy) (texel-centre space)."""
        for yy in range(self.h):
            for xx in range(self.w):
                d = math.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
                if d <= rad and (ring is None or d > rad - ring):
                    self.px(xx, yy, mat, i, **kw)

    def shade_rect(self, x, y, w, h, d):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.shift(xx, yy, d)

    def bevel(self, hi=1, lo=-1, t=True, l=True, b=True, r=True, rect=None):
        """Vanilla-style 1px edge light (top/left) and shadow (bottom/right)."""
        x0, y0, w, h = rect or (0, 0, self.w, self.h)
        if t:
            for xx in range(x0, x0 + w): self.shift(xx, y0, hi)
        if l:
            for yy in range(y0 + (1 if t else 0), y0 + h): self.shift(x0, yy, hi)
        if b:
            for xx in range(x0, x0 + w): self.shift(xx, y0 + h - 1, lo)
        if r:
            for yy in range(y0, y0 + h - (1 if b else 0)): self.shift(x0 + w - 1, yy, lo)

    def speck(self, mat, i, p, seed=0, rect=None, only=None, **kw):
        x0, y0, w, h = rect or (0, 0, self.w, self.h)
        rn = white(w, h, self.seed('speck', seed))
        for yy in range(h):
            for xx in range(w):
                if rn[yy, xx] < p and (only is None or self.is_mat(x0 + xx, y0 + yy, only)):
                    self.px(x0 + xx, y0 + yy, mat, i, **kw)

    def darken_noise(self, p=0.25, d=-1, seed=0, cell=2.5, rect=None, bottom=0.0, only=None):
        """Grime: shift texels darker where smooth noise (biased to the bottom) exceeds a threshold."""
        x0, y0, w, h = rect or (0, 0, self.w, self.h)
        vn = value_noise(w, h, self.seed('grime', seed), cell)
        wn = white(w, h, self.seed('grime2', seed))
        for yy in range(h):
            for xx in range(w):
                bias = bottom * (yy / max(1, h - 1))
                if vn[yy, xx] * 0.75 + wn[yy, xx] * 0.25 + bias > 1.0 - p:
                    if only is None or self.is_mat(x0 + xx, y0 + yy, only):
                        self.shift(x0 + xx, y0 + yy, d)

    def stain(self, mat, i, cx, cy, rx, ry, seed=0, p=0.85, only=None, **kw):
        """Irregular blotch (stains, rust patches)."""
        rn = white(self.w, self.h, self.seed('stain', seed))
        vn = value_noise(self.w, self.h, self.seed('stain2', seed), 2.0)
        for yy in range(self.h):
            for xx in range(self.w):
                d = ((xx + 0.5 - cx) / max(rx, .1)) ** 2 + ((yy + 0.5 - cy) / max(ry, .1)) ** 2
                if d + (vn[yy, xx] - 0.5) * 0.9 < 1.0 and rn[yy, xx] < p:
                    if only is None or self.is_mat(xx, yy, only):
                        ii = i(xx, yy) if callable(i) else i
                        self.px(xx, yy, mat, ii, **kw)

    def drip(self, mat, i, x, y, n, seed=0, **kw):
        """Vertical drip streak (rust, water)."""
        rn = white(1, n + 2, self.seed('drip', seed, x, y))
        for k in range(n):
            if rn[k, 0] < 0.9 - k * 0.04:
                self.px(x, y + k, mat, i, **kw)

    def blit(self, rows, legend, x=0, y=0):
        """Hand-drawn pixel art. legend: char -> (mat, idx[, kw]) | None (transparent). '.' and ' ' skip."""
        for yy, row in enumerate(rows):
            for xx, ch in enumerate(row):
                if ch in ' .':
                    continue
                v = legend[ch]
                if v is None:
                    self.px(x + xx, y + yy, None)
                else:
                    kw = v[2] if len(v) > 2 else {}
                    self.px(x + xx, y + yy, v[0], v[1], **kw)

    def rot180(self):
        """Rotate the region's content by 180 deg. Up faces have north at the top of the texture, so art
        meant to be read by a player standing in front of a north-facing block must be rotated."""
        ys, xs = slice(self.y0, self.y0 + self.h), slice(self.x0, self.x0 + self.w)
        for a in (self.s.mat, self.s.idx, self.s.hoff, self.s.emit, self.s.rough, self.s.metal):
            a[ys, xs] = a[ys, xs][::-1, ::-1].copy()

    def text(self, s, x, y, mat, i=None, font=None, spacing=1, **kw):
        font = font or FONT_3x5
        cx = x
        for ch in s:
            g = font.get(ch.upper())
            if g is None:
                cx += 2
                continue
            for yy, row in enumerate(g):
                for xx, c in enumerate(row):
                    if c == '#':
                        self.px(cx + xx, y + yy, mat, i, **kw)
            cx += len(g[0]) + spacing
        return cx

    def text_width(self, s, font=None, spacing=1):
        font = font or FONT_3x5
        w = 0
        for ch in s:
            g = font.get(ch.upper())
            w += (len(g[0]) if g else 1) + spacing
        return w - spacing


FONT_3x5 = {
    'A': ['.#.', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'],
    'C': ['.##', '#..', '#..', '#..', '.##'], 'D': ['##.', '#.#', '#.#', '#.#', '##.'],
    'E': ['###', '#..', '##.', '#..', '###'], 'F': ['###', '#..', '##.', '#..', '#..'],
    'G': ['.##', '#..', '#.#', '#.#', '.##'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'],
    'I': ['###', '.#.', '.#.', '.#.', '###'], 'K': ['#.#', '#.#', '##.', '#.#', '#.#'],
    'L': ['#..', '#..', '#..', '#..', '###'], 'M': ['#.#', '###', '###', '#.#', '#.#'],
    'N': ['##.', '#.#', '#.#', '#.#', '#.#'], 'O': ['.#.', '#.#', '#.#', '#.#', '.#.'],
    'P': ['##.', '#.#', '##.', '#..', '#..'], 'R': ['##.', '#.#', '##.', '#.#', '#.#'],
    'S': ['.##', '#..', '.#.', '..#', '##.'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'],
    'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'W': ['#.#', '#.#', '###', '###', '#.#'],
    'Y': ['#.#', '#.#', '.#.', '.#.', '.#.'], '!': ['#', '#', '#', '.', '#'],
    '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#', '##', '.#', '.#', '.#'],
    '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
    '6': ['.##', '#..', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
}
FONT_3x4 = {
    'R': ['##.', '#.#', '##.', '#.#'], 'A': ['.#.', '#.#', '###', '#.#'], 'T': ['###', '.#.', '.#.', '.#.'],
    'C': ['.##', '#..', '#..', '.##'], 'E': ['###', '##.', '#..', '###'], 'N': ['#.#', '###', '###', '#.#'],
    'O': ['.#.', '#.#', '#.#', '.#.'], 'U': ['#.#', '#.#', '#.#', '###'], 'I': ['#', '#', '#', '#'],
    'P': ['##.', '#.#', '##.', '#..'], 'S': ['.##', '##.', '..#', '##.'], 'L': ['#..', '#..', '#..', '###'],
    'Y': ['#.#', '#.#', '.#.', '.#.'], 'D': ['##.', '#.#', '#.#', '##.'], 'M': ['#.#', '###', '#.#', '#.#'],
}


# ----------------------------------------------------------------- painters
def seq(*ps):
    def p(r):
        for f in ps:
            if f:
                f(r)
    return p


def panel(mat, base=None, amp=0.8, cell=3.0, white_amp=0.4, bevel=(1, -1), grime=0.0, grime_bottom=0.6,
          streak=None, seed=0, edges='tlbr'):
    """Generic material face: noisy fill + optional bevel + bottom-biased grime."""
    def p(r: Region):
        r.fill(mat, base, amp, cell, white_amp, seed, streak=streak)
        if bevel:
            hi, lo = bevel
            r.bevel(hi, lo, 't' in edges, 'l' in edges, 'b' in edges, 'r' in edges)
        if grime:
            bottom = grime_bottom if r.face not in ('up', 'down') else 0
            r.darken_noise(grime, -1, seed=seed, bottom=bottom)
    return p


# ----------------------------------------------------------------- geometry
class Face:
    def __init__(self, painter, share=None, mi=None, flip=None, at=None):
        self.painter, self.share, self.mi, self.flip, self.at = painter, share, mi, flip, at


class Cube:
    def __init__(self, name, frm, to, faces, rotation=None, pivot=None, bone=None):
        self.name, self.frm, self.to = name, [float(v) for v in frm], [float(v) for v in to]
        self.faces, self.rotation, self.pivot, self.bone = faces, rotation, pivot, bone

    def size(self):
        return [self.to[k] - self.frm[k] for k in range(3)]

    def face_dims(self, f):
        sx, sy, sz = self.size()
        return {'north': (sx, sy), 'south': (sx, sy), 'east': (sz, sy), 'west': (sz, sy),
                'up': (sx, sz), 'down': (sx, sz)}[f]

    def face_world(self, f):
        """Map texel (u, v) inside the face rect to world coordinates (unrotated cube)."""
        (x0, y0, z0), (x1, y1, z1) = self.frm, self.to
        return {
            'north': lambda u, v: (x1 - u, y1 - v, z0), 'south': lambda u, v: (x0 + u, y1 - v, z1),
            'east': lambda u, v: (x1, y1 - v, z1 - u), 'west': lambda u, v: (x0, y1 - v, z0 + u),
            'up': lambda u, v: (x0 + u, y1, z0 + v), 'down': lambda u, v: (x0 + u, y0, z1 - v),
        }[f]


class Bone:
    def __init__(self, name, pivot=(0, 0, 0), rotation=None, parent=None):
        self.name, self.pivot, self.rotation, self.parent = name, pivot, rotation, parent
        self.cubes: list[Cube] = []


class Geo:
    def __init__(self, name, tw=32, th=32):
        self.name, self.tw, self.th = name, tw, th
        self.bones: list[Bone] = []
        self._bones = {}
        self.layout = None
        self.placements = {}  # key -> (u, v, w, h)

    def bone(self, name, pivot=(0, 0, 0), rotation=None, parent=None):
        b = Bone(name, pivot, rotation, parent)
        self.bones.append(b)
        self._bones[name] = b
        return name

    def box(self, bone, frm, to, faces, name=None, rotation=None, pivot=None):
        """faces: dict face -> painter | Face | None. Keys may include '*' (default) and 'sides'."""
        if bone not in self._bones:
            self.bone(bone)
        b = self._bones[bone]
        name = name or f'{bone}_{len(b.cubes)}'
        resolved = {}
        for f in FACES:
            if f in faces:
                v = faces[f]
            elif f in ('north', 'south', 'east', 'west') and 'sides' in faces:
                v = faces['sides']
            elif f in ('up', 'down') and 'ends' in faces:
                v = faces['ends']
            else:
                v = faces.get('*')
            if v is None:
                continue
            if not isinstance(v, Face):
                v = Face(v)
            resolved[f] = v
        c = Cube(name, frm, to, resolved, rotation, pivot, bone)
        # Drop faces with zero area.
        for f in list(c.faces):
            w, h = c.face_dims(f)
            if w <= 1e-6 or h <= 1e-6:
                del c.faces[f]
        b.cubes.append(c)
        return c

    # ---- UV packing
    def _face_items(self):
        items, seen = [], {}
        for b in self.bones:
            for c in b.cubes:
                for f, F in c.faces.items():
                    w, h = c.face_dims(f)
                    W, Hh = int(math.ceil(w - 1e-6)), int(math.ceil(h - 1e-6))
                    key = self._key(c, f, F)
                    if key in seen:
                        continue
                    seen[key] = (c, W, Hh)
                    items.append((key, W, Hh, c, f, F))
        return items

    @staticmethod
    def _key(c, f, F):
        if not F.share:
            return f'{c.name}.{f}'
        w, h = c.face_dims(f)
        return f'{F.share}#{int(math.ceil(w - 1e-6))}x{int(math.ceil(h - 1e-6))}'

    def pack(self):
        """Pack into the smallest square power-of-two sheet (16, 32, 64) that fits, up to the requested size."""
        limit = max(self.tw, self.th)
        for size in (16, 32, 64):
            if size > limit:
                break
            self.tw = self.th = size
            try:
                return self._pack()
            except ValueError:
                continue
        self.tw = self.th = limit
        return self._pack()

    def _pack(self):
        items = self._face_items()
        occ = np.zeros((self.th, self.tw), dtype=bool)
        placements = {}
        fixed = [it for it in items if it[5].at]
        free = [it for it in items if not it[5].at]
        for key, W, Hh, c, f, F in fixed:
            u, v = F.at
            placements[key] = (u, v, W, Hh)
            occ[v:v + Hh, u:u + W] = True
        free.sort(key=lambda it: (-it[2], -it[1], it[0]))
        for key, W, Hh, c, f, F in free:
            done = False
            for v in range(0, self.th - Hh + 1):
                for u in range(0, self.tw - W + 1):
                    if not occ[v:v + Hh, u:u + W].any():
                        placements[key] = (u, v, W, Hh)
                        occ[v:v + Hh, u:u + W] = True
                        done = True
                        break
                if done:
                    break
            if not done:
                raise ValueError(f'{self.name}: no room for {key} ({W}x{Hh}) in {self.tw}x{self.th}')
        self.placements = placements
        self.items = items
        return placements

    # ---- painting
    def paint(self, variant=None, frame=0, only_flip=False, sheet=None):
        if not self.placements:
            self.pack()
        sheet = sheet or Sheet(self.tw, self.th)
        for key, W, Hh, c, f, F in self.items:
            if only_flip and not F.flip:
                continue
            u, v, _, _ = self.placements[key]
            reg = Region(sheet, u, v, W, Hh, f, c, variant, frame, c.face_world(f), self.name)
            reg.key = f'{self.name}:{key}'
            if F.painter:
                F.painter(reg)
        return sheet

    # ---- export
    def export(self, variants=None):
        """variants: {identifier: (bone_names | None, (dx,dy,dz))}; default one geometry with all bones."""
        if not self.placements:
            self.pack()
        variants = variants or {f'geometry.fnar.{self.name}': (None, (0, 0, 0))}
        geos = []
        for ident, (bone_names, off) in variants.items():
            dx, dy, dz = off
            bones = []
            for b in self.bones:
                if bone_names is not None and b.name not in bone_names:
                    continue
                bj = {'name': b.name, 'pivot': _r3(-(b.pivot[0] + dx), b.pivot[1] + dy, b.pivot[2] + dz)}
                if b.parent:
                    bj['parent'] = b.parent
                if b.rotation:
                    bj['rotation'] = _r3(-b.rotation[0], -b.rotation[1], b.rotation[2])
                cubes = []
                for c in b.cubes:
                    (x0, y0, z0), (x1, y1, z1) = c.frm, c.to
                    cj = {'origin': _r3(-(x1 + dx), y0 + dy, z0 + dz), 'size': _r3(x1 - x0, y1 - y0, z1 - z0)}
                    if c.rotation:
                        p = c.pivot or [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
                        cj['pivot'] = _r3(-(p[0] + dx), p[1] + dy, p[2] + dz)
                        cj['rotation'] = _r3(-c.rotation[0], -c.rotation[1], c.rotation[2])
                    uv = {}
                    for f in FACES:
                        if f not in c.faces:
                            continue
                        F = c.faces[f]
                        u, v, _, _ = self.placements[self._key(c, f, F)]
                        w, h = c.face_dims(f)
                        if f in ('up', 'down'):
                            e = {'uv': _r2(u + w, v + h), 'uv_size': _r2(-w, -h)}
                        else:
                            e = {'uv': _r2(u, v), 'uv_size': _r2(w, h)}
                        if F.mi:
                            e['material_instance'] = F.mi
                        uv[f] = e
                    cj['uv'] = uv
                    cubes.append(cj)
                bj['cubes'] = cubes
                bones.append(bj)
            geos.append({
                'description': {'identifier': ident, 'texture_width': self.tw, 'texture_height': self.th,
                                'visible_bounds_width': 3, 'visible_bounds_height': 3,
                                'visible_bounds_offset': [0, 0.75, 0]},
                'bones': bones,
            })
        return {'format_version': '1.12.0', 'minecraft:geometry': geos}

    def cube_count(self):
        return sum(len(b.cubes) for b in self.bones)


def _n(v):
    v = round(float(v), 4)
    return int(v) if v == int(v) else v


def _r3(a, b, c):
    return [_n(a), _n(b), _n(c)]


def _r2(a, b):
    return [_n(a), _n(b)]


# ----------------------------------------------------------------- writers
def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + '\n')


def save_texture(tex: str, sheet: Sheet | list[Sheet]):
    """Writes <tex>.png, <tex>_mer.png, <tex>_height.png and <tex>.texture_set.json.
    A list of sheets is stacked vertically (flipbook strip)."""
    sheets = sheet if isinstance(sheet, list) else [sheet]
    cols, mers, hs = zip(*(s.images() for s in sheets))
    col, mer, hgt = np.concatenate(cols), np.concatenate(mers), np.concatenate(hs)
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(col, 'RGBA').save(TEX_DIR / f'{tex}.png')
    Image.fromarray(mer, 'RGB').save(TEX_DIR / f'{tex}_mer.png')
    Image.fromarray(hgt, 'L').save(TEX_DIR / f'{tex}_height.png')
    write_json(TEX_DIR / f'{tex}.texture_set.json', {
        'format_version': '1.21.30',
        'minecraft:texture_set': {'color': tex, 'metalness_emissive_roughness': f'{tex}_mer', 'heightmap': f'{tex}_height'},
    })


# ----------------------------------------------------------------- block JSON
FACING = [('north', 0), ('west', 90), ('south', 180), ('east', -90)]


def bs(state, value):
    v = f"'{value}'" if isinstance(value, str) else ('true' if value is True else 'false' if value is False else value)
    return f"q.block_state('{state}') == {v}"


def mi_set(tex, extra=None, render='alpha_test'):
    """material_instances: '*' -> tex, plus extra {name: tex or dict}."""
    out = {'*': {'texture': f'fnar_{tex}', 'render_method': render}}
    for k, v in (extra or {}).items():
        out[k] = v if isinstance(v, dict) else {'texture': f'fnar_{v}', 'render_method': render}
    return out


def glow(tex, render='alpha_test'):
    """An emissive-looking material instance (no face dimming / AO)."""
    return {'texture': f'fnar_{tex}', 'render_method': render, 'face_dimming': False, 'ambient_occlusion': False}


def block_json(name, *, geometry, materials, collision, selection, map_color, destroy=1.5, states=None,
               facing=True, perms=None, extra=None, light_dampening=0, menu='construction', light=None):
    """perms: list of (condition, components). Facing permutations are appended last."""
    desc = {'identifier': f'fnar:{name}', 'menu_category': {'category': menu}}
    if states:
        desc['states'] = states
    if facing:
        desc['traits'] = {'minecraft:placement_direction': {'enabled_states': ['minecraft:cardinal_direction'],
                                                            'y_rotation_offset': 180}}
    comps = {
        'minecraft:geometry': geometry if isinstance(geometry, (str, dict)) else geometry,
        'minecraft:material_instances': materials,
        'minecraft:collision_box': collision,
        'minecraft:selection_box': selection,
        'minecraft:destructible_by_mining': {'seconds_to_destroy': destroy},
        'minecraft:destructible_by_explosion': {'explosion_resistance': 3},
        'minecraft:map_color': map_color,
        'minecraft:light_dampening': light_dampening,
    }
    if light:
        comps['minecraft:light_emission'] = light
    if extra:
        comps.update(extra)
    permutations = [{'condition': c, 'components': p} for c, p in (perms or [])]
    if facing:
        for d, rot in FACING:
            permutations.append({'condition': bs('minecraft:cardinal_direction', d),
                                 'components': {'minecraft:transformation': {'rotation': [0, rot, 0]}}})
    blk = {'format_version': '1.26.50', 'minecraft:block': {'description': desc, 'components': comps}}
    if permutations:
        blk['minecraft:block']['permutations'] = permutations
    return blk


def pillar_views(label='pillar N/E/S/W', y=0, dist=3.6, extra_states=None):
    """Preview views placing the block on all four sides of a pillar, each facing away from it."""
    st = extra_states or {}
    parts = [{'states': {**st, 'minecraft:cardinal_direction': d}, 'pos': p} for d, p in
             (('north', [0, y, -1]), ('east', [1, y, 0]), ('south', [0, y, 1]), ('west', [-1, y, 0]))]
    return [{'label': label + ' from NE', 'env': 'pillar', 'parts': parts, 'focus': [0, 0.6, 0], 'dist': dist, 'dir': [1, 0.75, -1]},
            {'label': label + ' from SW', 'env': 'pillar', 'parts': parts, 'focus': [0, 0.6, 0], 'dist': dist, 'dir': [-1, 0.75, 1]}]


def box(x0, y0, z0, x1, y1, z1):
    """collision/selection box from world-space min/max. Boxes are kept symmetric in x (widened if
    needed) so they are correct whether or not the engine mirrors x like geometry does."""
    hx = max(abs(x0), abs(x1))
    return {'origin': [_n(-hx), _n(y0), _n(z0)], 'size': [_n(2 * hx), _n(y1 - y0), _n(z1 - z0)]}
