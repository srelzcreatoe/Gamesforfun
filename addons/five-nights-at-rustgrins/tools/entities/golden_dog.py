#!/usr/bin/env python3
"""Builds the Golden Dog's source pack (assets/source_models/Golden_Dog_RP) from code: geometry, texture,
the eight animations, in the same layout as the six supplied models. Reference: assets/reference/golden_dog.webp,
description: docs/GOLDEN_DOG.md.

  python3 tools/entities/golden_dog.py          # write the pack (build_entities.py does this when it is stale)

The model keeps the cast's rig (assets/source_models/README.txt) with one more finger per hand:
  root > waist > torso > head > jaw / hat / right_ear / left_ear
  torso > <side>_arm > _forearm > _hand > _finger1..4 > _mid > _tip, _thumb > _tip
  waist > <side>_leg > _shin > _foot,  waist > tail_1 > ... > tail_5
He is 43 model pixels tall with his hat and is drawn at scale 1.3 (tools/entities/build_entities.py):
about 3.5 blocks, where the others stand 3.

Nothing here is random: shapes are boxes placed by hand, the paint is a hash of the position in the model.
"""
import copy
import hashlib
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import modelkit as mk  # noqa: E402
from modelkit import fbm, ihash, vnoise  # noqa: E402

PACK = os.path.join(ROOT, 'assets', 'source_models', 'Golden_Dog_RP')
CID = 'golden_dog'
FINGERS = 4

# ------------------------------------------------------------------ palette
FUR = [(74, 38, 18), (100, 54, 24), (126, 72, 30), (150, 88, 36), (172, 102, 40), (192, 120, 48)]
FUR_WORN = [(52, 26, 16), (68, 32, 18), (86, 40, 22), (104, 50, 26)]
EAR = [(48, 26, 22), (62, 30, 24), (80, 36, 26), (100, 44, 30), (122, 60, 40)]
EAR_GOLD = [(104, 56, 28), (126, 72, 32), (146, 88, 38)]
MUZZLE = [(160, 112, 74), (182, 130, 88), (200, 146, 100), (214, 164, 120)]
PANEL = [(146, 98, 64), (166, 116, 78), (184, 132, 90), (200, 148, 104)]
VEST = [(52, 8, 14), (68, 10, 18), (84, 12, 20), (96, 18, 26), (108, 26, 32)]
LAPEL = [(28, 24, 24), (36, 31, 30), (44, 38, 35), (54, 47, 43)]
BRASS = [(98, 64, 22), (136, 92, 32), (172, 124, 46), (204, 158, 70), (234, 198, 110)]
BLACK = [(16, 15, 17), (24, 22, 25), (34, 31, 35)]
HAT = [(24, 18, 17), (32, 25, 23), (40, 31, 28), (50, 37, 31)]
HAT_WEAR = [(64, 30, 24), (78, 38, 28)]
TOOTH = [(150, 116, 84), (172, 138, 104), (190, 158, 126)]
MOUTH = [(30, 9, 10), (42, 12, 14), (22, 7, 8)]
SOLE = [(40, 24, 18), (52, 30, 20), (32, 20, 16)]

GRAIN = 0.5       # one "voxel" of the paint, in model pixels (the reference picture's grain)


# ------------------------------------------------------------------ materials
def _grain(F, tones, seed, patch=3.0, jitter=0.5, contrast=1.5, grain=GRAIN):
    """Tone index field: smooth patches a few pixels across, chequered by a per-voxel jitter."""
    ix, iy, iz = F.cells(grain)
    cx, cy, cz = (ix + 0.5) * grain, (iy + 0.5) * grain, (iz + 0.5) * grain
    t = fbm(cx, cy, cz, patch, seed)
    t = (t - 0.5) * contrast + 0.5 + (ihash(ix, iy, iz, seed + 5) - 0.5) * jitter
    return np.clip(t, 0, 0.999), (ix, iy, iz), (cx, cy, cz)


def _bevel(F, rgbv, grain=GRAIN, amount=0.075):
    """A voxel's lit top-left and shaded bottom-right texel rows (only where the texels are fine enough)."""
    per = grain * F.dens
    if per < 3.5:
        return rgbv
    P = F.inner()
    n = np.array(F.n)
    axes = [i for i in range(3) if abs(n[i]) < 0.5]
    k = np.ones(F.x.shape)
    for i in axes:
        fr = (P[..., i] / grain) % 1.0
        lo, hi = fr < 1.0 / per + 1e-6, fr > 1.0 - 1.0 / per - 1e-6
        if i == 1:            # y: the top of a voxel catches the light
            k = k + amount * hi - amount * lo
        else:
            k = k + 0.5 * amount * lo - 0.5 * amount * hi
    return rgbv * k[..., None]


def _specks(F, rgbv, seed, dark=0.022, deep=0.6):
    """Tiny pits and stains: single texels darkened."""
    q = np.floor(F.inner() * F.dens + 1e-6).astype(np.int64)
    h = ihash(q[..., 0], q[..., 1], q[..., 2], seed + 91)
    return np.where((h < dark)[..., None], rgbv * deep, rgbv)


def fur(tones=FUR, worn=FUR_WORN, seed=1, patch=3.0, worn_at=0.60, rough=225):
    tones_a, worn_a = np.array(tones, float), np.array(worn, float)

    def mat(F):
        t, (ix, iy, iz), (cx, cy, cz) = _grain(F, tones, seed, patch)
        out = mk.pick(tones_a, t)
        # worn patches: bigger, darker, redder islands with ragged edges
        w = fbm(cx, cy, cz, 5.5, seed + 40) + (ihash(ix, iy, iz, seed + 41) - 0.5) * 0.16
        tw = np.clip(t * 0.9 + (ihash(ix, iy, iz, seed + 42) - 0.5) * 0.3, 0, 0.999)
        out = np.where((w > worn_at)[..., None], mk.pick(worn_a, tw), out)
        out = _specks(F, _bevel(F, out), seed)
        return {'rgb': out, 'rough': rough}
    return mat


def cloth(tones, seed, patch=2.2, rough=235, jitter=0.36, contrast=1.3, edge=None):
    tones_a = np.array(tones, float)

    def mat(F):
        t, _, _ = _grain(F, tones, seed, patch, jitter, contrast)
        out = _specks(F, _bevel(F, mk.pick(tones_a, t), amount=0.05), seed, dark=0.012, deep=0.7)
        return {'rgb': out, 'rough': rough}
    return mat


def glossy(tones=BLACK, centre=None, radius=1.0, seed=3, rough=70, metal=40, light=(-0.35, 0.75, -0.55)):
    """Black ball joints and beads: dark, with a soft highlight towards the light."""
    L = np.array(light, float)
    L /= np.linalg.norm(L)
    base = np.array(tones, float)

    def mat(F):
        t, _, _ = _grain(F, tones, seed, 1.5, 0.5, 1.0)
        out = mk.pick(base, t)
        n = np.array(F.n)
        if centre is not None:
            d = F.P - np.array(centre)
            d = d / np.maximum(np.linalg.norm(d, axis=-1, keepdims=True), 1e-6)
            lit = np.clip(d @ L, 0, 1) * 0.55 + max(0.0, float(n @ L)) * 0.45
        else:
            lit = np.full(F.x.shape, max(0.0, float(n @ L)))
        out = out + 70.0 * lit[..., None] ** 2.2 + 120.0 * (lit[..., None] > 0.9)
        return {'rgb': out, 'rough': rough, 'metal': metal}
    return mat


def metal(tones=BRASS, seed=7, rough=95, metalness=190, light=(-0.35, 0.75, -0.55)):
    L = np.array(light, float)
    L /= np.linalg.norm(L)
    base = np.array(tones, float)

    def mat(F):
        t, (ix, iy, iz), _ = _grain(F, tones, seed, 1.6, 0.45, 1.2, grain=0.25)
        lit = max(0.0, float(np.array(F.n) @ L))
        out = mk.pick(base, np.clip(t * 0.7 + 0.12 + 0.25 * lit, 0, 0.999))
        out = _specks(F, out, seed, dark=0.05, deep=0.55)       # tarnish
        return {'rgb': out, 'rough': rough, 'metal': metalness}
    return mat


def flat(tones, seed=11, rough=215, metal=0, patch=1.5, jitter=0.5, grain=0.25):
    base = np.array(tones, float)

    def mat(F):
        t, _, _ = _grain(F, tones, seed, patch, jitter, 1.0, grain=grain)
        return {'rgb': mk.pick(base, t), 'rough': rough, 'metal': metal}
    return mat


M_FUR = fur()
M_FUR_DARK = fur(tones=FUR[:5], seed=2, worn_at=0.54)
M_EAR_BASE = fur(tones=EAR, worn=EAR[:3], seed=21, patch=2.6, worn_at=0.66)
M_JOINT = glossy()
M_BRASS = metal()
M_TOOTH = flat(TOOTH, seed=31, rough=120, patch=1.0, jitter=0.3)
M_MOUTH = flat(MOUTH, seed=33, rough=200)
M_HATBASE = fur(tones=HAT, worn=HAT_WEAR, seed=51, patch=2.0, worn_at=0.70, rough=230)
M_BOW = cloth(LAPEL, seed=61, patch=1.2, jitter=0.5)
M_LAPEL_BASE = cloth(LAPEL, seed=63, patch=1.6, jitter=0.5)
M_VEST = cloth(VEST, seed=71)
M_PANEL = cloth(PANEL, seed=73, patch=2.6, jitter=0.42, contrast=1.5)
M_MUZZLE_BASE = cloth(MUZZLE, seed=75, patch=2.4, jitter=0.34, contrast=1.4, rough=205)
M_SOLE = flat(SOLE, seed=77, grain=0.5)


def ear_mat(F):
    """The long ears: darker and redder than the body, with rusty gold blotches low down."""
    res = M_EAR_BASE(F)
    t, (ix, iy, iz), (cx, cy, cz) = _grain(F, EAR_GOLD, 23, 2.8)
    g = fbm(cx, cy, cz, 3.4, 24) + (ihash(ix, iy, iz, 25) - 0.5) * 0.2
    low = np.clip((36.5 - cy) / 6.0, 0, 1)                    # the blotches gather towards the tips
    gold = _specks(F, _bevel(F, mk.pick(np.array(EAR_GOLD, float), t)), 23)
    res['rgb'] = np.where((g > 0.72 - 0.26 * low)[..., None], gold, res['rgb'])
    return res


def muzzle_mat(F):
    """Tan muzzle with freckles; the cleft under the nose is a dark line."""
    res = M_MUZZLE_BASE(F)
    out = res['rgb']
    if F.name == 'north':
        q = np.floor(F.P * 2 + 1e-6).astype(np.int64)        # freckles: sparse dark dots
        h = ihash(q[..., 0], q[..., 1], 0, 811)
        fx, fy = (F.x * 2) % 1.0, (F.y * 2) % 1.0
        dot = (h < 0.075) & (fx > 0.25) & (fx < 0.5) & (fy > 0.25) & (fy < 0.5) & (np.abs(F.x) > 0.7)
        out = np.where(dot[..., None], np.array([76.0, 46.0, 30.0]), out)
        cleft = (np.abs(F.x) < 0.14) & (F.y < 34.4)
        out = np.where(cleft[..., None], np.array([92.0, 58.0, 40.0]), out)
    res['rgb'] = out
    return res


def jaw_mat(F):
    """The lower jaw: tan like the muzzle, its top (the inside of the mouth) dark."""
    if F.name == 'up':
        return M_MOUTH(F)
    return M_MUZZLE_BASE(F)


# the eyes: deep black sockets with a small pale pupil each (a pale ring, a dark red iris, a black centre,
# a glint) and two pale specks low in each socket, like the reference
EYE_X, EYE_Y = 2.25, 36.25
SOCKET_BLACK = (9, 7, 8)


def socket_mat(F):
    """The plate at the bottom of the eye sockets. Between and around the sockets it is a dull brown
    (hidden behind the face plates, and it keeps the two sockets apart for the hollow-eye pass)."""
    out = np.zeros(F.x.shape + (3,)) + np.array([58.0, 34.0, 24.0])
    glow = np.zeros(F.x.shape, bool)
    if F.name != 'north':
        return {'rgb': out, 'ao': False}
    for sx in (-1, 1):
        dx, dy = F.x - sx * EYE_X, F.y - EYE_Y
        sock = (np.abs(dx) < 1.72) & (np.abs(dy) < 1.62)
        out[sock] = SOCKET_BLACK
        r = np.sqrt(dx ** 2 + dy ** 2)
        tex = 1.0 / F.dens
        out[sock & (r < 3.2 * tex)] = (232, 222, 200)             # the pale ring
        out[sock & (r < 2.2 * tex)] = (138, 30, 28)               # the iris: dark red
        out[sock & (r < 0.9 * tex)] = (14, 8, 8)                  # the centre
        gl = sock & (np.abs(dx + 1.0 * tex) < 0.6 * tex) & (np.abs(dy - 1.0 * tex) < 0.6 * tex)
        out[gl] = (255, 250, 240)
        glow |= sock & (r < 3.2 * tex)
        # the two pale specks at the bottom of the socket (bare endoskeleton catching the light)
        for ox, w in ((-0.8, 0.25), (0.6, 0.19)):
            sp = sock & (np.abs(dx - sx * ox) < w) & (dy < -1.0) & (dy > -1.38)
            out[sp] = (226, 220, 204)
    return {'rgb': out, 'glow': glow, 'ao': False, 'rough': 240}


# the torso: a maroon tailcoat-vest over the fur, open down the front over a tan belly panel
def panel_half(y):
    """Half width of the tan belly panel at height y."""
    y = np.asarray(y, float)
    top = np.interp(y, [16.2, 17.4, 19.0, 22.0, 26.0, 29.6, 30.6], [0.0, 2.3, 3.2, 3.5, 3.0, 1.9, 1.5])
    return top


def hem_y(x):
    """The vest's lower edge: two points at the front, rising to the sides."""
    ax = np.abs(np.asarray(x, float))
    return np.interp(ax, [0.0, 2.6, 3.4, 5.0, 7.5], [18.4, 18.0, 17.7, 18.7, 19.6])


def torso_mat(F):
    fur_r = M_FUR(F)
    x, y, z = F.x, F.y, F.z
    ax = np.abs(x)
    brass = M_BRASS(F)['rgb']
    side = F.name in ('east', 'west', 'south')
    hem = np.where(z < 0, hem_y(x), 19.6) if side else hem_y(x)
    # the belly panel: the front only, from the bow tie down to the foot of the belly
    ph = panel_half(y)
    panel = (ax < ph) & (y > 16.2) & (z < -2.0)
    if side:
        panel &= False
    vest = (y >= hem) & (y <= 30.05) & ~panel
    out = np.where(vest[..., None], M_VEST(F)['rgb'], fur_r['rgb'])
    rough = np.where(vest, 235.0, 225.0)
    pan = M_PANEL(F)['rgb'] * (0.84 + 0.16 * np.clip((y - 16.5) / 8.0, 0, 1))[..., None]   # darker towards its foot
    out = np.where(panel[..., None], pan, out)
    rough = np.where(panel, 215.0, rough)
    pipe = vest & (y < hem + 0.27)                                 # the hem
    pipe |= vest & (y > 29.78)                                     # the shoulder seam
    if not side:
        pipe |= vest & (ax < ph + 0.27) & (z < -2.0)               # the front edges
    if F.name == 'south':
        out = np.where((vest & (ax < 0.13) & ~pipe)[..., None], np.array(VEST[0], float), out)   # the back seam
    if F.name == 'north':
        for sx in (-1, 1):                                         # pockets: a dark welt under a gold lip
            px = x * sx
            welt = (px > 4.0) & (px < 6.2) & (y > 22.45) & (y < 22.9)
            out = np.where(welt[..., None], np.array(LAPEL[0], float), out)
            pipe |= (px > 3.9) & (px < 6.3) & (y >= 22.9) & (y < 23.15)
    out = np.where(pipe[..., None], brass, out)
    rough = np.where(pipe, 100.0, rough)
    return {'rgb': out, 'rough': rough, 'metal': np.where(pipe, 180.0, 0.0)}


def tails_mat(F):
    """The tailcoat's tails: maroon, piped in gold along the split and the foot."""
    res = M_VEST(F)
    if F.name in ('south', 'north'):
        c = F.cube
        ax = np.abs(F.x)
        x0 = min(abs(c.origin[0]), abs(c.origin[0] + c.size[0]))
        pipe = (ax < x0 + 0.26) | ((F.y < c.origin[1] + 0.26) & (c.tag == 'tail_end'))
        res['rgb'] = np.where(pipe[..., None], M_BRASS(F)['rgb'], res['rgb'])
        res['rough'] = np.where(pipe, 100.0, 235.0)
        res['metal'] = np.where(pipe, 180.0, 0.0)
    return res


def lapel_mat(F):
    """Dark lapels edged with gold piping (the edge that faces the opening and the notch)."""
    res = M_LAPEL_BASE(F)
    if F.name == 'north':
        c = F.cube
        ax = np.abs(F.x)
        x0, x1 = (min(abs(c.origin[0]), abs(c.origin[0] + c.size[0])), max(abs(c.origin[0]), abs(c.origin[0] + c.size[0])))
        pipe = (ax > x1 - 0.26) | ((F.y < c.origin[1] + 0.26) & (c.tag == 'lapel_tip'))
        brass = M_BRASS(F)['rgb']
        res['rgb'] = np.where(pipe[..., None], brass, res['rgb'])
        res['rough'] = np.where(pipe, 100.0, 235.0)
        res['metal'] = np.where(pipe, 180.0, 0.0)
    return res


def badge_mat(F):
    """The brass paw-print badge: a little shield, a dark paw on it."""
    res = M_BRASS(F)
    if F.name == 'north':
        c = F.cube
        u = (F.x - (c.origin[0] + c.size[0] / 2)) * 8        # texels from the middle
        v = (F.y - c.origin[1]) * 8                           # texels from the bottom
        dark = np.zeros(F.x.shape, bool)
        dark |= (np.abs(u) < 2.0) & (v > 2.0) & (v < 5.0)                         # the pad
        for tx, ty in ((-3.0, 6.0), (-1.0, 7.5), (1.0, 7.5), (3.0, 6.0)):        # four toes
            dark |= (np.abs(u - tx) < 1.0) & (np.abs(v - ty) < 1.0)
        rim = (np.abs(u) > c.size[0] * 4 - 1.0) | (v > c.size[1] * 8 - 1.0) | (v < 1.0)
        out = res['rgb']
        out = np.where(dark[..., None], np.array([44.0, 28.0, 14.0]), out)
        out = np.where(rim[..., None], np.array(BRASS[1], float), out)
        res['rgb'] = out
    return res


def hat_mat(F):
    """The top hat: a dark, worn felt; a maroon band at the foot of the crown."""
    res = M_HATBASE(F)
    c = F.cube
    if c.tag == 'band' and F.name not in ('up', 'down'):
        b = M_VEST(F)
        res['rgb'] = b['rgb'] * (0.92 + 0.16 * ((F.y - c.origin[1]) / c.size[1]))[..., None]
    return res


def buckle_mat(F):
    res = M_BRASS(F)
    if F.name == 'north':
        c = F.cube
        u = np.abs(F.x - (c.origin[0] + c.size[0] / 2)) / (c.size[0] / 2)
        v = np.abs(F.y - (c.origin[1] + c.size[1] / 2)) / (c.size[1] / 2)
        hole = (u < 0.45) & (v < 0.42)
        res['rgb'] = np.where(hole[..., None], np.array(VEST[1], float), res['rgb'])
        pin = (u < 0.12) & (v < 0.75)
        res['rgb'] = np.where(pin[..., None], np.array(BRASS[4], float), res['rgb'])
    return res


def tip_mat(F):
    """Dark fingertips: worn black rubber."""
    t, _, _ = _grain(F, BLACK, 81, 1.2, 0.6, 1.0, grain=0.25)
    out = mk.pick(np.array([(26, 22, 22), (36, 31, 30), (48, 41, 38)], float), t)
    return {'rgb': out, 'rough': 150}


def foot_mat(F):
    if F.name == 'down':
        return M_SOLE(F)
    return M_FUR_DARK(F)


# ------------------------------------------------------------------ geometry
def ball(bone, c, r, mat=None, level=2):
    """A stepped ball (a black joint unless told otherwise)."""
    m = mat or glossy(centre=c, radius=r)
    return bone.rounded(c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r, m, r=r * 0.58, level=level)


def build_model():
    m = mk.Model()
    m.bone('root', None, (0, 0, 0))

    # ---- hips
    waist = m.bone('waist', 'root', (0, 17.5, 0))
    waist.rounded(-5.7, 15.3, -3.7, 5.7, 18.7, 3.8, M_FUR_DARK, r=1.1, level=2)
    waist.box(-4.6, 15.9, -1.2, 4.6, 17.3, 1.2, glossy(seed=4))                       # the hip bar, mostly buried

    # ---- torso: chest and a big belly
    torso = m.bone('torso', 'waist', (0, 18.5, 0))
    torso.rounded(-6.0, 23.6, -4.6, 6.0, 30.5, 4.0, torso_mat, r=(1.5, 1.3, 1.2), level=3)      # chest
    torso.rounded(-6.9, 16.5, -5.7, 6.9, 26.6, 4.5, torso_mat, r=(1.9, 1.9, 1.9), level=3)      # belly
    torso.box(-1.5, 30.2, -1.5, 1.5, 32.4, 1.5, glossy(seed=5))                                  # the neck
    torso.box(-2.1, 30.4, -2.0, 2.1, 31.0, 2.0, glossy(seed=6))                                  # its collar ring
    # the coat's two tails behind, split for the tail
    for sx in (-1, 1):
        torso.box(sx * 0.35, 15.6, 4.2, sx * 4.6, 19.9, 5.0, tails_mat)
        torso.box(sx * 0.6, 13.6, 4.3, sx * 3.9, 15.6, 4.95, tails_mat)
        torso.box(sx * 1.0, 12.4, 4.35, sx * 3.0, 13.6, 4.9, tails_mat, tag='tail_end')
    # lapels (his right: -x), stepped down the chest and onto the belly
    for sx in (-1, 1):
        def lap(x0, x1, y0, y1, z0, z1, tag='lapel'):
            torso.box(sx * x0, y0, z0, sx * x1, y1, z1, lapel_mat, tag=tag)
        lap(1.3, 4.3, 28.9, 30.2, -5.05, -4.2)
        lap(1.6, 5.2, 27.4, 28.9, -5.05, -4.5)
        lap(2.0, 5.6, 26.3, 27.4, -5.05, -4.5, 'lapel_tip')
        lap(2.4, 4.6, 25.2, 26.3, -5.5, -4.5)
        lap(2.8, 3.9, 24.2, 25.2, -6.0, -5.0, 'lapel_tip')
    # the bow tie under the chin
    for sx in (-1, 1):
        torso.rounded(sx * 0.45, 28.75, -5.75, sx * 2.9, 30.45, -4.7, M_BOW, r=(0.3, 0.45, 0.3), level=1)
        torso.box(sx * 0.9, 29.1, -5.9, sx * 2.5, 30.1, -5.7, M_BOW)
    torso.rounded(-0.65, 29.0, -6.05, 0.65, 30.2, -4.7, M_BOW, r=0.25, level=1)
    # the brass paw badge and the two buttons on the belly panel
    torso.box(-0.75, 26.6, -5.02, 0.75, 28.2, -4.6, badge_mat)
    torso.box(-0.5, 26.3, -4.98, 0.5, 26.6, -4.6, M_BRASS)
    for by in (24.3, 22.0):
        c = (0.0, by, -5.75)
        torso.rounded(-0.62, by - 0.62, -6.25, 0.62, by + 0.62, -5.4, glossy(centre=c), r=0.3, level=1)

    # the watch chain: brass links sagging from the left pocket (his left: +x) to the edge of the panel
    for k in range(7):
        cx, cy = 3.25 + 0.34 * k, 22.75 - 1.25 * math.sin(math.pi * k / 6) ** 0.8
        w, h = (0.44, 0.24) if k % 2 == 0 else (0.24, 0.44)
        torso.box(cx - w / 2, cy - h / 2, -6.0, cx + w / 2, cy + h / 2, -5.66, M_BRASS, share=f'link{k % 2}')
    torso.box(5.2, 22.3, -5.98, 5.75, 22.85, -5.66, M_BRASS, share='fob')

    # ---- head
    head = m.bone('head', 'torso', (0, 31.5, 0))
    head.rounded(-5.0, 32.6, -4.6, 5.0, 40.9, 4.2, M_FUR, r=(2.6, 2.4, 2.1), level=3)           # cranium
    for sx in (-1, 1):                                                                             # cheeks
        head.rounded(sx * 2.8, 32.7, -4.5, sx * 5.75, 36.7, 2.6, M_FUR, r=0.9, level=2)
    # the face around the eye sockets: the sockets are real hollows, a pixel deep, with stepped corners
    head.box(-4.0, 34.5, -4.72, 4.0, 38.0, -4.3, socket_mat)                                      # the bottom of the sockets
    head.rounded(-3.1, 37.8, -5.65, 3.1, 39.5, -3.2, M_FUR, r=(0.5, 0.45, 0.3), level=1, flat=('z+', 'y-'))   # brow
    head.box(-3.4, 39.4, -5.1, 3.4, 40.4, -3.0, M_FUR)                                            # forehead step
    head.box(-0.7, 34.7, -5.65, 0.7, 37.8, -3.2, M_FUR)                                           # the bridge
    for sx in (-1, 1):
        head.box(sx * 3.0, 37.8, -5.25, sx * 4.5, 39.2, -3.2, M_FUR)                              # brow, outer part
        head.box(sx * 3.9, 34.5, -5.15, sx * 4.8, 37.8, -3.2, M_FUR)                              # outer rim
        head.box(sx * 0.7, 33.8, -5.55, sx * 4.6, 34.7, -3.2, M_FUR)                              # under the eye
        for cx, cy in ((0.7, 37.8), (3.9, 37.8), (0.7, 34.7), (3.9, 34.7)):                       # stepped socket corners
            dx = 0.75 if cx < 2 else -0.75
            dy = -0.75 if cy > 36 else 0.75
            head.box(sx * cx, cy, -5.1 if cx > 2 else -5.5, sx * (cx + dx), cy + dy, -4.5, M_FUR, share='sockcorner')
    # the muzzle: two tan lobes and the piece between them
    for sx in (-1, 1):
        head.rounded(sx * 0.1, 32.9, -7.3, sx * 4.65, 35.5, -4.3, muzzle_mat, r=(1.2, 1.0, 1.1), level=3, flat=('z+',))
    head.box(-0.6, 33.2, -6.8, 0.6, 35.1, -4.4, muzzle_mat)
    # the nose
    nose = glossy(centre=(0, 35.3, -7.1), rough=60)
    head.rounded(-1.3, 34.6, -7.85, 1.3, 35.8, -6.7, nose, r=0.34, level=1)
    head.box(-0.5, 34.1, -7.6, 0.5, 34.6, -6.8, nose)
    # the roof and the back of the mouth, and the upper teeth (seen when the jaw drops)
    head.box(-3.9, 32.8, -6.75, 3.9, 33.25, -1.0, M_MOUTH)
    head.box(-3.9, 30.7, -2.0, 3.9, 32.85, -1.6, M_MOUTH)
    for k in range(6):
        x0 = -3.45 + k * 1.18
        head.box(x0, 32.2, -5.95, x0 + 1.0, 32.85, -5.45, M_TOOTH, share='utooth')
    # thin black rods with beads at the corners of the mouth
    rod = glossy(seed=8, rough=90)
    for sx in (-1, 1):
        head.box(sx * 3.3, 33.0, -7.56, sx * 3.55, 35.6, -7.3, rod)
        for by in (35.5, 34.3, 33.1):
            head.box(sx * 3.18, by - 0.25, -7.72, sx * 3.67, by + 0.25, -7.26, rod, share='bead')
        head.box(sx * 4.2, 33.3, -6.7, sx * 4.45, 35.3, -6.45, rod)
        head.box(sx * 4.08, 34.1, -6.85, sx * 4.57, 34.6, -6.4, rod, share='bead')

    # ---- jaw
    jaw = m.bone('jaw', 'head', (0, 33.0, 1.5))
    jaw.rounded(-4.3, 30.5, -6.85, 4.3, 32.0, -0.9, jaw_mat, r=(0.9, 0.7, 0.9), level=2, flat=('y+',))
    for k in range(4):
        x0 = -3.2 + k * 1.72
        jaw.box(x0, 32.0, -6.6, x0 + 1.24, 32.84, -6.1, M_TOOTH, share='ltooth')
    jaw.box(-3.5, 32.0, -6.1, 3.5, 32.8, -5.9, M_MOUTH)                               # the dark behind the lower teeth

    # ---- hat
    hat = m.bone('hat', 'head', (0, 40.5, 0))
    hat.rounded(-3.2, 40.5, -3.45, 3.2, 41.2, 2.95, hat_mat, r=(0.6, 0.0, 0.6), level=1)
    hat.box(-2.2, 41.2, -2.45, 2.2, 43.6, 1.95, hat_mat)
    hat.box(-2.4, 41.2, -2.65, 2.4, 42.15, 2.15, hat_mat, tag='band')
    hat.rounded(-2.45, 43.5, -2.7, 2.45, 44.0, 2.2, hat_mat, r=(0.3, 0.0, 0.3), level=1)
    hat.box(-0.65, 41.26, -2.9, 0.65, 42.1, -2.65, buckle_mat)

    # ---- ears: long, hanging, splayed out by the bone's rest rotation
    ear = m.bone('right_ear', 'head', (-4.5, 39.4, 0.2), (0, 0, 21))
    ball(ear, (-4.6, 39.4, 0.2), 0.95)
    ear.rounded(-6.6, 38.0, -0.85, -4.2, 39.6, 1.25, ear_mat, r=(0.5, 0.4, 0.4), level=1)
    ear.rounded(-7.7, 33.8, -0.95, -3.7, 38.3, 1.35, ear_mat, r=(0.6, 0.5, 0.5), level=2)
    ear.rounded(-8.3, 29.6, -1.0, -3.4, 34.2, 1.4, ear_mat, r=(0.7, 0.5, 0.5), level=2)
    ear.rounded(-7.9, 28.0, -0.9, -3.9, 30.0, 1.3, ear_mat, r=(0.8, 0.6, 0.5), level=2)
    ear.rounded(-7.1, 27.2, -0.75, -4.7, 28.3, 1.15, ear_mat, r=(0.5, 0.4, 0.4), level=1)
    m.mirror('right_ear', 'left_ear', 'head')

    # ---- arms
    arm = m.bone('right_arm', 'torso', (-6.6, 29.2, 0), (0, 0, 7))
    ball(arm, (-6.6, 29.2, 0), 1.45)
    arm.rounded(-10.5, 24.5, -2.6, -5.8, 30.0, 2.6, M_FUR, r=(1.3, 1.5, 1.3), level=3)
    arm.box(-8.9, 23.6, -0.85, -7.3, 24.6, 0.85, glossy(seed=9))                      # the piston into the elbow
    fore = m.bone('right_forearm', 'right_arm', (-8.1, 23.7, 0))
    ball(fore, (-8.1, 23.7, 0), 1.15)
    fore.box(-9.05, 22.9, -1.0, -7.15, 23.25, 1.0, glossy(seed=10))                   # ring
    fore.rounded(-10.65, 18.9, -2.7, -5.55, 23.0, 2.7, M_FUR, r=(1.3, 1.2, 1.3), level=3)
    fore.box(-8.85, 18.2, -0.8, -7.35, 19.0, 0.8, glossy(seed=11))                    # the wrist stub
    hand = m.bone('right_hand', 'right_forearm', (-8.1, 18.1, 0), (0, -90, 0))
    hand.rounded(-9.45, 17.45, -1.35, -6.75, 18.2, 1.35, M_BRASS, r=(0.3, 0.0, 0.3), level=1)      # the brass cuff
    hand.rounded(-9.05, 14.85, -2.45, -7.15, 17.5, 2.45, M_FUR, r=(0.4, 0.5, 0.6), level=2)       # the palm
    for rz in (-0.55, 0.55):                                                                      # two rods down the back of the hand
        hand.box(-9.27, 16.0, rz - 0.13, -9.03, 17.5, rz + 0.13, glossy(seed=12), share='handrod')
    zs = [-1.8, -0.6, 0.6, 1.8]
    for n, zc in enumerate(zs, 1):
        f = m.bone(f'right_finger{n}', 'right_hand', (-8.1, 14.8, zc))
        f.box(-8.52, 14.4, zc - 0.42, -7.68, 15.2, zc + 0.42, glossy(seed=13), share='bead1')
        f.box(-8.63, 13.3, zc - 0.53, -7.57, 14.42, zc + 0.53, M_FUR, share=f'fseg1_{n}')
        f = m.bone(f'right_finger{n}_mid', f'right_finger{n}', (-8.1, 13.15, zc))
        f.box(-8.49, 12.78, zc - 0.39, -7.71, 13.52, zc + 0.39, glossy(seed=14), share='bead2')
        f.box(-8.61, 11.8, zc - 0.51, -7.59, 12.82, zc + 0.51, M_FUR, share=f'fseg2_{n}')
        f = m.bone(f'right_finger{n}_tip', f'right_finger{n}_mid', (-8.1, 11.65, zc))
        f.box(-8.47, 11.3, zc - 0.37, -7.73, 12.0, zc + 0.37, glossy(seed=15), share='bead3')
        f.box(-8.6, 10.45, zc - 0.5, -7.6, 11.34, zc + 0.5, tip_mat, share='ftip')
        f.box(-8.45, 10.15, zc - 0.36, -7.75, 10.45, zc + 0.36, tip_mat, share='ftip2')
    th = m.bone('right_thumb', 'right_hand', (-7.95, 16.7, -2.55), (-28, 0, 0))
    th.box(-8.37, 16.3, -2.97, -7.53, 17.1, -2.13, glossy(seed=16), share='bead1')
    th.box(-8.5, 15.1, -3.1, -7.4, 16.32, -2.0, M_FUR, share='tseg')
    th = m.bone('right_thumb_tip', 'right_thumb', (-7.95, 14.95, -2.55), (10, 0, 0))
    th.box(-8.34, 14.58, -2.94, -7.56, 15.32, -2.16, glossy(seed=17), share='bead2')
    th.box(-8.47, 13.55, -3.07, -7.43, 14.62, -2.03, tip_mat, share='ttip')
    th.box(-8.31, 13.25, -2.91, -7.59, 13.55, -2.19, tip_mat, share='ttip2')

    # ---- legs
    leg = m.bone('right_leg', 'waist', (-3.5, 16.9, 0))
    leg.rounded(-6.55, 11.7, -3.05, -0.55, 17.3, 3.05, M_FUR, r=(1.3, 1.3, 1.3), level=3)
    leg.box(-4.4, 10.9, -0.9, -2.6, 11.8, 0.9, glossy(seed=18))
    shin = m.bone('right_shin', 'right_leg', (-3.5, 11.0, 0))
    ball(shin, (-3.5, 11.0, 0), 1.2)
    shin.rounded(-6.5, 9.2, -3.1, -0.5, 10.4, 3.15, M_FUR_DARK, r=(0.7, 0.35, 0.7), level=1)     # the ring under the knee
    shin.rounded(-6.75, 4.5, -3.2, -0.25, 9.5, 3.3, M_FUR, r=(1.3, 1.1, 1.3), level=3)
    shin.box(-4.3, 3.7, -0.85, -2.7, 4.6, 0.85, glossy(seed=19))
    foot = m.bone('right_foot', 'right_shin', (-3.5, 3.9, 0))
    ball(foot, (-3.5, 3.9, 0), 1.0)
    foot.rounded(-6.95, 0.0, -4.3, -0.25, 3.5, 3.6, foot_mat, r=(1.1, 1.2, 1.3), level=2, flat=('y-',))
    for tx in (-5.8, -3.6, -1.4):
        foot.rounded(tx - 1.06, 0.0, -7.6, tx + 1.06, 2.7, -3.7, foot_mat, r=(0.55, 0.8, 0.8), level=2, flat=('y-', 'z+'))

    for src in ('right_arm', 'right_forearm', 'right_hand', 'right_thumb', 'right_thumb_tip', 'right_leg', 'right_shin', 'right_foot'):
        m.mirror(src, src.replace('right', 'left'))
    for n in range(1, FINGERS + 1):
        for seg in ('', '_mid', '_tip'):
            m.mirror(f'right_finger{n}{seg}', f'left_finger{n}{seg}')

    # ---- tail: hangs behind, swings out to his right and curls up
    t1 = m.bone('tail_1', 'waist', (-1.2, 16.0, 3.4), (40, 0, 52))
    t1.rounded(-2.5, 13.0, 2.1, 0.1, 16.6, 4.7, M_FUR, r=0.6, level=2)
    t2 = m.bone('tail_2', 'tail_1', (-1.2, 13.3, 3.4), (-12, 0, 26))
    t2.rounded(-2.4, 10.4, 2.2, 0.0, 13.7, 4.6, M_FUR, r=0.6, level=2)
    t3 = m.bone('tail_3', 'tail_2', (-1.2, 10.7, 3.4), (-10, 0, 30))
    t3.rounded(-2.25, 8.1, 2.35, -0.15, 11.1, 4.45, M_FUR, r=0.55, level=2)
    t4 = m.bone('tail_4', 'tail_3', (-1.2, 8.4, 3.4), (-8, 0, 42))
    t4.rounded(-2.1, 6.1, 2.5, -0.3, 8.8, 4.3, M_FUR_DARK, r=0.5, level=2)
    t5 = m.bone('tail_5', 'tail_4', (-1.2, 6.4, 3.4), (0, 0, 46))
    t5.rounded(-1.95, 4.4, 2.65, -0.45, 6.8, 4.15, M_FUR_DARK, r=0.5, level=2)
    return m


# ------------------------------------------------------------------ write the pack
def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')


def source_hash():
    h = hashlib.sha1()
    for f in ('golden_dog.py', 'golden_dog_anims.py', 'modelkit.py', 'fk.py', 'rig.py'):
        p = os.path.join(HERE, f)
        if os.path.exists(p):
            with open(p, 'rb') as fh:
                h.update(fh.read())
    return h.hexdigest()


ANIMS = ('idle', 'perform_1', 'perform_2', 'walk', 'run', 'jumpscare', 'pose_1', 'pose_2')


def client_entity():
    anims = {a: f'animation.{CID}.{a}' for a in ANIMS}
    anims['move_controller'] = f'controller.animation.{CID}.move'
    return {'format_version': '1.10.0', 'minecraft:client_entity': {'description': {
        'identifier': f'fnaf:{CID}', 'materials': {'default': 'entity_alphatest'}, 'textures': {'default': f'textures/entity/{CID}'},
        'geometry': {'default': f'geometry.{CID}'}, 'animations': anims, 'scripts': {'animate': ['move_controller']},
        'render_controllers': ['controller.render.default'], 'enable_attachables': False}}}


def move_controller():
    st = lambda anim, trans: {'animations': [anim], 'blend_transition': 0.2, 'transitions': trans}
    return {'format_version': '1.10.0', 'animation_controllers': {f'controller.animation.{CID}.move': {'initial_state': 'idle', 'states': {
        'idle': st('idle', [{'walk': 'query.modified_move_speed > 0.05'}]),
        'walk': st('walk', [{'idle': 'query.modified_move_speed <= 0.05'}, {'run': 'query.modified_move_speed > 0.7'}]),
        'run': st('run', [{'walk': 'query.modified_move_speed <= 0.7'}]),
    }}}}


MANIFEST = {
    'format_version': 2,
    'header': {'name': 'FNAF Animatronics - The Golden Dog', 'description': 'Model, texture and animations (generated by tools/entities/golden_dog.py)',
               'uuid': '5b0c1d0e-6a53-4e0f-9d5b-3c1f2a7e9b41', 'version': [1, 0, 0], 'min_engine_version': [1, 20, 0]},
    'modules': [{'type': 'resources', 'uuid': '0f6c2d8a-41b7-4c59-8e1a-6d2b9f3c7a15', 'version': [1, 0, 0]}],
}
STAMP = 'generated.json'


def generate(pack=PACK, log=print):
    """Writes the whole source pack. Returns (model, geometry)."""
    import golden_dog_anims
    from PIL import Image
    stamp = source_hash()               # (taken first: an edit made while this runs leaves the pack stale)
    m = build_model()
    height, layers, used = mk.build(m, 512)
    geo = mk.to_geometry(m, f'geometry.{CID}', 512, height)
    n = len(m.cubes())
    log(f'{CID}: {len(m.bones)} bones, {n} cubes, texture 512 x {height} ({used} rows used)')
    write_json(os.path.join(pack, 'models', 'entity', f'{CID}.geo.json'), geo)
    tex = os.path.join(pack, 'textures', 'entity')
    os.makedirs(tex, exist_ok=True)
    layers['color'].save(os.path.join(tex, f'{CID}.png'))
    layers['mer'].save(os.path.join(tex, f'{CID}_mer.png'))
    Image.fromarray((layers['glow'] * 255).astype(np.uint8), 'L').save(os.path.join(tex, f'{CID}_pupils.png'))
    write_json(os.path.join(pack, 'animations', f'{CID}.animation.json'), golden_dog_anims.build_all(geo, CID))
    write_json(os.path.join(pack, 'entity', f'{CID}.entity.json'), client_entity())
    write_json(os.path.join(pack, 'animation_controllers', f'{CID}.ac.json'), move_controller())
    write_json(os.path.join(pack, 'manifest.json'), MANIFEST)
    write_json(os.path.join(pack, STAMP), {'generator': 'tools/entities/golden_dog.py', 'sources': stamp, 'cubes': n})
    return m, geo


def ensure(pack=PACK, log=print):
    """Regenerates the source pack when the generator has changed since it was written."""
    try:
        with open(os.path.join(pack, STAMP)) as f:
            if json.load(f).get('sources') == source_hash():
                return False
    except (OSError, ValueError):
        pass
    generate(pack, log)
    return True


def anims_only(pack=PACK):
    """Rewrites only the animations (for working on them: the stamp is left stale, so the next build writes
    the whole pack again)."""
    import golden_dog_anims
    with open(os.path.join(pack, 'models', 'entity', f'{CID}.geo.json')) as f:
        geo = json.load(f)
    write_json(os.path.join(pack, 'animations', f'{CID}.animation.json'), golden_dog_anims.build_all(geo, CID))


if __name__ == '__main__':
    anims_only() if '--anims' in sys.argv else generate()
