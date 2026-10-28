"""Turn the transparent animatronic portrait renders (assets/portraits/*.png)
into crisp low-res pixel art: area downscale -> re-palette to a small curated
per-character palette (nearest colour in CIE Lab) -> despeckle -> outline.
Hand touch-ups (eyes, props) are applied by the caller with `poke`.
"""
import os

import numpy as np
from PIL import Image

from pixlib import PORTRAITS, hexc


def srgb_to_lab(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


# Curated palettes (dark -> light per material). Sampled by eye from the renders.
PALETTES = {
    'rustgrin': ['#2a2826', '#3f3d3a', '#55524e', '#6c6863', '#87827b', '#a39d93', '#c8c0b0', '#e0d8c8',
                 '#4e0f12', '#7a171b', '#a3232a', '#141113'],
    'mirehop': ['#1d2414', '#2c3a1c', '#3f5326', '#566c31', '#71863f', '#8f9a56', '#b9a77a', '#d6c59a',
                '#5c1214', '#9c2023', '#141113'],
    'noxbriar': ['#121114', '#1d1b1f', '#29262b', '#363238', '#4a4048', '#8f7d63', '#b6a183', '#4b2c66',
                 '#6c4790', '#141113'],
    'cat': ['#1e1418', '#2e1e24', '#3f2930', '#52363d', '#5e2a28', '#7b3a33', '#c49a8a', '#e2c0b0',
            '#d78a8a', '#d9cfc2', '#141113'],
    'top_hat_rat': ['#1f1a20', '#2d262e', '#3d343e', '#4f4550', '#9a8f93', '#c2b9b8', '#e0dbd5', '#d78a90',
                    '#6a1418', '#9b1f24', '#c8a13a', '#141113'],
    'purple_rat': ['#2a1c2a', '#3b2739', '#4e344b', '#63435d', '#7d5a76', '#a68fa6', '#cbb8cb', '#e6dbe4',
                   '#8e1a1e', '#c42a24', '#141113'],
}


def load(name):
    return Image.open(os.path.join(PORTRAITS, name + '.png')).convert('RGBA')


def pixelize(name, crop, size, palette, alpha_cut=0.5, contrast=1.15, bright=1.0, despeckle=True):
    """crop: (x0,y0,x1,y1) in the 512-px render; size: (w,h) output.
    Returns (rgb float (h,w,3), alpha bool (h,w), index map (h,w))."""
    im = load(name).crop(crop)
    a = np.array(im).astype(np.float64)
    # premultiplied area downscale so transparent pixels don't darken edges
    pm = a.copy()
    pm[..., :3] *= a[..., 3:4] / 255.0
    small = np.array(Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8)).resize(size, Image.BOX)).astype(np.float64)
    al = small[..., 3] / 255.0
    rgb = np.where(al[..., None] > 0, small[..., :3] / np.maximum(al[..., None], 1e-6), 0)
    # mild contrast / brightness push (renders are soft)
    mean = 110.0
    rgb = np.clip((rgb - mean) * contrast + mean * bright, 0, 255)
    pal = np.stack([hexc(h) for h in palette])
    lab = srgb_to_lab(rgb)
    plab = srgb_to_lab(pal)
    d = ((lab[:, :, None, :] - plab[None, None, :, :]) ** 2)
    d[..., 0] *= 0.8  # weight hue/chroma a bit more than lightness
    idx = np.argmin(d.sum(-1), -1)
    mask = al >= alpha_cut
    if despeckle:
        idx = _despeckle(idx, mask)
    return pal[idx].astype(np.float64), mask, idx


def _despeckle(idx, mask):
    h, w = idx.shape
    out = idx.copy()
    for y in range(h):
        for x in range(w):
            if not mask[y, x]:
                continue
            nb = []
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and mask[yy, xx]:
                    nb.append(idx[yy, xx])
            if len(nb) >= 3 and idx[y, x] not in nb:
                vals, cnt = np.unique(nb, return_counts=True)
                if cnt.max() >= 2:
                    out[y, x] = vals[np.argmax(cnt)]
    return out


def outline(mask, diag=False):
    """Pixels outside `mask` that touch it (4- or 8-neighbourhood)."""
    m = mask.copy()
    h, w = m.shape
    o = np.zeros_like(m)
    nbs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    if diag:
        nbs += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    for dx, dy in nbs:
        sh = np.zeros_like(m)
        ys = slice(max(dy, 0), h + min(dy, 0))
        yd = slice(max(-dy, 0), h + min(-dy, 0))
        xs = slice(max(dx, 0), w + min(dx, 0))
        xd = slice(max(-dx, 0), w + min(-dx, 0))
        sh[yd, xd] = m[ys, xs]
        o |= sh
    return o & ~m


def poke(rgb, mask, pts, color):
    c = hexc(color) if isinstance(color, str) else color
    for (x, y) in pts:
        if 0 <= y < rgb.shape[0] and 0 <= x < rgb.shape[1]:
            rgb[y, x] = c
            mask[y, x] = True


def sprite(name, crop, size, char, **kw):
    rgb, mask, idx = pixelize(name, crop, size, PALETTES[char], **kw)
    return {'rgb': rgb, 'mask': mask}


def paste(dst_rgb, dst_a, spr, x0, y0, outline_color=None, emit=None):
    """Composite a sprite dict onto a canvas (float rgb + bool/uint8 alpha)."""
    rgb, mask = spr['rgb'], spr['mask']
    h, w = mask.shape
    H, W = dst_rgb.shape[:2]
    if outline_color is not None:
        big = np.zeros((h + 2, w + 2), bool)
        big[1:-1, 1:-1] = mask
        ol = outline(big)
        oc = hexc(outline_color)
        for y, x in zip(*np.nonzero(ol)):
            yy, xx = y0 + y - 1, x0 + x - 1
            if 0 <= yy < H and 0 <= xx < W:
                dst_rgb[yy, xx] = oc
                if dst_a is not None:
                    dst_a[yy, xx] = 255
    for y, x in zip(*np.nonzero(mask)):
        yy, xx = y0 + y, x0 + x
        if 0 <= yy < H and 0 <= xx < W:
            dst_rgb[yy, xx] = rgb[y, x]
            if dst_a is not None:
                dst_a[yy, xx] = 255
