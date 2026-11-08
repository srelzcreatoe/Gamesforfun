#!/usr/bin/env python3
"""
The Shaftbreaker -- procedural geometry + HD texture builder (Minecraft Bedrock Edition).

    python3 tools/build_model.py            # regenerate both files from scratch
    python3 tools/build_model.py --stats    # also print per-bone cube counts / checks

Writes (see SPEC.md sections 2-5 for every convention used here):
    Shaftbreaker_RP/models/entity/shaftbreaker.geo.json   format 1.12.0, geometry.shaftbreaker,
                                                          per-face UVs, locators, visible bounds
    Shaftbreaker_RP/textures/entity/shaftbreaker.png      RGBA, 4x the declared texture size (HD),
                                                          alpha = glow mask for entity_emissive_alpha

Coordinates are Bedrock FILE coordinates: +Y up, ground y = 0, the creature faces -Z, its RIGHT side
is -X.  All cube origins / sizes / pivots are on the 0.25 grid (= one real texel), so every face maps
to whole texels.  Everything is seeded and deterministic.

Layout of this file:
    1. data model + math (rotations, snapping)
    2. modelling helpers: box(), stack(), plates(), spike(), finger(), mirroring
    3. the creature: torso, head + jaw, mane, arms + hands, legs + feet
    4. checks: grid, z-fighting (coplanar overlapping faces), hidden-face culling
    5. UV packing
    6. texture painting (bricks, mortar, bevel, cracks, dust, soot, AO, glow)
    7. output
"""
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO_PATH = os.path.join(ROOT, 'Shaftbreaker_RP', 'models', 'entity', 'shaftbreaker.geo.json')
TEX_PATH = os.path.join(ROOT, 'Shaftbreaker_RP', 'textures', 'entity', 'shaftbreaker.png')

TPU = 4          # real texels per model unit (PNG = 4x the declared texture size)
GRID = 0.25      # model grid = one real texel
PAD = 1          # padding (real texels) around every face rect
MAX_PNG = 2048

# =====================================================================================
# 1. data model + math
# =====================================================================================


def q(v):
    """snap to the 0.25 grid (exact binary fractions, so float equality is safe)"""
    return round(v * 4) / 4


def qv(v):
    return tuple(q(a) for a in v)


def rot_matrix(r):
    """Bedrock file-space rotation (degrees): R = Rz(-rz) . Ry(ry) . Rx(-rx)
    (verified numerically against tools/lib/model.js)."""
    rx, ry, rz = (math.radians(a) for a in r)

    def Rx(a):
        c, s = math.cos(a), math.sin(a)
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

    def Ry(a):
        c, s = math.cos(a), math.sin(a)
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

    def Rz(a):
        c, s = math.cos(a), math.sin(a)
        return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

    return Rz(-rz) @ Ry(ry) @ Rx(-rx)


def dir_to_rot(d, twist=0.0):
    """Euler (rx, ry, rz) that turns local +Y into direction d (ry = twist about the spike)."""
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    lim = math.degrees(math.acos(min(0.9999, abs(d[2])))) * 0.9     # |d_z| must stay <= cos(twist)
    ry = math.radians(max(-lim, min(lim, twist)))
    s = max(-1.0, min(1.0, -d[2] / math.cos(ry)))
    rx = math.asin(s)
    x, y = -math.sin(rx) * math.sin(ry), math.cos(rx)
    rz = math.atan2(d[0], d[1]) - math.atan2(x, y)
    r = (round(math.degrees(rx), 1), round(math.degrees(ry), 1), round(math.degrees(rz), 1))
    r = tuple(((a + 180) % 360) - 180 for a in r)
    chk = rot_matrix(r) @ np.array([0, 1, 0])
    assert np.dot(chk, d) > 0.999, (d, r, chk)
    return r


class Cube:
    __slots__ = ('bone', 'lo', 'hi', 'tag', 'rot', 'pivot', 'seed', 'paint', 'faces', 'uv', 'idx', 'wlo', 'whi')

    def __init__(self, bone, lo, hi, tag, rot, pivot, paint):
        self.bone = bone
        self.lo = qv(lo)
        self.hi = qv(hi)
        for a in range(3):
            assert self.hi[a] - self.lo[a] >= GRID - 1e-9, ('degenerate cube', bone, lo, hi)
        self.tag = tag
        self.rot = tuple(rot) if rot and any(abs(a) > 1e-9 for a in rot) else None
        self.pivot = qv(pivot) if (self.rot and pivot is not None) else None
        if self.rot and self.pivot is None:
            self.pivot = qv([(self.lo[a] + self.hi[a]) / 2 for a in range(3)])
        self.paint = dict(paint)
        self.seed = 0
        self.faces = None
        self.uv = {}
        self.idx = -1

    @property
    def size(self):
        return tuple(q(self.hi[a] - self.lo[a]) for a in range(3))

    def frame(self):
        return (self.rot, self.pivot) if self.rot else None

    def matrix(self):
        return rot_matrix(self.rot) if self.rot else np.eye(3)

    def to_world(self, p):
        """rest-pose model-space position of a cube-local (unrotated file) point / array of points"""
        p = np.asarray(p, float)
        if not self.rot:
            return p
        piv = np.array(self.pivot)
        return (p - piv) @ self.matrix().T + piv


class Bone:
    def __init__(self, name, parent, pivot):
        self.name = name
        self.parent = parent
        self.pivot = qv(pivot)
        self.cubes = []
        self.locators = {}


BONES = {}


def bone(name, parent, pivot):
    assert name not in BONES, name
    if parent:
        assert parent in BONES, (name, parent)
    b = Bone(name, parent, pivot)
    BONES[name] = b
    return b


def box(b, x0, x1, y0, y1, z0, z1, tag='stone', rot=None, pivot=None, **paint):
    """axis-aligned cube by extents (optionally rotated about `pivot`)"""
    bb = BONES[b] if isinstance(b, str) else b
    c = Cube(bb.name, (min(x0, x1), min(y0, y1), min(z0, z1)), (max(x0, x1), max(y0, y1), max(z0, z1)),
             tag, rot, pivot, paint)
    bb.cubes.append(c)
    return c


def cube(b, origin, size, tag='stone', **kw):
    """Bedrock-style cube: origin (lowest corner) + size, semantic tag drives the texture painter
    (stone / plate / band / spike / claw / eye / tooth / mouth / mouthwall / face / cranium);
    paint params: soot=('y', y_start, y_full, amount) | ('const', amount), tone, grid, brick, dark_faces ..."""
    return box(b, origin[0], origin[0] + size[0], origin[1], origin[1] + size[1], origin[2], origin[2] + size[2],
               tag=tag, **kw)


def cbox(b, cx, cy, cz, sx, sy, sz, **kw):
    """box by centre + size (origin snapped to the grid)"""
    x0, y0, z0 = q(cx - sx / 2), q(cy - sy / 2), q(cz - sz / 2)
    return box(b, x0, x0 + sx, y0, y0 + sy, z0, z0 + sz, **kw)


class Rng:
    """tiny deterministic RNG wrapper (numpy PCG64)"""

    def __init__(self, seed):
        self.g = np.random.default_rng(seed)

    def u(self, a=0.0, b=1.0):
        return float(self.g.uniform(a, b))

    def i(self, a, b):  # inclusive
        return int(self.g.integers(a, b + 1))

    def pick(self, seq):
        return seq[int(self.g.integers(0, len(seq)))]

    def chance(self, p):
        return self.g.uniform() < p


# =====================================================================================
# 2. modelling helpers
# =====================================================================================

FACE_AXIS = {'north': (2, -1), 'south': (2, 1), 'east': (0, -1), 'west': (0, 1), 'up': (1, 1), 'down': (1, -1)}
FACES = ('north', 'south', 'east', 'west', 'up', 'down')
SIDE_FACES = ('north', 'south', 'east', 'west')


def stack(b, cx, cz, segs, jitter, rng, tag='stone', plates_per=2, plate_faces=SIDE_FACES, plate_size=(1.0, 2.25),
          proud=(0.25, 0.5), **paint):
    """A limb built from stacked, slightly offset stone blocks (top -> bottom).
    segs: list of (y_top, y_bottom, width_x, depth_z[, dx, dz])"""
    out = []
    for s in segs:
        yt, yb, w, d = s[:4]
        dx = s[4] if len(s) > 4 else q(rng.u(-jitter, jitter))
        dz = s[5] if len(s) > 5 else q(rng.u(-jitter, jitter))
        c = cbox(b, cx + dx, (yt + yb) / 2, cz + dz, w, yt - yb, d, tag=tag, **paint)
        # cbox snaps the origin; keep exact y range
        c.lo = (c.lo[0], q(yb), c.lo[2])
        c.hi = (c.hi[0], q(yt), c.hi[2])
        out.append(c)
        if plates_per:
            plates(b, c, plates_per, rng, faces=plate_faces, size=plate_size, proud=proud, tag='plate', **paint)
    return out


_PLATES_ON = {}


def _rect_overlap(a, b):
    return a[0] < b[1] and b[0] < a[1] and a[2] < b[3] and b[2] < a[3]


def plates(b, core, n, rng, faces=SIDE_FACES, size=(1.0, 2.25), proud=(0.25, 0.5), tag='plate', margin=0.0,
           yrange=None, **paint):
    """scatter n non-overlapping proud stone plates over the given faces of a core cube"""
    made = []
    for _ in range(n * 8):
        if len(made) >= n:
            break
        face = rng.pick(faces)
        axis, sign = FACE_AXIS[face]
        ta = [a for a in (0, 1, 2) if a != axis]
        dims, pos = [], []
        for a in ta:
            lo, hi = core.lo[a] + margin, core.hi[a] - margin
            if a == 1 and yrange:
                lo, hi = max(lo, yrange[0]), min(hi, yrange[1])
            if hi - lo < 0.5:
                break
            dmax = min(size[1], hi - lo)
            dmin = min(size[0], dmax)
            dd = q(rng.u(dmin, dmax))
            dd = max(0.5, min(dd, q(hi - lo)))
            p = lo + q(rng.u(0, max(0.0, hi - lo - dd)))
            dims.append(dd)
            pos.append(q(p))
        if len(dims) < 2:
            continue
        rect = (pos[0], pos[0] + dims[0], pos[1], pos[1] + dims[1])
        key = (id(core), face)
        taken = _PLATES_ON.setdefault(key, [])
        if any(_rect_overlap(rect, t) for t in taken):
            continue
        taken.append(rect)
        t = q(rng.pick(proud) if isinstance(proud, (list, tuple)) and len(proud) > 2 else rng.u(*proud))
        t = max(0.25, t)
        lo = list(core.lo)
        hi = list(core.hi)
        lo[ta[0]], hi[ta[0]] = rect[0], rect[1]
        lo[ta[1]], hi[ta[1]] = rect[2], rect[3]
        if sign > 0:
            lo[axis], hi[axis] = core.hi[axis], core.hi[axis] + t
        else:
            lo[axis], hi[axis] = core.lo[axis] - t, core.lo[axis]
        c = box(b, lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], tag=tag, rot=core.rot, pivot=core.pivot,
                **{**core.paint, **paint, 'auto': True})
        made.append(c)
    return made


def spike(b, base, d, length, thick=2.5, twist=0.0, tag='spike', embed=1.0, steps=3, **paint):
    """stepped stone spike: 2-3 stacked square cubes tapering to a point, pointing along d"""
    r = dir_to_rot(d, twist)
    piv = qv(base)
    total = length + embed
    if steps == 3 and thick >= 3.5:
        widths = [thick, thick - 1.0, thick - 2.0, max(0.5, thick - 3.0)]
        fr = [0.40, 0.27, 0.19, 0.14]
    elif steps == 3:
        widths = [thick, max(1.0, thick - 1.0), max(0.5, thick - 2.0)]
        fr = [0.45, 0.32, 0.23]
    else:
        widths = [thick, max(0.5, thick - 1.5)]
        fr = [0.6, 0.4]
    y = -embed
    cubes = []
    for i, (w, f) in enumerate(zip(widths, fr)):
        L = q(total * f) if i < len(fr) - 1 else q(length - y)
        L = max(0.5, L)
        c = box(b, piv[0] - w / 2, piv[0] + w / 2, piv[1] + y, piv[1] + y + L, piv[2] - w / 2, piv[2] + w / 2,
                tag=tag, rot=r, pivot=piv, **paint)
        c.paint['spike_len'] = (y, y + L, -embed, length)
        cubes.append(c)
        y = q(y + L)
    return cubes


def finger(hand, name_a, name_b, knuckle, la, lb, lclaw, splay, curl, w=1.0, d=1.25, soot=0.55, thumb=False):
    """two-bone finger with a long, dark, tapered claw.  Curl/splay are baked as cube rotations
    (bones stay at rotation 0 in the rest pose).  splay = (a, b, claw) degrees about Z,
    curl = (a, b, claw0, claw1, claw2) degrees about X (negative = toward the palm / front).
    Returns the rest-pose claw tip position."""
    K = qv(knuckle)
    ba = bone(name_a, hand, K)
    ra = (curl[0], 0, splay[0])
    Ra = rot_matrix(ra)
    x0 = K[0] - q(w / 2)
    z0 = K[2] - q(d / 2)
    pa = dict(soot=('const', soot))
    box(ba, x0, x0 + w, K[1] - la, K[1] + 0.5, z0, z0 + d, rot=ra, pivot=K, **pa)            # proximal phalanx
    box(ba, x0 - 0.25, x0 + w + 0.25, K[1] - 1.5, K[1] + 0.5, z0 + d, z0 + d + 0.5,          # knuckle cap (back)
        tag='plate', rot=ra, pivot=K, **pa)
    box(ba, x0 - 0.25, x0 + w + 0.25, K[1] - la - 0.5, K[1] - la + 1.0, z0 - 0.25, z0 + d + 0.25,  # joint knob
        tag='plate', rot=ra, pivot=K, **pa)
    J = qv(np.array(K) + Ra @ np.array([0, -la, 0]))
    bb = bone(name_b, name_a, J)
    rb = (curl[1], 0, splay[1])
    Rb = rot_matrix(rb)
    w2 = w - 0.25 if w > 1.5 else w
    d2 = d - 0.25
    x2 = J[0] - q(w2 / 2)
    z2 = J[2] - q(d2 / 2)
    box(bb, x2, x2 + w2, J[1] - lb, J[1] + 0.5, z2, z2 + d2, rot=rb, pivot=J,                 # middle phalanx
        soot=('const', min(1.0, soot + 0.1)))
    # claw: three tapering near-black segments, each curling a bit more toward the palm
    C = qv(np.array(J) + Rb @ np.array([0, -lb + 0.25, 0]))
    cw = [(1.25, 1.25), (1.0, 1.0), (0.5, 0.5)] if w >= 1.75 else [(1.0, 1.0), (0.75, 0.75), (0.5, 0.5)]
    cl = [q(lclaw * 0.4), q(lclaw * 0.35), q(lclaw * 0.3)]
    P = np.array(C, float)
    for k in range(3):
        rc = (curl[2 + k], 0, splay[2])
        Rc = rot_matrix(rc)
        piv = qv(P)
        cwx, cdz = cw[k]
        L = cl[k] + 0.25
        cx0 = piv[0] - q(cwx / 2)
        cz0 = piv[2] - q(cdz / 2)
        box(bb, cx0, cx0 + cwx, piv[1] - L, piv[1] + 0.25, cz0, cz0 + cdz, tag='claw', rot=rc, pivot=piv, claw_k=k)
        P = np.array(piv) + Rc @ np.array([0, -cl[k], 0])
    return P


def mirror_bones(pairs):
    """mirror right-side bones (x -> -x) into left-side bones; texture seeds differ per side"""
    for src, dst in pairs:
        s = BONES[src]
        par = s.parent
        for a, bnm in (('right', 'left'),):
            if par and a in par:
                par = par.replace(a, bnm)
        nb = bone(dst, par, (-s.pivot[0], s.pivot[1], s.pivot[2]))
        for c in s.cubes:
            rot = (c.rot[0], -c.rot[1], -c.rot[2]) if c.rot else None
            piv = (-c.pivot[0], c.pivot[1], c.pivot[2]) if c.rot else None
            nc = Cube(dst, (-c.hi[0], c.lo[1], c.lo[2]), (-c.lo[0], c.hi[1], c.hi[2]), c.tag, rot, piv, c.paint)
            nb.cubes.append(nc)
        for ln, lv in s.locators.items():
            nb.locators[ln.replace('right', 'left')] = (-lv[0], lv[1], lv[2])


# =====================================================================================
# 3. the creature
# =====================================================================================

def build_torso():
    rng = Rng(101)
    bone('root', None, (0, 0, 0))

    # ---- pelvis / hip block (y 45-51.75) with the lighter belt band on its top front
    body = bone('body', 'root', (0, 47, 0))
    belt = box(body, -6.5, 6.5, 48.25, 51.25, -3, 3)
    box(body, -6.25, 6.25, 50.25, 51.75, -3.5, -3, tag='band')                 # light belt band (front)
    box(body, -6.25, 6.25, 51.25, 51.75, -3, 2.5, tag='band')                  # its top face, dusty
    box(body, -6.75, -6.5, 48.5, 51.0, -2.5, 2.5, tag='plate')                  # iliac ends
    box(body, 6.5, 6.75, 48.5, 51.0, -2.5, 2.5, tag='plate')
    box(body, -2.25, 2.25, 45.0, 48.25, -3.25, 2.0)                             # sacrum / codpiece block
    box(body, -1.75, 1.75, 45.5, 47.75, -3.75, -3.25, tag='plate')              # its front plate
    box(body, -3.0, 3.0, 46.25, 48.25, 2.0, 3.25, tag='plate')                  # lower-back block
    box(body, -5.75, -2.5, 48.5, 50.75, 3.0, 3.5, tag='plate')                  # back plates
    box(body, 2.5, 5.75, 48.5, 50.75, 3.0, 3.5, tag='plate')
    plates(body, belt, 3, rng, faces=('north',), size=(1.0, 2.0), proud=(0.25, 0.25), yrange=(48.25, 50.25))

    # ---- waist: narrow segmented lower spine (y 50-56.5)
    waist = bone('waist', 'body', (0, 50, 0))
    box(waist, -1.75, 1.75, 50, 56.5, -1.25, 1.75)                              # spinal core
    v1 = box(waist, -3.0, 3.0, 52.0, 54.0, -2.0, 2.25)                          # vertebra blocks
    v2 = box(waist, -2.75, 2.75, 54.5, 56.0, -1.75, 2.5)
    box(waist, -0.75, 0.75, 52.25, 53.75, 2.25, 3.0, tag='plate')               # spinous processes
    box(waist, -0.75, 0.75, 54.75, 56.0, 2.5, 3.25, tag='plate')
    box(waist, -1.5, 1.5, 52.5, 53.5, -2.5, -2.0, tag='plate')                  # front plates
    box(waist, -1.25, 1.25, 54.75, 55.75, -2.25, -1.75, tag='plate')
    plates(waist, v1, 2, rng, faces=('east', 'west'), size=(0.75, 1.5), proud=(0.25, 0.25))
    plates(waist, v2, 2, rng, faces=('east', 'west'), size=(0.75, 1.5), proud=(0.25, 0.25))

    # ---- chest: narrow ribcage of stacked rib plates + shoulder girdle (y 56-69)
    chest = bone('chest', 'waist', (0, 56, 0))
    box(chest, -2.5, 2.5, 56, 68, -2.0, 2.5)                                    # core
    ribs = [(-3.5, 56.5, 57.75, -2.75, 3.0), (-4.25, 58.5, 59.75, -3.0, 3.25), (-4.75, 60.5, 61.75, -3.25, 3.25),
            (-5.25, 62.5, 63.75, -3.25, 3.5)]
    for xw, y0, y1, z0, z1 in ribs:
        r = box(chest, xw, -xw, y0, y1, z0, z1)
        plates(chest, r, 2, rng, faces=('north',), size=(0.75, 1.25), proud=(0.25, 0.25))
    box(chest, -5.5, 5.5, 64.25, 66.75, -3.25, 3.25)                            # upper chest block
    box(chest, -1.0, 1.0, 57.0, 63.25, -3.75, -2.0, tag='plate')                # sternum
    box(chest, -10.0, 10.0, 63.5, 66.25, -1.75, 1.75)                           # shoulder girdle bar
    box(chest, -4.0, 4.0, 66.75, 69.0, -2.5, 2.75)                              # neck base / trapezius
    box(chest, -6.0, -1.5, 59.5, 64.0, 3.25, 3.75, tag='plate')                 # scapulae
    box(chest, 1.5, 6.0, 59.5, 64.0, 3.25, 3.75, tag='plate')
    box(chest, -0.75, 0.75, 57.0, 63.0, 3.25, 4.0, tag='plate')                 # dorsal spine ridge
    chest_b = BONES['chest']
    chest_b.locators['lead'] = (0, 63.0, -4.0)

    # ---- neck
    neck = bone('neck', 'chest', (0, 68, 0))
    box(neck, -2.0, 2.0, 67.5, 70.5, -1.5, 2.25)
    box(neck, -1.75, 1.75, 70.5, 71.5, 1.25, 2.75)                              # top block under the skull (behind the jaw)
    box(neck, -1.5, 1.5, 67.75, 70.25, -2.0, -1.5, tag='plate', tone=0.72)      # throat plate (in shadow)
    box(neck, -1.25, 1.25, 68.25, 70.5, 2.25, 2.75, tag='plate')                # nape plate


def build_head():
    # Head box 8 w x 8 d x 12 h (y 71.5-83.5).  Face from the art (dormant_head / frenzy_head):
    #   forehead 79-83.5 | eyes 77-79 (2x2, inner gap 2) | cheek band 75.5-77 |
    #   dark mouth band 72.25-75.5 with 4 upper teeth (73.75-75) + 4 lower teeth (72.25-73.25) | chin 71.5-72.25
    head = bone('head', 'neck', (0, 72, 1))
    fp = dict(grid='bone', brick=(1.5, 1.25))
    box(head, -4, 4, 75.5, 83.5, -3.75, 3.5, tag='cranium', dark_faces=('down',), **fp)  # skull
    # face plates framing two recessed glowing eyes (0.5 deep sockets)
    box(head, -4, 4, 79.0, 83.5, -4.5, -3.75, tag='face', **fp)                   # forehead
    box(head, -1, 1, 77.0, 79.0, -4.5, -3.75, tag='face', **fp)                   # between the eyes
    box(head, -4, -3, 77.0, 79.0, -4.5, -3.75, tag='face', **fp)                  # outer eye frames
    box(head, 3, 4, 77.0, 79.0, -4.5, -3.75, tag='face', **fp)
    box(head, -4, 4, 75.5, 77.0, -4.5, -3.75, tag='face', dark_faces=('down',), **fp)  # cheek band
    for x0 in (-3.0, 1.0):                                                          # glowing eyes (2 x 2)
        box(head, x0, x0 + 2.0, 77.0, 79.0, -4.0, -3.75, tag='eye')
    # upper mouth: side walls, dark palate, four upper teeth hanging in the dark band
    box(head, -4, -3, 73.5, 75.5, -4.5, 3.5, tag='face', inner='west', **fp)
    box(head, 3, 4, 73.5, 75.5, -4.5, 3.5, tag='face', inner='east', **fp)
    box(head, -3, 3, 73.5, 75.5, -3.5, 3.5, tag='mouth', stone_faces=('south',), **fp)  # palate
    for x0 in (-2.5, -1.0, 0.5, 2.0):                                              # 4 upper teeth (0.5 wide)
        box(head, x0, x0 + 0.5, 73.75, 75.0, -4.25, -3.5, tag='tooth')
    # inner cheek plates: hidden inside the closed jaw, frame the cavity when the jaw drops
    box(head, -3.75, -3.5, 71.75, 73.5, -3.25, 3.0, tag='mouthwall', inner='west')
    box(head, 3.5, 3.75, 71.75, 73.5, -3.25, 3.0, tag='mouthwall', inner='east')
    head.locators['mouth'] = (0, 73.5, -6.0)

    # ---- jaw (hinged at the back: pivot [0, 73, 3.5]; +X opens)
    jaw = bone('jaw', 'head', (0, 73, 3.5))
    box(jaw, -4, 4, 71.5, 72.25, -4.5, 3.5, tag='face', top='mouth', **fp)       # chin / jaw floor
    box(jaw, -4, -3, 72.25, 73.5, -4.5, 3.5, tag='face', inner='west', **fp)     # jaw side walls
    box(jaw, 3, 4, 72.25, 73.5, -4.5, 3.5, tag='face', inner='east', **fp)
    box(jaw, -3, 3, 72.25, 72.75, -3.5, 3.5, tag='mouth', stone_faces=('south',), **fp)  # tongue
    box(jaw, -3, 3, 72.75, 73.5, 2.75, 3.5, tag='mouth', stone_faces=('south',), **fp)  # back wall
    for x0 in (-2.5, -1.0, 0.5, 2.0):                                              # 4 lower teeth
        box(jaw, x0, x0 + 0.5, 72.25, 73.25, -4.25, -3.5, tag='tooth')
    # cheek plates rising from the jaw (inside the skull when closed)
    box(jaw, -3.5, -3.25, 72.75, 77.25, -2.5, 3.0, tag='mouthwall', inner='west')
    box(jaw, 3.25, 3.5, 72.75, 77.25, -2.5, 3.0, tag='mouthwall', inner='east')
    box(jaw, -3.5, -3.25, 72.75, 75.25, -3.5, -2.5, tag='mouthwall', inner='west')
    box(jaw, 3.25, 3.5, 72.75, 75.25, -3.5, -2.5, tag='mouthwall', inner='east')


def build_mane():
    """dense collar of chunky stepped spikes radiating from the neck and shoulders.
    Laid out as rings around the neck (crown / mid / outer / low) plus a hanging front bib.
    theta: 0 = front (-Z), 90 = creature's right (-X), 180 = back (+Z)."""
    rng = Rng(202)
    bone('mane_front', 'chest', (0, 65, -3))
    bone('mane_back', 'chest', (0, 66, 3))
    bone('mane_left', 'chest', (6, 66, 0))
    bone('mane_right', 'chest', (-6, 66, 0))
    ZC = 0.5   # collar centre z

    def owner(theta):
        a = abs(theta)
        if a <= 45:
            return 'mane_front'
        if a >= 140:
            return 'mane_back'
        return 'mane_right' if theta > 0 else 'mane_left'

    def ring(theta, y, rx, rz, tilt, length, thick, jit=1.0):
        th = math.radians(theta + rng.u(-4, 4) * jit)
        ox, oz = -math.sin(th), -math.cos(th)
        tl = math.radians(tilt + rng.u(-6, 6) * jit)
        base = (rx * ox + rng.u(-0.3, 0.3), y + rng.u(-0.4, 0.4), ZC + rz * oz + rng.u(-0.3, 0.3))
        d = (math.cos(tl) * ox, math.sin(tl), math.cos(tl) * oz)
        spike(owner(theta), base, d, length + rng.u(-0.5, 0.5), thick=thick, twist=rng.u(-30, 30), embed=1.5)

    # (theta, tilt, length, thick) per ring, right side; mirrored (theta -> -theta) for the left
    crown = [(66, 64, 8.5, 3.5), (88, 74, 9.5, 3.5), (112, 68, 9.0, 3.5), (138, 60, 8.5, 3.5), (162, 55, 8.0, 3.5)]
    mid = [(42, 8, 7.5, 4.0), (62, 24, 8.0, 4.0), (82, 33, 8.5, 4.0), (102, 36, 8.5, 4.0), (124, 38, 8.0, 4.0),
           (146, 42, 8.5, 3.5), (167, 45, 8.5, 3.5)]
    outer = [(36, -30, 6.5, 3.5), (58, -4, 7.0, 3.5), (80, 12, 7.0, 4.0), (102, 16, 7.0, 3.5), (126, 18, 7.0, 3.5),
             (152, 24, 7.5, 3.5)]
    low = [(118, -4, 6.0, 3.0), (142, 2, 6.0, 3.0), (164, 6, 5.5, 3.0)]
    high_back = [(132, 62, 9.0, 3.5), (154, 66, 9.5, 3.5)]          # tall spikes rising behind the head
    upper = [(74, 52, 8.5, 3.5), (98, 50, 8.5, 3.5)]                 # fills the arc between crown and mid rings
    for sgn in (1, -1):
        for th, tl, L, t in crown:
            ring(sgn * th, 69.0, 5.0, 3.5, tl, L, t)
        for th, tl, L, t in mid:
            ring(sgn * th, 67.0, 7.0, 4.0, tl, L, t)
        for th, tl, L, t in outer:
            ring(sgn * th, 64.75, 9.0, 4.5, tl, L, t)
        for th, tl, L, t in low:
            ring(sgn * th, 61.75, 5.5, 4.0, tl, L, t)
        for th, tl, L, t in high_back:
            ring(sgn * th, 67.75, 4.5, 4.5, tl, L, t)
        for th, tl, L, t in upper:
            ring(sgn * th, 68.0, 6.0, 4.0, tl, L, t)
    # back centre line
    ring(180, 69.0, 5.0, 3.5, 54, 8.0, 3.5, jit=0.3)
    ring(180, 67.75, 4.5, 4.5, 68, 9.5, 3.5, jit=0.3)
    ring(180, 67.0, 7.0, 4.0, 45, 8.0, 4.0, jit=0.3)
    ring(180, 64.75, 9.0, 4.5, 24, 7.0, 3.5, jit=0.3)
    ring(180, 61.75, 5.5, 4.0, 8, 6.0, 3.0, jit=0.3)
    ring(180, 59.25, 4.0, 3.5, -12, 5.0, 3.0, jit=0.3)

    # front bib: rows of shards hanging forward/down over the upper chest
    bib = [  # y, z, [x...], (dy, dz), length, thick
        (67.0, -3.0, (-3.5, 3.5), (-0.50, -0.80), 5.5, 3.5),          # either side of the dark throat
        (64.75, -3.25, (-4.75, -2.0, 2.0, 4.75), (-0.65, -0.72), 6.0, 3.5),
        (62.25, -3.25, (-3.25, 0.0, 3.25), (-0.82, -0.52), 5.5, 3.0),
        (60.0, -3.0, (-1.5, 1.5), (-0.90, -0.40), 4.5, 2.5),
    ]
    for y, z, xs, (dy, dz), L, t in bib:
        for x in xs:
            d = (x * 0.1 + rng.u(-0.05, 0.05), dy + rng.u(-0.05, 0.05), dz)
            spike('mane_front', (x + rng.u(-0.25, 0.25), y + rng.u(-0.25, 0.25), z), d, L + rng.u(-0.4, 0.4),
                  thick=t, twist=rng.u(-25, 25), embed=1.5)

    # collar bulk under the spikes (keeps the ruff solid, no see-through gaps)
    box('mane_right', -10.5, -4.5, 64.5, 67.5, -2.75, 3.0, tag='plate')
    box('mane_left', 4.5, 10.5, 64.5, 67.5, -2.75, 3.0, tag='plate')
    box('mane_front', -5.0, 5.0, 63.5, 67.25, -3.75, -2.5, tag='plate')
    box('mane_back', -5.0, 5.0, 60.0, 68.5, 2.75, 4.25, tag='plate')


def build_arm_right():
    rng = Rng(303)
    au = bone('arm_right_upper', 'chest', (-11, 65, 0))
    cap = box(au, -13.5, -8.5, 61.5, 67.0, -2.5, 2.5)                          # shoulder block
    plates(au, cap, 2, rng, faces=('east', 'north', 'south'), size=(1.0, 2.0), proud=(0.25, 0.25))
    stack(au, -11, 0, [(61.5, 58.0, 4.0, 3.75), (58.0, 54.75, 4.25, 4.0), (54.75, 51.25, 4.0, 4.0),
                       (51.25, 48.0, 4.25, 3.75), (48.0, 45.5, 4.0, 3.75, 0, 0)], 0.25, rng, plates_per=2)

    al = bone('arm_right_lower', 'arm_right_upper', (-11, 45, 0))
    box(al, -13.5, -8.5, 42.75, 47.25, -2.25, 2.75)                            # visible elbow block
    box(al, -12.5, -9.5, 43.25, 46.75, 2.75, 3.25, tag='plate')                 # olecranon
    sootf = ('y', 40.0, 31.0, 0.55)
    stack(al, -11, 0.25, [(42.75, 39.75, 4.25, 4.0), (39.75, 36.75, 4.5, 4.25), (36.75, 33.75, 4.75, 4.5),
                          (33.75, 31.0, 5.0, 4.5, 0, 0)], 0.25, rng, plates_per=2, soot=sootf)

    hand = bone('hand_right', 'arm_right_lower', (-11, 31, 0))
    hs = ('const', 0.26)
    box(hand, -13.0, -9.0, 29.25, 32.0, -1.75, 2.0, soot=hs)                   # wrist
    box(hand, -14.0, -8.0, 24.5, 29.25, -1.25, 1.5, soot=hs)                   # palm faces front (-Z)
    box(hand, -13.5, -8.5, 25.75, 29.0, 1.5, 2.0, tag='plate', soot=hs)         # back of the hand
    box(hand, -12.5, -9.5, 26.5, 28.5, 2.0, 2.25, tag='plate', soot=hs)
    box(hand, -13.0, -9.0, 25.25, 28.5, -1.5, -1.25, tag='plate', soot=hs)      # palm pad
    box(hand, -14.25, -14.0, 25.5, 28.75, -0.75, 1.25, tag='plate', soot=hs)    # outer edge
    # four fingers: 1 = most medial (toward the body) ... 4 = most lateral; thumb on the medial side
    specs = [  # x, la, lb, claw, splay(a, b, claw), curl(a, b, c0, c1, c2)
        (-9.0, 4.5, 3.5, 4.5, (0, 2, 5), (-12, -26, -36, -48, -60)),
        (-10.75, 5.25, 4.0, 5.0, (-1, 0, 2), (-7, -20, -30, -42, -55)),
        (-12.5, 5.5, 4.0, 5.0, (5, 3, -2), (-7, -20, -30, -42, -55)),
        (-14.25, 4.75, 3.75, 4.75, (16, 8, -8), (-8, -22, -32, -45, -58)),
    ]
    tips = []
    for i, (x, la, lb, lc, sp, cu) in enumerate(specs):
        tips.append(finger('hand_right', f'finger_right_{i + 1}_a', f'finger_right_{i + 1}_b', (x, 25.0, 0.0),
                           la, lb, lc, sp, cu, w=1.75, d=1.75, soot=0.24))
    tips.append(finger('hand_right', 'thumb_right_a', 'thumb_right_b', (-8.75, 27.0, -1.0), 3.25, 2.75, 4.0,
                       (-6, 2, 8), (-42, -38, -42, -52, -62), w=1.5, d=1.5, thumb=True, soot=0.3))
    tip = np.mean(np.array(tips[:4]), axis=0)
    hand.locators['claw_right'] = qv((tip[0], tip[1] - 1.0, tip[2] - 1.0))
    TIPS['right'] = tips


TIPS = {}


def build_leg_right():
    rng = Rng(404)
    lu = bone('leg_right_upper', 'body', (-5, 47, 0))
    hip = box(lu, -7.5, -2.5, 44.25, 48.5, -2.5, 2.5)                           # hip joint block
    plates(lu, hip, 2, rng, faces=('east', 'north'), size=(1.0, 2.0), proud=(0.25, 0.25))
    stack(lu, -5, 0, [(44.25, 40.5, 4.5, 4.25), (40.5, 36.75, 4.75, 4.25), (36.75, 33.0, 4.5, 4.5),
                      (33.0, 29.75, 4.5, 4.0, 0, 0)], 0.25, rng, plates_per=2)

    ll = bone('leg_right_lower', 'leg_right_upper', (-5, 28, 0))
    soot = ('y', 21.0, 3.0, 0.56)
    box(ll, -7.5, -2.5, 26.0, 30.25, -3.0, 2.25, soot=soot)                     # knee block (kneecap forward)
    box(ll, -6.25, -3.75, 26.75, 29.5, -3.5, -3.0, tag='plate', soot=soot)
    # shin widens toward the ankle like a tree trunk
    stack(ll, -5, 0, [(26.0, 22.25, 4.5, 4.25), (22.25, 18.5, 5.0, 4.5), (18.5, 14.5, 5.75, 5.0),
                      (14.5, 10.5, 6.75, 5.75, 0, 0), (10.5, 6.5, 8.0, 6.5, 0, 0)], 0.25, rng, plates_per=3, soot=soot)
    # stepped buttress ribs running down into the foot roots: (x0, x1, z0, z1) lower (y 6.5-10.5) / upper (10.5-14)
    ribs = [((-8.25, -6.75, -4.0, -3.25), (-8.0, -7.0, -3.5, -3.0)),
            ((-3.25, -1.75, -4.0, -3.25), (-3.0, -2.0, -3.5, -3.0)),
            ((-9.75, -9.0, -1.0, 1.0), (-9.0, -8.5, -0.75, 0.75)),
            ((-5.75, -4.25, 3.25, 4.0), (-5.5, -4.5, 2.75, 3.25))]
    for lo, hi in ribs:
        box(ll, lo[0], lo[1], 6.5, 10.5, lo[2], lo[3], tag='plate', soot=soot)
        box(ll, hi[0], hi[1], 10.5, 14.0, hi[2], hi[3], tag='plate', soot=soot)
    box(ll, -1.0, -0.5, 6.5, 10.0, -0.75, 0.75, tag='plate', soot=soot)         # small medial rib

    ft = bone('foot_right', 'leg_right_lower', (-5, 6, 0))
    fs = ('y', 21.0, 0.0, 0.58)
    core = box(ft, -9.5, -0.75, 0.0, 6.75, -3.75, 3.5, soot=fs)                 # broad ankle / heel core
    box(ft, -8.75, -1.25, 6.75, 8.0, -3.0, 3.0, soot=fs)                         # filler inside the shin
    # toe-roots: low block + upper step; front ones splayed with a Y rotation
    roots = [
        # front-centre
        dict(lo=(-6.25, -3.75, 0.0, 3.0, -7.5, -3.75), hi=(-6.0, -4.0, 3.0, 5.25, -5.5, -3.75), rot=None),
        # front-lateral (splayed outward)
        dict(lo=(-9.25, -6.75, 0.0, 3.0, -7.0, -3.5), hi=(-9.0, -7.0, 3.0, 5.0, -5.25, -3.5), rot=(0, 22, 0),
             piv=(-8.0, 0, -3.75)),
        # front-medial (splayed inward, smaller)
        dict(lo=(-3.25, -1.0, 0.0, 2.75, -6.75, -3.5), hi=(-3.0, -1.25, 2.75, 4.75, -5.0, -3.5), rot=(0, -18, 0),
             piv=(-2.0, 0, -3.75)),
        # lateral root
        dict(lo=(-13.5, -9.5, 0.0, 3.0, -1.5, 1.25), hi=(-11.25, -9.5, 3.0, 5.5, -1.25, 1.0), rot=None),
        # lateral-rear root
        dict(lo=(-12.25, -9.0, 0.0, 2.5, 1.5, 3.75), hi=(-10.5, -9.0, 2.5, 4.5, 1.75, 3.5), rot=(0, 25, 0),
             piv=(-9.0, 0, 2.5)),
        # rear spur
        dict(lo=(-6.25, -3.75, 0.0, 2.5, 3.5, 7.0), hi=(-6.0, -4.0, 2.5, 4.75, 3.5, 5.25), rot=None),
    ]
    for r in roots:
        lo, hi = r['lo'], r['hi']
        kw = dict(rot=r['rot'], pivot=r.get('piv')) if r['rot'] else {}
        box(ft, lo[0], lo[1], lo[2], lo[3], lo[4], lo[5], soot=fs, **kw)
        box(ft, hi[0], hi[1], hi[2], hi[3], hi[4], hi[5], tag='plate', soot=fs, **kw)
    box(ft, -0.75, -0.25, 0.0, 2.25, -1.0, 1.0, tag='plate', soot=fs)            # medial nub
    plates(ft, core, 3, rng, faces=('north', 'east', 'south'), size=(0.75, 1.5), proud=(0.25, 0.25),
           yrange=(4.75, 6.75), soot=fs)
    ft.locators['foot_right'] = (-5.0, 0.0, 0.0)


def build_creature():
    build_torso()
    build_head()
    build_mane()
    build_arm_right()
    build_leg_right()
    arm_bones = ['arm_right_upper', 'arm_right_lower', 'hand_right'] + \
        [f'finger_right_{i}_{s}' for i in range(1, 5) for s in 'ab'] + ['thumb_right_a', 'thumb_right_b']
    mirror_bones([(n, n.replace('right', 'left')) for n in arm_bones])
    mirror_bones([(n, n.replace('right', 'left')) for n in ['leg_right_upper', 'leg_right_lower', 'foot_right']])
    # re-order so parents precede children in a readable way
    order = ['root', 'body', 'waist', 'chest', 'mane_front', 'mane_back', 'mane_left', 'mane_right', 'neck', 'head',
             'jaw']
    for side in ('right', 'left'):
        order += [f'arm_{side}_upper', f'arm_{side}_lower', f'hand_{side}']
        for i in range(1, 5):
            order += [f'finger_{side}_{i}_a', f'finger_{side}_{i}_b']
        order += [f'thumb_{side}_a', f'thumb_{side}_b']
    for side in ('right', 'left'):
        order += [f'leg_{side}_upper', f'leg_{side}_lower', f'foot_{side}']
    assert set(order) == set(BONES), set(BONES) ^ set(order)
    ordered = {n: BONES[n] for n in order}
    BONES.clear()
    BONES.update(ordered)
    k = 0
    for b in BONES.values():
        for c in b.cubes:
            c.idx = k
            c.seed = (k * 7919 + 17) % 1000003
            k += 1


# =====================================================================================
# 4. checks + hidden-face culling
# =====================================================================================

def face_rect(c, f):
    """(axis, plane, sign, (a1, lo1, hi1), (a2, lo2, hi2)) of a cube face in its own frame"""
    axis, sign = FACE_AXIS[f]
    plane = c.hi[axis] if sign > 0 else c.lo[axis]
    ta = [a for a in (0, 1, 2) if a != axis]
    return axis, plane, sign, [(a, c.lo[a], c.hi[a]) for a in ta]


def cull_hidden_faces():
    """omit faces that are permanently covered by another cube of the SAME bone and same frame"""
    culled = 0
    for b in BONES.values():
        for c in b.cubes:
            c.faces = []
            for f in FACES:
                axis, plane, sign, tan = face_rect(c, f)
                hidden = False
                for o in b.cubes:
                    if o is c or o.frame() != c.frame():
                        continue
                    if sign > 0:
                        cover = o.lo[axis] <= plane < o.hi[axis]
                    else:
                        cover = o.lo[axis] < plane <= o.hi[axis]
                    if not cover:
                        continue
                    if all(o.lo[a] <= lo and hi <= o.hi[a] for a, lo, hi in tan):
                        hidden = True
                        break
                if hidden:
                    culled += 1
                else:
                    c.faces.append(f)
    return culled


def check_grid():
    bad = []
    for b in BONES.values():
        for v in b.pivot:
            if abs(v * 4 - round(v * 4)) > 1e-9:
                bad.append(('bone pivot', b.name, b.pivot))
        for c in b.cubes:
            for v in list(c.lo) + list(c.size) + list(c.pivot or ()):
                if abs(v * 4 - round(v * 4)) > 1e-9:
                    bad.append(('cube', b.name, c.lo, c.size, c.pivot))
                    break
    return bad


def _inside_any(pw, skip=()):
    """is world (rest pose) point pw strictly inside any cube?"""
    for b in BONES.values():
        for o in b.cubes:
            if o in skip:
                continue
            p = pw
            if o.rot:
                p = (np.asarray(pw) - np.array(o.pivot)) @ o.matrix() + np.array(o.pivot)
            if all(o.lo[a] + 1e-4 < p[a] < o.hi[a] - 1e-4 for a in range(3)):
                return True
    return False


def check_zfight():
    """coplanar, same-facing, area-overlapping visible faces (same frame), within and across bones (rest pose).
    Overlaps buried inside other geometry are ignored."""
    issues = []
    groups = {}
    for b in BONES.values():
        for c in b.cubes:
            for f in c.faces:
                axis, plane, sign, tan = face_rect(c, f)
                key = (c.frame(), axis, sign, plane)
                groups.setdefault(key, []).append((c, f, tan))
    for key, lst in groups.items():
        frame, axis, sign, plane = key
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                (c1, f1, t1), (c2, f2, t2) = lst[i], lst[j]
                rect = []
                for (a, l1, h1), (_, l2, h2) in zip(t1, t2):
                    lo, hi = max(l1, l2), min(h1, h2)
                    if hi - lo <= 1e-9:
                        rect = None
                        break
                    rect.append((a, lo, hi))
                if rect is None:
                    continue
                buried = True
                for fu, fv in ((0.5, 0.5), (0.1, 0.1), (0.9, 0.1), (0.1, 0.9), (0.9, 0.9)):
                    p = [0.0, 0.0, 0.0]
                    p[axis] = plane + sign * 0.01
                    (a1, lo1, hi1), (a2, lo2, hi2) = rect
                    p[a1] = lo1 + (hi1 - lo1) * fu
                    p[a2] = lo2 + (hi2 - lo2) * fv
                    pw = c1.to_world(np.array(p))
                    if not _inside_any(pw, skip=(c1, c2)):
                        buried = False
                        break
                if not buried:
                    issues.append((c1, f1, c2, f2))
    return issues


def resolve_zfight():
    """drop auto-scattered plates that end up coplanar with other faces; returns remaining issues"""
    for _ in range(10):
        cull_hidden_faces()
        zf = check_zfight()
        drop = set()
        for c1, f1, c2, f2 in zf:
            cands = [c for c in (c1, c2) if c.paint.get('auto')]
            if cands:
                drop.add(min(cands, key=lambda c: (c.size[0] * c.size[1] * c.size[2], c.idx)))
        if not drop:
            return zf
        for b in BONES.values():
            b.cubes = [c for c in b.cubes if c not in drop]
    return zf


# =====================================================================================
# 5. UV packing
# =====================================================================================

def face_dims(c, f):
    sx, sy, sz = c.size
    return {'north': (sx, sy), 'south': (sx, sy), 'east': (sz, sy), 'west': (sz, sy), 'up': (sx, sz),
            'down': (sx, sz)}[f]


def pack_uvs():
    rects = []
    for b in BONES.values():
        for c in b.cubes:
            for f in c.faces:
                w, h = face_dims(c, f)
                rects.append((int(round(w * TPU)), int(round(h * TPU)), c, f))
    rects.sort(key=lambda r: (-r[1], -r[0], r[2].idx, r[3]))
    area = sum((w + 2 * PAD) * (h + 2 * PAD) for w, h, _, _ in rects)
    for W in (512, 1024, 2048):
        if W * W * 2 < area:
            continue
        x = y = 0
        shelf = 0
        placed = []
        for w, h, c, f in rects:
            ww, hh = w + 2 * PAD, h + 2 * PAD
            if x + ww > W:
                x = 0
                y += shelf
                shelf = 0
            placed.append((x + PAD, y + PAD, w, h, c, f))
            x += ww
            shelf = max(shelf, hh)
        Hn = y + shelf
        H = 1
        while H < Hn:
            H *= 2
        if H <= W and H <= MAX_PNG:
            for px, py, w, h, c, f in placed:
                c.uv[f] = (px, py, w, h)
            return W, H, area
    raise RuntimeError('texture atlas does not fit')


# =====================================================================================
# 6. texture painting
# =====================================================================================

def hexc(s):
    return np.array([int(s[i:i + 2], 16) for i in (1, 3, 5)], float)


PAL = {
    'base': hexc('#8a7879'), 'light': hexc('#bea9a4'), 'dark': hexc('#483a3b'), 'soot': hexc('#2a201e'),
    'spike': hexc('#a8908c'), 'claw': hexc('#1e1714'), 'mouth': hexc('#120c0a'),
    'eye_core': hexc('#fff4dc'), 'eye_rim': hexc('#ffb05a'), 'tooth': hexc('#f2e2c8'),
}


def _hash(*vals):
    h = 2166136261
    for v in vals:
        h ^= (int(v) & 0xffffffff)
        h = (h * 16777619) & 0xffffffff
        h ^= h >> 13
    return h


def hash01(*vals):
    return _hash(*vals) / 4294967296.0


class Noise3:
    """seeded 3-D value noise (smooth, vectorised)"""

    def __init__(self, seed):
        g = np.random.default_rng(seed)
        self.perm = g.permutation(256)
        self.vals = g.uniform(-1, 1, 256)

    def lat(self, ix, iy, iz):
        p = self.perm
        return self.vals[p[(p[(p[ix & 255] + iy) & 255] + iz) & 255]]

    def __call__(self, x, y, z):
        x0, y0, z0 = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(z).astype(int)
        fx, fy, fz = x - x0, y - y0, z - z0
        sx, sy, sz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
        out = 0
        for dx in (0, 1):
            wx = sx if dx else 1 - sx
            for dy in (0, 1):
                wy = sy if dy else 1 - sy
                for dz in (0, 1):
                    wz = sz if dz else 1 - sz
                    out = out + wx * wy * wz * self.lat(x0 + dx, y0 + dy, z0 + dz)
        return out


NZ_STREAK = Noise3(11)
NZ_GRAIN = Noise3(23)
NZ_TONE = Noise3(37)
NZ_DUST = Noise3(41)


def face_points(c, f, W, H):
    """cube-local points (H, W, 3) of the texel centres of face f, plus face-image unit coords (u right, v down)"""
    i = (np.arange(W) + 0.5) / TPU
    j = (np.arange(H) + 0.5) / TPU
    I, J = np.meshgrid(i, j)
    x0, y0, z0 = c.lo
    x1, y1, z1 = c.hi
    P = np.zeros((H, W, 3))
    if f == 'north':
        P[..., 0], P[..., 1], P[..., 2] = x0 + I, y1 - J, z0
    elif f == 'south':
        P[..., 0], P[..., 1], P[..., 2] = x1 - I, y1 - J, z1
    elif f == 'east':
        P[..., 0], P[..., 1], P[..., 2] = x0, y1 - J, z1 - I
    elif f == 'west':
        P[..., 0], P[..., 1], P[..., 2] = x1, y1 - J, z0 + I
    elif f == 'up':
        P[..., 0], P[..., 1], P[..., 2] = x0 + I, y1, z1 - J
    else:
        P[..., 0], P[..., 1], P[..., 2] = x0 + I, y0, z0 + J
    return P, I, J


def brick_layout(c, f, W, H, P, brick):
    """per-texel brick id, and distances (texels) to the brick's top/left/bottom/right seam"""
    bw, bh = brick
    grid = c.paint.get('grid', 'cube')
    if f in ('north', 'south', 'east', 'west'):
        if grid == 'bone':
            # world aligned rows/columns (continuous across neighbouring plates, e.g. the face)
            horiz = P[..., 0] if f in ('north', 'south') else P[..., 2]
            if f in ('south', 'east'):
                horiz = -horiz
            vert = -P[..., 1]
            rows = np.floor(vert / bh).astype(int)
            rv = (vert / bh - rows) * bh * TPU
            off = (rows % 2) * 0.5 * bw
            cols = np.floor((horiz + off) / bw).astype(int)
            cu = ((horiz + off) / bw - cols) * bw * TPU
            top, left = rv, cu
            bot, right = bh * TPU - rv, bw * TPU - cu
            return rows * 997 + cols, top, left, bot, right
        n_r = max(1, int(round(H / (bh * TPU))))
        edges_r = np.round(np.linspace(0, H, n_r + 1)).astype(int)
        jj = np.arange(H)
        row = np.searchsorted(edges_r, jj, side='right') - 1
        top_r = jj - edges_r[row]
        bot_r = edges_r[row + 1] - 1 - jj
        n_c = max(1, int(round(W / (bw * TPU))))
        cw = W / n_c
        ii = np.arange(W)
        rid = np.zeros((H, W), int)
        L = np.zeros((H, W))
        R = np.zeros((H, W))
        fo = hash01(c.seed, FACES.index(f)) * cw
        for r in range(n_r):
            off = fo + (0.5 * cw if r % 2 else 0.0)
            pos = (ii + off) / cw
            col = np.floor(pos).astype(int)
            frac = (pos - col) * cw
            sel = row == r
            rid[sel, :] = r * 101 + col[None, :]
            L[sel, :] = frac[None, :]
            R[sel, :] = (cw - frac - 1)[None, :]
        T = np.repeat(top_r[:, None], W, 1).astype(float)
        B = np.repeat(bot_r[:, None], W, 1).astype(float)
        return rid, T, L, B, R
    # top / bottom faces: plain grid
    n_r = max(1, int(round(H / (bh * TPU))))
    n_c = max(1, int(round(W / (bw * TPU))))
    jj = np.arange(H)
    ii = np.arange(W)
    er = np.round(np.linspace(0, H, n_r + 1)).astype(int)
    ec = np.round(np.linspace(0, W, n_c + 1)).astype(int)
    row = np.searchsorted(er, jj, side='right') - 1
    col = np.searchsorted(ec, ii, side='right') - 1
    rid = row[:, None] * 101 + col[None, :]
    T = (jj - er[row])[:, None].repeat(W, 1).astype(float)
    B = (er[row + 1] - 1 - jj)[:, None].repeat(W, 1).astype(float)
    L = (ii - ec[col])[None, :].repeat(H, 0).astype(float)
    R = (ec[col + 1] - 1 - ii)[None, :].repeat(H, 0).astype(float)
    return rid, T, L, B, R


AO_CUBES = {}


def ambient_occlusion(c, Pw, Nw):
    """cheap AO: fraction of hemisphere sample points that fall inside other cubes of the same bone"""
    cands = AO_CUBES.get(c.bone, [])
    if not cands:
        return np.ones(Pw.shape[:2])
    H, W, _ = Pw.shape
    pts = Pw.reshape(-1, 3)
    n = Nw / np.linalg.norm(Nw)
    # tangent frame
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    t1 = np.cross(n, a)
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(n, t1)
    samples = []
    for r in (0.3, 0.65, 1.1):
        for k in range(6):
            ang = 2 * math.pi * (k + (0.5 if r == 0.65 else 0.0)) / 6
            dvec = n * 0.55 + (t1 * math.cos(ang) + t2 * math.sin(ang)) * 0.85
            samples.append(dvec / np.linalg.norm(dvec) * r)
    samples = np.array(samples)
    lo_box = pts.min(0) - 1.6
    hi_box = pts.max(0) + 1.6
    occ = np.zeros(len(pts))
    S = pts[:, None, :] + samples[None, :, :] + n[None, None, :] * 0.05
    for o in cands:
        if o is c:
            continue
        # bounding test (world AABB of o)
        if np.any(o.wlo > hi_box) or np.any(o.whi < lo_box):
            continue
        if o.rot:
            Minv = o.matrix()
            loc = (S - np.array(o.pivot)) @ Minv + np.array(o.pivot)   # inverse rotation (R^T applied as row @ R)
        else:
            loc = S
        inside = np.all((loc > np.array(o.lo) + 1e-6) & (loc < np.array(o.hi) - 1e-6), axis=-1)
        occ = occ + inside.mean(1)
    occ = np.clip(occ, 0, 1)
    return (1 - 0.5 * occ).reshape(H, W)


def prepare_ao():
    for b in BONES.values():
        lst = []
        for o in b.cubes:
            corners = np.array([[x, y, z] for x in (o.lo[0], o.hi[0]) for y in (o.lo[1], o.hi[1])
                                for z in (o.lo[2], o.hi[2])])
            wc = o.to_world(corners)
            o.wlo, o.whi = wc.min(0), wc.max(0)
            lst.append(o)
        AO_CUBES[b.name] = lst


def soot_amount(c, Pw):
    s = c.paint.get('soot')
    if not s:
        return np.zeros(Pw.shape[:2])
    if s[0] == 'const':
        base = np.full(Pw.shape[:2], s[1])
    else:
        _, y_start, y_full, amt = s
        t = np.clip((y_start - Pw[..., 1]) / (y_start - y_full), 0, 1)
        base = amt * t ** 1.2
    return base


def paint_face(c, f, W, H):
    """returns RGBA float array (H, W, 4) in 0..255"""
    P, I, J = face_points(c, f, W, H)
    M = c.matrix()
    Pw = c.to_world(P.reshape(-1, 3)).reshape(P.shape)
    axis, sign = FACE_AXIS[f]
    n = np.zeros(3)
    n[axis] = sign
    Nw = M @ n
    tag = c.tag
    rgb = np.zeros((H, W, 3))
    alpha = np.full((H, W), 255.0)
    seed = c.seed * 13 + FACES.index(f)

    dark = (tag == 'mouth' and f not in c.paint.get('stone_faces', ())) or f == c.paint.get('inner') or \
        f in c.paint.get('dark_faces', ()) or (f == 'up' and c.paint.get('top') == 'mouth')
    if tag == 'mouth' and not dark:
        tag = 'face'
    if dark:
        g = NZ_GRAIN(Pw[..., 0] * 3, Pw[..., 1] * 3, Pw[..., 2] * 3)
        rgb[:] = PAL['mouth'] * (1 + 0.25 * g)[..., None]
        # faint ridges inside the mouth
        return np.dstack([rgb, alpha])
    if tag == 'tooth':
        v = J / max(J.max(), 1e-6)
        shade = 1.0 - 0.10 * v
        rgb[:] = PAL['tooth'] * shade[..., None]
        edge = (I < 0.26) | (I > I.max() - 0.26)
        rgb[edge] *= 0.86
        if f == 'north':
            rgb[(J < 0.26)] = np.minimum(255, rgb[(J < 0.26)] * 1.05)
        alpha[:] = 70
        return np.dstack([rgb, alpha])
    if tag == 'eye':
        # square glowing eye: warm-white core, orange rim; alpha 0 (core) .. 30 (rim) = emissive
        dd = np.minimum(np.minimum(I, I.max() + 0.125 - I), np.minimum(J, J.max() + 0.125 - J)) * TPU  # texels to edge
        core = np.clip((dd - 1.0) / 1.6, 0, 1)
        rgb[:] = PAL['eye_rim'] * (1 - core[..., None]) + PAL['eye_core'] * core[..., None]
        alpha[:] = 30 * (1 - core)
        return np.dstack([rgb, alpha])
    if tag == 'claw':
        k = c.paint.get('claw_k', 0)
        g = NZ_GRAIN(Pw[..., 0] * 4, Pw[..., 1] * 4, Pw[..., 2] * 4)
        base = PAL['claw'] * (1.0 + 0.12 * g)[..., None]
        # tip highlight: lighter toward the end of the last segment, glossy edge on one side
        if f in SIDE_FACES:
            v = J / max(J.max(), 1e-6)
            hl = (0.10 + 0.25 * k) * v
            base = base + (np.array([92, 74, 66]) * hl[..., None])
            edge = I < 0.3
            base[edge] = base[edge] * 1.35 + 6
        if f == 'up':
            base = base * 1.2
        rgb[:] = base
        return np.dstack([np.clip(rgb, 0, 255), alpha])

    # ---------------- stone family
    brick = c.paint.get('brick', (1.5, 1.5) if tag != 'spike' else (1.5, 1.25))
    if tag == 'spike':
        brick = (min(brick[0], c.size[0] * 0.55 + 0.25), 1.25)
    rid, T, L, B, R = brick_layout(c, f, W, H, P, brick)
    base = PAL['base'].copy()
    if tag == 'plate':
        base = base * (1.0 + 0.07 * (hash01(c.seed, 3) - 0.45))
    elif tag == 'band':
        base = PAL['light'] * 0.93
    elif tag == 'spike':
        base = PAL['base'] * 1.04
    elif tag == 'mouthwall':
        base = PAL['base'] * 0.5
    base = base * c.paint.get('tone', 1.0)
    # per-brick tone: most tiles within +-7 %, a few distinctly darker / lighter
    uniq = np.unique(rid)
    tone = np.ones((H, W))
    hue = np.zeros((H, W))
    for u in uniq:
        h1 = hash01(seed, u, 1)
        h2 = hash01(seed, u, 2)
        headish = tag in ('face', 'cranium')
        t = 1.0 + (h1 - 0.5) * (0.12 if headish else 0.19)
        if h2 < (0.025 if headish else 0.08):
            t *= 0.86 if headish else 0.83
        elif h2 > (0.96 if headish else 0.93):
            t *= 1.08 if headish else 1.11
        sel = rid == u
        tone[sel] = t
        hue[sel] = (hash01(seed, u, 3) - 0.5) * 0.06
    col = base[None, None, :] * tone[..., None]
    col[..., 0] *= 1 + hue
    col[..., 2] *= 1 - hue
    # large-scale tonal drift + granite grain + specks
    drift = NZ_TONE(Pw[..., 0] * 0.35, Pw[..., 1] * 0.35, Pw[..., 2] * 0.35)
    col *= (1 + 0.06 * drift)[..., None]
    grain = NZ_GRAIN(Pw[..., 0] * 5.0, Pw[..., 1] * 5.0, Pw[..., 2] * 5.0)
    rnd = np.random.default_rng(seed).uniform(-1, 1, (H, W))
    col *= (1 + 0.03 * grain + 0.03 * rnd)[..., None]
    speck = np.random.default_rng(seed + 7).uniform(0, 1, (H, W))
    col[speck > 0.985] *= 1.15
    col[speck < 0.012] *= 0.75
    # 1-texel bevel per tile: lighter top/left, darker bottom/right
    bev = np.zeros((H, W))
    bev += np.where(T < 1, 0.11, 0) + np.where(L < 1, 0.05, 0)
    bev -= np.where(B < 1, 0.12, 0) + np.where(R < 1, 0.07, 0)
    col *= (1 + bev)[..., None]
    # mortar seams (first texel row/col of every tile); faces of very small cubes get none
    mortar = (T < 1) & (H > 4)
    mortar |= (L < 1) & (W > 4)
    if f in SIDE_FACES and c.paint.get('grid', 'cube') == 'cube':
        mortar &= ~(J < 0.26)                       # the cube's own top edge stays crisp
    mcol = PAL['dark'] * (0.9 + 0.2 * np.random.default_rng(seed + 3).uniform(0, 1, (H, W)))[..., None]
    mix = 0.40 if tag not in ('face', 'cranium') else 0.30
    col[mortar] = col[mortar] * (1 - mix) + mcol[mortar] * mix
    # cracks: short random walks
    cr = np.random.default_rng(seed + 11)
    ncr = int(cr.poisson(W * H / 1100.0 * (0.6 if tag in ('face', 'cranium') else 1.0)))
    for _ in range(ncr):
        x, y = cr.integers(0, W), cr.integers(0, H)
        ln = cr.integers(3, 8)
        dx = cr.choice([-1, 0, 1])
        for _s in range(ln):
            if 0 <= x < W and 0 <= y < H:
                col[y, x] = col[y, x] * 0.6 + PAL['dark'] * 0.4
                if 0 <= x + 1 < W:
                    col[y, x + 1] = col[y, x + 1] * 1.05
            y += 1
            x += dx if cr.uniform() < 0.5 else 0
            if cr.uniform() < 0.25:
                dx = cr.choice([-1, 0, 1])
    # cube edge treatment (sides): catch-light on the top edge, darker bottom edge
    if f in SIDE_FACES:
        col[J < 0.26] *= 1.08
        col[(J > J.max() - 0.26)] *= 0.88
    # orientation: up faces dusty and lighter, down faces darker
    up_amt = Nw[1]
    if up_amt > 0.3:
        dust = NZ_DUST(Pw[..., 0] * 1.3, Pw[..., 1] * 1.3, Pw[..., 2] * 1.3)
        k = (0.09 + 0.05 * dust) * up_amt
        col = col * (1 + k)[..., None] + np.array([12, 11, 10]) * up_amt
        dsp = np.random.default_rng(seed + 5).uniform(0, 1, (H, W))
        col[dsp > 0.93] = col[dsp > 0.93] * 0.85 + PAL['light'] * 0.15
    elif up_amt < -0.3:
        col *= 1 - 0.12 * (-up_amt)
    # spikes: lighter toward the tip, darker at the root
    if tag == 'spike':
        sl = c.paint.get('spike_len')
        if sl:
            y_loc = P[..., 1] - c.pivot[1]
            tt = np.clip((y_loc - sl[2]) / (sl[3] - sl[2]), 0, 1)
            col *= (0.82 + 0.26 * tt)[..., None]
        if up_amt > 0.3 or f == 'up':
            col = col * 0.75 + PAL['spike'] * 0.25 * 1.12
    # soot / char: vertical streaks whose coverage grows lower down (world-aligned: streaks run across cubes)
    sa = soot_amount(c, Pw)
    if np.any(sa > 0):
        st = NZ_STREAK(Pw[..., 0] * 1.5, Pw[..., 1] * 0.2, Pw[..., 2] * 1.5)
        st2 = NZ_GRAIN(Pw[..., 0] * 2.6 + 7, Pw[..., 1] * 0.55, Pw[..., 2] * 2.6 + 3)
        sv = np.clip(0.5 + 0.5 * (0.75 * st + 0.35 * st2) / 0.55, 0, 1)     # ~uniform 0..1
        th = 1.0 - np.clip(sa, 0, 0.95)
        m = np.clip((sv - th) / 0.12 + 0.5, 0, 1)
        if tag == 'plate':
            m = np.clip(m * 1.1, 0, 1)
        if up_amt > 0.3:
            m *= 0.55                                    # tops catch dust, stay lighter
        sc = PAL['soot'] * (0.85 + 0.3 * np.random.default_rng(seed + 9).uniform(0, 1, (H, W)))[..., None]
        col = col * (1 - 0.85 * m[..., None]) + sc * (0.85 * m[..., None])
        col *= (1 - 0.12 * np.clip(sa, 0, 1))[..., None]
    # ambient occlusion from the same bone
    ao = ambient_occlusion(c, Pw, Nw)
    col *= ao[..., None]
    # eye sockets: stone walls warmed by the glow (still opaque, alpha 255)
    if tag == 'face':
        ex = ((P[..., 0] > -3.01) & (P[..., 0] < -0.99)) | ((P[..., 0] > 0.99) & (P[..., 0] < 3.01))
        sock = ex & (P[..., 1] > 76.99) & (P[..., 1] < 79.01) & (P[..., 2] > -4.51) & (P[..., 2] < -3.74)
        if np.any(sock):
            col[sock] = col[sock] * 0.55 + PAL['eye_rim'] * 0.42
    return np.dstack([np.clip(col, 0, 255), alpha])


def paint_atlas(W, H):
    img = np.zeros((H, W, 4))
    img[..., :3] = PAL['dark']
    img[..., 3] = 255
    prepare_ao()
    for b in BONES.values():
        for c in b.cubes:
            for f in c.faces:
                px, py, w, h = c.uv[f]
                tile = paint_face(c, f, w, h)
                # dilate edge texels into the padding
                padded = np.pad(tile, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
                img[py - PAD:py + h + PAD, px - PAD:px + w + PAD] = padded
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


# =====================================================================================
# 7. output
# =====================================================================================

def num(v):
    v = round(float(v), 4)
    return int(v) if v == int(v) else v


def geo_json(W, H):
    tw, th = W // TPU, H // TPU
    bones = []
    for b in BONES.values():
        jb = {'name': b.name}
        if b.parent:
            jb['parent'] = b.parent
        jb['pivot'] = [num(v) for v in b.pivot]
        if b.cubes:
            cubes = []
            for c in b.cubes:
                jc = {'origin': [num(v) for v in c.lo], 'size': [num(v) for v in c.size]}
                if c.rot:
                    jc['pivot'] = [num(v) for v in c.pivot]
                    jc['rotation'] = [num(v) for v in c.rot]
                uv = {}
                for f in FACES:
                    if f in c.uv:
                        px, py, w, h = c.uv[f]
                        uv[f] = {'uv': [num(px / TPU), num(py / TPU)], 'uv_size': [num(w / TPU), num(h / TPU)]}
                jc['uv'] = uv
                cubes.append(jc)
            jb['cubes'] = cubes
        if b.locators:
            jb['locators'] = {k: [num(v) for v in val] for k, val in b.locators.items()}
        bones.append(jb)
    return {
        'format_version': '1.12.0',
        'minecraft:geometry': [{
            'description': {
                'identifier': 'geometry.shaftbreaker',
                'texture_width': tw,
                'texture_height': th,
                'visible_bounds_width': 6,
                'visible_bounds_height': 7,
                'visible_bounds_offset': [0, 3, 0],
            },
            'bones': bones,
        }],
    }


def dump_geo(obj):
    """compact-but-readable JSON: number arrays and per-face uv objects on one line"""
    s = json.dumps(obj, indent=2)
    s = re.sub(r'\[\s+([-\d.,\s]+?)\s+\]', lambda m: '[' + ', '.join(x.strip() for x in m.group(1).split(',')) + ']', s)
    s = re.sub(r'"(north|south|east|west|up|down)": \{[^{}]*\}', lambda m: re.sub(r'\s*\n\s*', ' ', m.group(0)), s)
    return s + '\n'


def main():
    stats = '--stats' in sys.argv
    build_creature()
    bad = check_grid()
    if bad:
        for x in bad[:20]:
            print('GRID', x)
        raise SystemExit('grid check failed')
    zf = resolve_zfight()
    culled = cull_hidden_faces()
    if zf:
        for c1, f1, c2, f2 in zf[:40]:
            print('ZFIGHT', c1.bone, c1.lo, c1.hi, f1, '|', c2.bone, c2.lo, c2.hi, f2)
        raise SystemExit(f'{len(zf)} coplanar overlapping face pairs (would z-fight)')
    W, H, area = pack_uvs()
    img = paint_atlas(W, H)
    os.makedirs(os.path.dirname(GEO_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(TEX_PATH), exist_ok=True)
    with open(GEO_PATH, 'w') as fh:
        fh.write(dump_geo(geo_json(W, H)))
    Image.fromarray(img, 'RGBA').save(TEX_PATH, optimize=True)
    ncubes = sum(len(b.cubes) for b in BONES.values())
    nfaces = sum(len(c.faces) for b in BONES.values() for c in b.cubes)
    print(f'bones {len(BONES)}  cubes {ncubes}  faces {nfaces} (culled {culled})  '
          f'texture {W}x{H} px (declared {W // TPU}x{H // TPU})  fill {area / (W * H):.0%}')
    if stats:
        for side, tips in TIPS.items():
            print('  claw tips', side, [tuple(round(float(v), 2) for v in t) for t in tips])
        for b in BONES.values():
            print(f'  {b.name:22s} {len(b.cubes):4d} cubes  pivot {list(b.pivot)}')


if __name__ == '__main__':
    main()
