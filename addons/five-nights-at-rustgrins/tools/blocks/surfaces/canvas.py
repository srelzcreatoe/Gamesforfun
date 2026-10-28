"""Multi-tile canvas for posters and signs: draw at full size, then slice into
16x16 tiles (row-major from the top-left as seen from the front)."""
import numpy as np

from font import render
from pixlib import Tex, blur_wrap, hexc, mix, rng, shade, tile_noise, white
from sprites import emissive_keys, sprite


class Canvas(Tex):
    def __init__(self, w, h, rough=225, height=150):
        super().__init__(w, h, rough=rough, height=height)
        self.a[:] = 255

    # ---------------------------------------------------------------- fills
    def fill(self, color, box=None):
        x0, y0, x1, y1 = box or (0, 0, self.w, self.h)
        self.rgb[y0:y1, x0:x1] = hexc(color) if isinstance(color, str) else color

    def noise_fill(self, pal, seed, box=None, cell=4, amt=1.0):
        x0, y0, x1, y1 = box or (0, 0, self.w, self.h)
        w, h = x1 - x0, y1 - y0
        n = 0.55 * tile_noise(w, h, cell, seed) + 0.45 * white(w, h, seed + 1)
        n = 0.5 + (n - 0.5) * amt
        p = np.stack([hexc(c) for c in pal])
        idx = np.clip((n * len(p)).astype(int), 0, len(p) - 1)
        self.rgb[y0:y1, x0:x1] = p[idx]

    def px(self, x, y, color, emit=None, rough=None, metal=None, height=None):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.rgb[y, x] = hexc(color) if isinstance(color, str) else color
            self.a[y, x] = 255
            if emit is not None:
                self.emit[y, x] = emit
            if rough is not None:
                self.rough[y, x] = rough
            if metal is not None:
                self.metal[y, x] = metal
            if height is not None:
                self.height[y, x] = height

    def rect(self, x0, y0, x1, y1, color, **kw):
        for y in range(y0, y1):
            for x in range(x0, x1):
                self.px(x, y, color, **kw)

    def frame(self, x0, y0, x1, y1, color, **kw):
        for x in range(x0, x1):
            self.px(x, y0, color, **kw)
            self.px(x, y1 - 1, color, **kw)
        for y in range(y0, y1):
            self.px(x0, y, color, **kw)
            self.px(x1 - 1, y, color, **kw)

    # ---------------------------------------------------------------- text
    def text(self, s, x, y, color, font='small', shadow=None, outline=None, center=False, emit=None,
             condensed=False, cond_chars=None, spacing=1, height=None):
        m = render(s, font=font, condensed=condensed, cond_chars=cond_chars, spacing=spacing)
        h, w = m.shape
        if center:
            x = x - w // 2 if center is True else (self.w - w) // 2
        if outline:
            big = np.zeros((h + 2, w + 2), bool)
            big[1:-1, 1:-1] = m
            ol = np.zeros_like(big)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    ol |= np.roll(np.roll(big, dy, 0), dx, 1)
            ol &= ~big
            for yy, xx in zip(*np.nonzero(ol)):
                self.px(x + xx - 1, y + yy - 1, outline)
        if shadow:
            for yy, xx in zip(*np.nonzero(m)):
                self.px(x + xx + 1, y + yy + 1, shadow)
        for yy, xx in zip(*np.nonzero(m)):
            self.px(x + xx, y + yy, color, emit=emit, height=height)
        return x, w

    # ---------------------------------------------------------------- sprites
    def sprite(self, name, x, y, overlays=(), outline=None, eyes_emit=None, flip=False):
        s = sprite(name, overlays)
        rgb, mask = s['rgb'], s['mask']
        eyes = emissive_keys(name)
        if flip:
            rgb, mask, eyes = rgb[:, ::-1], mask[:, ::-1], eyes[:, ::-1]
        h, w = mask.shape
        if outline:
            big = np.zeros((h + 2, w + 2), bool)
            big[1:-1, 1:-1] = mask
            ol = np.zeros_like(big)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ol |= np.roll(np.roll(big, dy, 0), dx, 1)
            ol &= ~big
            for yy, xx in zip(*np.nonzero(ol)):
                self.px(x + xx - 1, y + yy - 1, outline)
        for yy, xx in zip(*np.nonzero(mask)):
            e = eyes_emit if (yy < eyes.shape[0] and xx < eyes.shape[1] and eyes[yy, xx]) else None
            self.px(x + xx, y + yy, rgb[yy, xx], emit=e, height=165)
        return w, h

    # ---------------------------------------------------------------- paper ageing
    def age(self, seed, paper='#c9bea3', fade=0.18, yellow=0.12, stains=3, crease_rows=(), crease_cols=(),
            torn=(), tape=(), dirt=0.12):
        r = rng(seed)
        H, W = self.h, self.w
        n = tile_noise(W, H, 8, seed)
        # print fade + yellowing (stronger towards the edges)
        ex = np.minimum(np.arange(W), W - 1 - np.arange(W))[None, :]
        ey = np.minimum(np.arange(H), H - 1 - np.arange(H))[:, None]
        edge = np.clip(1 - np.minimum(ex, ey) / 4.0, 0, 1)
        k = fade + 0.06 * edge + 0.08 * (n - 0.5)
        self.rgb = mix(self.rgb, hexc(paper), np.clip(k, 0, 0.6))
        self.rgb = mix(self.rgb, hexc('#8a7444'), yellow * (0.6 + 0.8 * n))
        # grime noise
        wn = white(W, H, seed + 3)
        grime = wn > 1 - dirt
        self.rgb[grime] = shade(self.rgb[grime], 0.9)
        # water/coffee stains: soft rings
        for _ in range(stains):
            cx, cy, rad = r.uniform(2, W - 2), r.uniform(2, H - 2), r.uniform(2, 4.5)
            yy, xx = np.mgrid[0:H, 0:W]
            d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            inner = d < rad
            ring = (d >= rad) & (d < rad + 1)
            self.rgb[inner] = mix(self.rgb[inner], hexc('#7a6036'), 0.16)
            self.rgb[ring] = mix(self.rgb[ring], hexc('#6a4f2a'), 0.32)
        # fold creases: a light line with a dark line beside it
        for y in crease_rows:
            self.rgb[y] = shade(self.rgb[y], 1.12)
            self.rgb[y + 1] = shade(self.rgb[y + 1], 0.88)
            self.height[y] += 12
        for x in crease_cols:
            self.rgb[:, x] = shade(self.rgb[:, x], 1.12)
            self.rgb[:, x + 1] = shade(self.rgb[:, x + 1], 0.88)
            self.height[:, x] += 12
        # torn corners: list of (corner, size) -> transparent triangle + ragged dark edge
        for corner, size in torn:
            for i in range(size):
                for j in range(size - i):
                    x = j if 'l' in corner else W - 1 - j
                    y = i if 't' in corner else H - 1 - i
                    self.a[y, x] = 0
            for i in range(size + 1):
                j = size - i
                x = j if 'l' in corner else W - 1 - j
                y = i if 't' in corner else H - 1 - i
                if 0 <= x < W and 0 <= y < H and self.a[y, x]:
                    self.rgb[y, x] = mix(self.rgb[y, x], hexc('#e0d6bf'), 0.6)  # torn paper fibre is light
        # tape strips: (x, y, w, h)
        for (x0, y0, w, h) in tape:
            for y in range(y0, y0 + h):
                for x in range(x0, x0 + w):
                    if 0 <= x < W and 0 <= y < H:
                        self.rgb[y, x] = mix(self.rgb[y, x], hexc('#d8cc9a'), 0.6)
                        self.a[y, x] = 255
                        self.rough[y, x] = 120
                        self.height[y, x] = 185

    # ---------------------------------------------------------------- output
    def tiles(self, cols, rows):
        out = []
        for ty in range(rows):
            for tx in range(cols):
                t = Tex(16, 16)
                sl = (slice(ty * 16, ty * 16 + 16), slice(tx * 16, tx * 16 + 16))
                t.rgb = self.rgb[sl].copy()
                t.a = self.a[sl].copy()
                t.metal = self.metal[sl].copy()
                t.emit = self.emit[sl].copy()
                t.rough = self.rough[sl].copy()
                t.height = self.height[sl].copy()
                out.append(t)
        return out

    def finish(self):
        # transparent pixels: zero everything so mips/MER stay clean
        z = self.a == 0
        self.rgb[z] = 0
        self.emit[z] = 0
        self.height[z] = 0
        return self
