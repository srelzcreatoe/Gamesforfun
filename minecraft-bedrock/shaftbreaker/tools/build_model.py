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
    2. modelling helpers: box(), stack(), plates(), shard() (mane spikes), finger(), mirroring
    3. the creature: torso, head + jaw, mane, arms + hands, legs + feet
    4. checks: grid, z-fighting (coplanar overlapping faces), jaw-sweep clearance, hidden-face culling
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


def orient(d, up=(0.0, 1.0, 0.0)):
    """Bedrock euler (rx, ry, rz) of the rotation that maps local +Y onto direction d and local +Z onto the
    component of `up` perpendicular to d (exact inverse of rot_matrix: R = Rz(-rz) . Ry(ry) . Rx(-rx))."""
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    u = np.asarray(up, float)
    u = u - np.dot(u, d) * d
    if np.linalg.norm(u) < 1e-3:
        u = np.array([0.0, 0.0, -1.0]) - d[2] * d
    u = u / np.linalg.norm(u)
    R = np.column_stack([np.cross(d, u), d, u])
    b = math.asin(max(-1.0, min(1.0, -R[2, 0])))
    c = math.atan2(R[2, 1], R[2, 2])
    a = math.atan2(R[1, 0], R[0, 0])
    r = (round(-math.degrees(c), 1), round(math.degrees(b), 1), round(-math.degrees(a), 1))
    chk = rot_matrix(r)
    assert np.dot(chk @ np.array([0, 1.0, 0]), d) > 0.999 and np.dot(chk @ np.array([0, 0, 1.0]), u) > 0.999, (d, u, r)
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
LAT_FACES = ('east', 'north', 'south')     # right-side limbs: lateral (-X), front, back -- never the medial face


def stack(b, cx, cz, segs, jitter, rng, tag='stone', plates_per=2, plate_faces=SIDE_FACES, plate_size=(1.25, 2.5),
          proud=(0.5, 1.0), **paint):
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


def plates(b, core, n, rng, faces=SIDE_FACES, size=(1.0, 2.25), proud=(0.5, 0.75), tag='plate', margin=0.0,
           yrange=None, min_size=1.0, **paint):
    """scatter n non-overlapping proud stone plates (>= min_size wide) over the given faces of a core cube"""
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
            dmin = min(max(size[0], min_size), dmax)
            dd = q(rng.u(dmin, dmax))
            dd = max(min(min_size, q(hi - lo)), min(dd, q(hi - lo)))
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


def _half(v):
    """snap a spike block width to the 0.5 grid (so it can be centred exactly on a 0.25-grid axis), >= 1.0"""
    return max(1.0, round(v * 2) / 2)


def shard(b, base, d, length, w=4.0, t=3.0, up=(0.0, 1.0, 0.0), embed=1.5, tag='spike', **paint):
    """Chunky stepped stone spike of the mane (dormant_full / stalk_full): three stacked blocks (two for short
    spikes) tapering to a ~1-unit point.  Every block is CENTRED on the one before it in both cross-section axes,
    so the spike narrows evenly on all four sides and reads as a stepped triangle from every view (no flat-topped
    planks).  Local +Y runs along d, local +Z is `up` with its d-component removed.  w = width across (local X:
    w, 0.6 w, 0.3 w), t = thickness (local Z: t, 0.6 t, 0.35 t).  `embed` units of the shaft sit behind `base`,
    inside the collar."""
    r = orient(d, up)
    P = qv(base)
    if length >= 5.0:
        segs = [(_half(w), _half(t), 0.47), (_half(w * 0.6), _half(t * 0.6), 0.35),
                (_half(w * 0.3), _half(t * 0.35), 0.18)]
    else:
        segs = [(_half(w), _half(t), 0.6), (_half(w * 0.5), _half(t * 0.5), 0.4)]
    total = length + embed
    y = -embed
    cubes = []
    for i, (sw, st, f) in enumerate(segs):
        L = q(total * f) if i < len(segs) - 1 else q(length - y)
        L = max(1.0, L)
        x0 = P[0] - sw / 2
        z0 = P[2] - st / 2
        c = box(b, x0, x0 + sw, P[1] + y, P[1] + y + L, z0, z0 + st, tag=tag, rot=r, pivot=P, **paint)
        c.paint['spike_len'] = (y, y + L, -embed, length)
        c.paint['spike_seg'] = (i, len(segs))
        cubes.append(c)
        y = q(y + L)
    return cubes


def finger(hand, name_a, name_b, knuckle, la, lb, lclaw, splay, curl, w=2.0, d=2.25, soot=0.4):
    """two-bone finger with a long, dark, hooked claw.  Curl/splay are baked as cube rotations (bones stay
    at rotation 0 in the rest pose).  splay = (a, b, (claw0, claw1, claw2)) degrees about Z (right hand:
    + = lateral), curl = (a, b, claw0, claw1, claw2) degrees about X (negative = toward the palm / front).
    The claw is four tapering segments (1.5 -> 1.0 -> 0.75 -> 0.5): the last one, 1.25 long, curls a further
    12 deg so every claw ends in a hooked point.  Returns the rest-pose claw tip position."""
    K = qv(knuckle)
    ba = bone(name_a, hand, K)
    ra = (curl[0], 0, splay[0])
    Ra = rot_matrix(ra)
    x0 = K[0] - q(w / 2)
    z0 = K[2] - q(d / 2)
    pa = dict(soot=('const', soot))
    box(ba, x0, x0 + w, K[1] - la, K[1] + 0.5, z0, z0 + d, rot=ra, pivot=K, **pa)            # proximal phalanx
    box(ba, x0, x0 + w, K[1] - 1.5, K[1] + 0.5, z0 + d, z0 + d + 0.5,                          # knuckle cap (back)
        tag='plate', rot=ra, pivot=K, **pa)
    box(ba, x0 - 0.25, x0 + w + 0.25, K[1] - la - 0.5, K[1] - la + 1.0, z0 - 0.25, z0 + d + 0.25,  # joint knob
        tag='plate', rot=ra, pivot=K, **pa)
    J = qv(np.array(K) + Ra @ np.array([0, -la, 0]))
    bb = bone(name_b, name_a, J)
    rb = (curl[1], 0, splay[1])
    Rb = rot_matrix(rb)
    w2, d2 = w - 0.25, d - 0.25
    x2 = J[0] - q(w2 / 2)
    z2 = J[2] - q(d2 / 2)
    box(bb, x2, x2 + w2, J[1] - lb, J[1] + 0.5, z2, z2 + d2, rot=rb, pivot=J,               # middle phalanx
        soot=('const', min(1.0, soot + 0.1)))
    # claw: four tapering near-black segments, each curling further toward the palm (X) and hooking toward
    # the palm centre (Z)
    C = qv(np.array(J) + Rb @ np.array([0, -lb + 0.25, 0]))
    cw = (1.5, 1.0, 0.75, 0.5)
    cl = (q(lclaw * 0.4), q(lclaw * 0.33), q(lclaw * 0.27), 1.25)
    curls = tuple(curl[2:5]) + (curl[4] - 12,)
    splays = tuple(splay[2]) + (splay[2][2],)
    P = np.array(C, float)
    for k in range(4):
        rc = (curls[k], 0, splays[k])
        Rc = rot_matrix(rc)
        piv = qv(P)
        L = cl[k] + 0.25
        cx0 = piv[0] - q(cw[k] / 2)
        cz0 = piv[2] - q(cw[k] / 2)
        box(bb, cx0, cx0 + cw[k], piv[1] - L, piv[1] + 0.25, cz0, cz0 + cw[k], tag='claw', rot=rc, pivot=piv,
            claw_k=k)
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

# Jaw swing: the jaw (hinge [0, 73, 3.5]) sweeps the region under the chin (|x| < 4.25, y 64-71.5) when it opens
# to 55 deg.  Torso / neck / mane cubes stay out of it (the neck is set back, z >= 1.25, and its faces are painted
# as the shadowed throat); check_jaw_sweep() fails the build if any cube shows inside the open mouth.  Blades of
# the front bib hang across the recess from just below the chin, ~10 units from the hinge (outside the 8.14-unit
# swing radius of the jaw).
THROAT = 0.55               # shadowed-stone tone (~#53403b) of faces seen through the recess under the chin


def build_torso():
    rng = Rng(101)
    bone('root', None, (0, 0, 0))

    # ---- pelvis / hip block (y 45-51.75): lighter belt band on its top front, a codpiece block hanging over
    #      the band centre (1 unit proud, narrowing downward) and two belt-loop posts (dormant_torso)
    body = bone('body', 'root', (0, 47, 0))
    belt = box(body, -6.5, 6.5, 48.25, 51.25, -3, 3)
    box(body, -6.25, 6.25, 50.25, 51.75, -3.5, -3, tag='band')                 # light belt band (front)
    box(body, -6.25, 6.25, 51.25, 51.75, -3, 2.5, tag='band')                  # its top face, dusty
    box(body, -6.75, -6.5, 48.5, 51.0, -2.5, 2.5, tag='plate')                  # iliac ends
    box(body, 6.5, 6.75, 48.5, 51.0, -2.5, 2.5, tag='plate')
    box(body, -2.0, 2.0, 45.0, 48.25, -3.25, 2.0)                               # sacrum
    box(body, -2.25, 2.25, 47.0, 51.5, -4.25, -3.0, tag='plate')               # codpiece (over the band)
    box(body, -1.75, 1.75, 44.75, 47.0, -4.0, -3.0, tag='plate')                # its narrower lower block
    for sx in (-1, 1):
        box(body, sx * 4.0, sx * 5.0, 51.25, 53.25, -3.75, -2.75, tag='plate')  # belt-loop posts
    box(body, -3.0, 3.0, 46.25, 48.25, 2.0, 3.25, tag='plate')                  # lower-back block
    box(body, -5.75, -2.5, 48.5, 50.75, 3.0, 3.5, tag='plate')                  # back plates
    box(body, 2.5, 5.75, 48.5, 50.75, 3.0, 3.5, tag='plate')
    plates(body, belt, 2, rng, faces=('north',), size=(1.0, 2.0), proud=(0.25, 0.25), yrange=(48.25, 50.25))

    # ---- waist: exposed lower ribcage in shadow (y 50-56.5): 4-wide spine, lateral rib bars behind dark
    #      gaps, two rungs and segment lines (ref_torso_grid / dormant_torso)
    waist = bone('waist', 'body', (0, 50, 0))
    wt = dict(tone=0.9)                         # lit stone like the limbs; only the gaps between bars read dark
    box(waist, -2.0, 2.0, 50, 56.5, -1.5, 2.0, **wt)                            # spinal column
    box(waist, -1.5, 1.5, 52.0, 53.5, -2.0, -1.5, tag='plate', **wt)            # vertebra segment fronts
    box(waist, -1.5, 1.5, 54.25, 55.75, -2.0, -1.5, tag='plate', **wt)
    for sx in (-1, 1):
        box(waist, sx * 2.75, sx * 4.0, 51.5, 56.0, -1.25, 1.75, tone=0.85)     # lateral rib bars (0.75 gap)
    box(waist, -2.75, 2.75, 52.5, 53.0, -0.75, 1.25, tag='plate', tone=0.85)    # rungs linking bars and spine
    box(waist, -2.75, 2.75, 54.75, 55.25, -0.75, 1.25, tag='plate', tone=0.85)
    box(waist, -0.75, 0.75, 52.25, 53.75, 2.0, 2.75, tag='plate', **wt)         # spinous processes
    box(waist, -0.75, 0.75, 54.5, 55.75, 2.0, 2.75, tag='plate', **wt)

    # ---- chest: ribcage of stacked rib plates + shoulder girdle (y 56-66.75), shadowed by the collar.
    #      Nothing above y 64.25 in front of z 1 (the jaw swing pocket).
    chest = bone('chest', 'waist', (0, 56, 0))
    ct = dict(tone=0.9, shadow=(61.0, 64.5, 0.15))      # only the strip directly under the collar is shaded
    box(chest, -2.5, 2.5, 56, 64.0, -2.0, 2.5, **ct)                            # core
    ribs = [(-4.25, 56.25, 57.5, -2.75, 3.0), (-4.25, 58.25, 59.5, -3.0, 3.25), (-4.75, 60.25, 61.5, -3.25, 3.25),
            (-5.25, 62.25, 63.5, -3.25, 3.5)]
    for xw, y0, y1, z0, z1 in ribs:
        r = box(chest, xw, -xw, y0, y1, z0, z1, **ct)
        plates(chest, r, 2, rng, faces=('north',), size=(1.0, 1.25), proud=(0.25, 0.5), **ct)
    box(chest, -5.5, 5.5, 63.75, 64.25, -3.25, 3.25, shade={'up': THROAT}, **ct)  # upper chest (centre stays low)
    for sx in (-1, 1):
        box(chest, sx * 4.25, sx * 5.5, 64.25, 66.75, -3.25, 3.25, **ct)         # upper chest flanks
        box(chest, sx * 4.5, sx * 10.0, 63.25, 66.25, -1.75, 1.75)               # shoulder girdle bars
    box(chest, -4.0, 4.0, 64.25, 66.5, 1.0, 3.0, shade={'north': THROAT}, **ct)  # neck base / trapezius
    box(chest, -1.0, 1.0, 57.0, 63.25, -3.75, -2.0, tag='plate', tone=0.95, shadow=(61.0, 64.5, 0.15))  # sternum
    box(chest, -6.0, -1.5, 59.5, 64.0, 3.25, 3.75, tag='plate')                 # scapulae
    box(chest, 1.5, 6.0, 59.5, 64.0, 3.25, 3.75, tag='plate')
    box(chest, -0.75, 0.75, 57.0, 63.0, 3.25, 4.0, tag='plate')                 # dorsal spine ridge
    BONES['chest'].locators['lead'] = (0, 63.0, -4.0)

    # ---- neck: set back behind the jaw swing; its front/top read as the dark throat under the chin
    neck = bone('neck', 'chest', (0, 68, 0))
    # (set back to z >= 3 so the floor of the jaw clears it even at the 55 deg limit)
    box(neck, -2.0, 2.0, 66.0, 69.0, 3.0, 4.25, shade={'north': THROAT, 'up': 0.5}, tone=0.85)


UPPER_TEETH = ((-2.25, -1.5), (-1.0, -0.25), (0.25, 1.0), (1.5, 2.25))      # 0.75 wide, 0.5 gaps (span 4.5)
LOWER_TEETH = ((-2.25, -1.5), (-1.0, -0.25), (0.25, 1.0), (1.5, 2.25))      # same pitch / width as the upper row
EYES = ((-3.0, -1.25), (1.25, 3.0))                                          # 1.75 square, y 77.5-79.25
EYE_Y = (77.5, 79.25)


def build_head():
    # Head box 8 w x 8 d x 12.75 h (y 71.5-84.25; the art measures ~1.6 h/w).  Face (dormant_head / frenzy_head):
    #   forehead 79.25-84.25 | eyes 77.5-79.25 (1.75 sq, centres +-2.125, gap 2.5) | cheek band 75.25-77.5 with a
    #   dark nostril | mouth band 72.5-75.25: 4 upper teeth (74-75.25) hanging from the band, 4 lower teeth
    #   (72.5-73.5, same width), 0.5 dark gap | chin bar 71.5-72.5.  Teeth stand 0.5 proud of the near-black mouth
    #   background (palate / gum front faces at z -3.75); only their front faces glow.
    head = bone('head', 'neck', (0, 72, 1))
    fp = dict(grid='bone', brick=(2.0, 2.0), bond='stacked')   # smooth stone, faint 2 x 2 grid (frenzy_head)
    box(head, -4, 4, 75.25, 84.25, -3.75, 3.5, tag='cranium', dark_faces=('down',), **fp)  # skull
    # face plates framing two recessed glowing eyes (0.25 deep sockets)
    box(head, -4, 4, EYE_Y[1], 84.25, -4.5, -3.75, tag='face', **fp)              # forehead
    box(head, -1.25, 1.25, EYE_Y[0], EYE_Y[1], -4.5, -3.75, tag='face', **fp)     # between the eyes
    box(head, -4, -3, EYE_Y[0], EYE_Y[1], -4.5, -3.75, tag='face', **fp)          # outer eye frames
    box(head, 3, 4, EYE_Y[0], EYE_Y[1], -4.5, -3.75, tag='face', **fp)
    box(head, -4, 4, 75.25, EYE_Y[0], -4.5, -3.75, tag='face', dark_faces=('down',), nose=True, **fp)  # cheek band
    for x0, x1 in EYES:                                                             # glowing eyes
        box(head, x0, x1, EYE_Y[0], EYE_Y[1], -4.25, -4.0, tag='eye')
    # upper mouth: side walls, palate (its front face is the warm-dark closed-mouth background), upper teeth
    box(head, -4, -3, 73.5, 75.25, -4.5, 3.5, tag='face', inner='west', **fp)
    box(head, 3, 4, 73.5, 75.25, -4.5, 3.5, tag='face', inner='east', **fp)
    box(head, -3, 3, 73.5, 75.25, -3.75, 3.5, tag='mouth', stone_faces=('south',), bg_faces=('north',),
        teeth=UPPER_TEETH, **fp)
    for x0, x1 in UPPER_TEETH:
        box(head, x0, x1, 74.0, 75.25, -4.25, -3.75, tag='tooth')
    # inner cheek plates: hidden inside the closed jaw, frame the cavity when the jaw drops
    box(head, -3.75, -3.5, 71.75, 73.5, -3.25, 3.0, tag='mouthwall', inner='west')
    box(head, 3.5, 3.75, 71.75, 73.5, -3.25, 3.0, tag='mouthwall', inner='east')
    head.locators['mouth'] = (0, 73.5, -6.0)

    # ---- jaw (hinged at the back: pivot [0, 73, 3.5]; +X opens)
    jaw = bone('jaw', 'head', (0, 73, 3.5))
    box(jaw, -4, 4, 71.5, 72.5, -4.5, 3.5, tag='face', top='mouth', **fp)         # chin bar / jaw floor
    box(jaw, -4, -3, 72.5, 73.5, -4.5, 3.5, tag='face', inner='west', dark_faces=('up',), **fp)  # jaw side walls
    box(jaw, 3, 4, 72.5, 73.5, -4.5, 3.5, tag='face', inner='east', dark_faces=('up',), **fp)
    box(jaw, -3, 3, 72.5, 72.75, -3.75, 3.5, tag='mouth', stone_faces=('south',), **fp)   # tongue
    box(jaw, -3, 3, 72.75, 73.5, -3.75, -3.25, tag='mouth', bg_faces=('north',), teeth=LOWER_TEETH, **fp)  # gum
    box(jaw, -3, 3, 72.75, 73.5, 2.75, 3.5, tag='mouth', stone_faces=('south',), **fp)    # back wall
    for x0, x1 in LOWER_TEETH:                                                      # 4 lower teeth
        box(jaw, x0, x1, 72.5, 73.5, -4.25, -3.75, tag='tooth')
    # cheek plates rising from the jaw (inside the skull when closed)
    box(jaw, -3.5, -3.25, 72.75, 77.25, -2.5, 3.0, tag='mouthwall', inner='west')
    box(jaw, 3.25, 3.5, 72.75, 77.25, -2.5, 3.0, tag='mouthwall', inner='east')
    box(jaw, -3.5, -3.25, 72.75, 75.25, -3.5, -2.5, tag='mouthwall', inner='west')
    box(jaw, 3.25, 3.5, 72.75, 75.25, -3.5, -2.5, tag='mouthwall', inner='east')


def fb_ray(el, spread, sx, back):
    """unit direction for front (back=False, -Z) / back (+Z) shards: el above horizontal, spread = degrees
    fanned out toward side sx"""
    e, s = math.radians(el), math.radians(spread)
    return (sx * math.cos(e) * math.sin(s), math.sin(e), (1 if back else -1) * math.cos(e) * math.cos(s))


# Side mane (creature's RIGHT side; |x| given, mirrored to the left).  Every shard is AIMED at a front-view
# outline point so the collar reads as an orderly sunburst of ~7 distinct spike points per side with dark
# notches between them (dormant_full / dormant_head), not a fuzzy ruff:
#   ((|x|, y, z) base of the shaft, (|x|, y) tip as seen from the front, azimuth deg (+ = leaning back), w, t)
# The FRONT layer draws the outline; the BACK layer repeats the upper rays further back (aligned with them in
# the front view, so the notches stay open) and fills the side / three-quarter views.  Above the jaw (y > 70.5)
# every base sits behind z = +1.5 and well outside the head, so the head can turn / tilt (look_at, watch) without
# entering the collar, and in profile the head sits in front of the mane (stalk_full / watch_full).
MANE_SIDE_FRONT = [
    ((7.0, 71.25, 4.5), (10.25, 79.75), 16, 4.0, 3.0),   # crown: leaning out ~68 deg, dark gap to the temple
    ((7.5, 70.5, 3.75), (12.75, 77.5), 12, 4.0, 3.0),     # high (~50 deg)
    ((7.75, 69.75, 2.5), (14.75, 74.5), 10, 4.0, 3.0),    # upper (~33 deg)
    ((8.25, 69.0, 1.0), (16.0, 71.25), 2, 4.0, 3.0),      # straight out at chin level (widest)
    ((8.5, 68.0, 0.5), (16.25, 67.75), -8, 4.0, 3.0),     # mid
    ((9.0, 67.0, 0.75), (15.5, 64.5), -4, 3.5, 3.0),      # low: out-down over the arm top
    ((9.25, 66.25, 1.25), (13.5, 61.5), 4, 3.5, 2.5),     # lowest
]
MANE_SIDE_SHOULDER = [   # short chunky shards in front of the collar over the shoulder tops (below the head's sweep)
    ((6.75, 67.75, -1.0), (10.75, 70.25), -15, 3.5, 3.0),
    ((7.25, 66.5, -1.5), (12.0, 66.75), -18, 3.5, 3.0),
]
MANE_SIDE_BACK = [   # tips ~75 % of the way to the matching front-layer tip (inside the front outline)
    ((5.75, 70.25, 5.75), (8.0, 77.25), 40, 4.0, 3.0),    # behind the head: the art's near-temple point
    ((6.75, 69.75, 5.25), (10.75, 75.25), 38, 4.0, 3.0),
    ((7.25, 69.25, 4.75), (12.5, 73.25), 34, 4.0, 3.0),
    ((7.75, 68.5, 4.25), (13.75, 70.25), 30, 4.0, 3.0),
    ((8.25, 67.5, 4.0), (13.75, 66.5), 28, 3.5, 3.0),
]
# Front bib (mane_front): blades hanging down the chest from just below the chin, across the shadowed throat
# recess.  The top tier starts ~10 units from the jaw hinge (outside the jaw's swing) and low enough that the
# head + neck can pitch 35-45 deg down without the chin entering it.  No tip passes z -6.
#   (x, y, z, elevation, spread, length, width, thickness);  x > 0 entries are mirrored
MANE_FRONT = [     # the side blades angle down and INWARD (a chevron converging on the throat column, dormant_head)
    (3.25, 66.75, -5.0, -76, -55, 6.0, 3.0, 2.0),      # top tier, flanking the throat
    (1.0, 67.0, -5.25, -82, 4, 5.0, 2.0, 1.5),         # centre pair hanging across the recess
    (0.0, 64.5, -4.75, -85, 0, 4.5, 2.5, 1.5),         # centre single below them
    (6.25, 66.75, -3.75, -72, -50, 6.5, 3.0, 2.0),     # outer, from the collar edge in toward the sternum
    (8.75, 65.0, -3.25, -76, -10, 5.5, 3.0, 2.0),      # outermost, over the arm root
    (4.5, 63.25, -4.25, -74, -40, 5.0, 3.0, 2.0),      # lower tier, over the ribs
]
# Back (mane_back): a fan rising up and back behind the head to eye level, bushy in the side views
MANE_BACK = [
    (2.25, 69.0, 6.25, 62, 12, 10.0, 4.0, 3.0),       # top row: rising behind the head
    (0.0, 67.25, 6.0, 50, 0, 9.5, 4.0, 3.0),          # centre
    (4.5, 68.25, 5.0, 48, 32, 9.0, 4.0, 3.0),         # upper-mid, fanned out
    (2.25, 65.0, 5.0, 30, 14, 8.5, 4.0, 3.0),         # lower-mid
    (0.0, 61.75, 4.75, 12, 0, 7.5, 3.5, 3.0),         # low
    (3.0, 60.75, 4.5, 0, 22, 6.5, 3.5, 2.5),          # low flanks
]


BIB_SHADOW = (65.0, 68.5, 0.35)     # the bib's upper ends sit in the shadow of the chin (dormant_head)


def build_mane():
    """Collar of chunky stepped shards radiating like a sunburst around the neck (dormant_full / dormant_head):
    ~7 distinct points per side from beside the head (leaning out, a dark gap to the temple) through straight
    out at chin level (widest, x +-16) to out-down over the arm tops; blades hanging down the front from just
    below the chin; a fan rising up/back behind the head."""
    rng = Rng(202)
    bone('mane_front', 'chest', (0, 65, -3))
    bone('mane_back', 'chest', (0, 66, 3))
    bone('mane_left', 'chest', (6, 66, 0))
    bone('mane_right', 'chest', (-6, 66, 0))

    def aimed(owner, sx, base, tip, az, w, t):
        bx, by, bz = base
        tx, ty = tip[0] + rng.u(-0.2, 0.2), tip[1] + rng.u(-0.2, 0.2)
        dx, dy = tx - bx, ty - by
        dz = abs(dx) * math.tan(math.radians(az + rng.u(-2, 2)))
        L = math.sqrt(dx * dx + dy * dy + dz * dz)
        # rolled 45 deg about its own axis: from the front each shard shows a lit upper facet and a dark underside
        shard(owner, (sx * bx, by, bz), (sx * dx, dy, dz), L, w=w, t=t, up=(0.0, 0.7071, -0.7071))

    for sx, owner in ((-1, 'mane_right'), (1, 'mane_left')):
        for base, tip, az, w, t in MANE_SIDE_BACK:
            aimed(owner, sx, base, tip, az, w, t)
        for base, tip, az, w, t in MANE_SIDE_FRONT + MANE_SIDE_SHOULDER:
            aimed(owner, sx, base, tip, az, w, t)
        # collar bulk under the shards (keeps the ruff solid; inner face at |x| 4.5, below the jaw)
        box(owner, sx * 4.5, sx * 9.25, 64.5, 68.75, -0.75, 4.0, tag='spike', tone=0.62)

    for (x, y, z, el, sp, L, w, t) in MANE_FRONT:
        for sx in ((-1, 1) if x > 0 else (1,)):
            d = fb_ray(el + rng.u(-1.5, 1.5), sp + rng.u(-2, 2), sx, back=False)
            # outer blades rolled (lit outer facet); the ones next to the throat stay flat so nothing passes z -6
            up = (0.0, 0.0, -1.0) if x < 4.0 else (sx * 0.5, 0.5, -0.7071)
            shard('mane_front', (sx * x, y, z), d, L, w=w, t=t, embed=1.0, up=up, shadow=BIB_SHADOW)
    for sx in (-1, 1):
        box('mane_front', sx * 4.75, sx * 7.0, 63.5, 67.5, -4.0, -2.25, tag='spike', tone=0.62, shadow=BIB_SHADOW)
    box('mane_front', -4.25, 4.25, 59.5, 63.0, -4.0, -2.25, tag='spike', tone=0.7)

    for (x, y, z, el, sp, L, w, t) in MANE_BACK:
        for sx in ((-1, 1) if x > 0 else (1,)):
            d = fb_ray(el + rng.u(-1.5, 1.5), sp + rng.u(-2, 2), sx, back=True)
            shard('mane_back', (sx * x, y, z), d, L + q(rng.u(-0.25, 0.25)), w=w, t=t, front_shade=THROAT)
    box('mane_back', -5.0, 5.0, 60.0, 68.5, 2.75, 4.5, tag='spike', tone=0.8, front_shade=THROAT)


AX = -12.0     # right arm axis: cubes sit 1 unit outside the (fixed) bone pivots at x = -11 (art shoulder width)


def build_arm_right():
    rng = Rng(303)
    au = bone('arm_right_upper', 'chest', (-11, 65, 0))
    cap = box(au, AX - 2.25, AX + 2.25, 61.0, 67.0, -2.25, 2.25)                 # shoulder block (under the spikes)
    plates(au, cap, 2, rng, faces=LAT_FACES, size=(1.0, 2.0), proud=(0.5, 0.75), yrange=(61.0, 64.0))
    # slim upper arm (3.5-3.75), outline stepping every ~3.75 units
    stack(au, AX, 0, [(61.0, 57.25, 3.5, 3.5, 0.25, 0.0), (57.25, 53.5, 3.75, 3.5, -0.25, 0.25),
                      (53.5, 49.75, 3.5, 3.75, 0.25, -0.25), (49.75, 46.0, 3.75, 3.5, -0.25, 0.0)],
          0.0, rng, plates_per=2, plate_faces=LAT_FACES, proud=(0.5, 0.75))

    al = bone('arm_right_lower', 'arm_right_upper', (-11, 45, 0))
    box(al, AX - 2.5, AX + 2.5, 43.0, 47.0, -2.0, 2.5)                           # elbow block (5 x 4.5)
    box(al, AX - 3.0, AX + 2.75, 45.0, 47.25, -2.75, 3.0, tag='plate')           # cuff ring (0.5 proud, 0.25 medial)
    box(al, AX - 1.5, AX + 1.5, 43.5, 46.75, 3.0, 3.5, tag='plate')              # olecranon
    sootf = ('y', 37.0, 31.0, 0.5)                                               # soot only near the wrist
    # forearm flares gently toward the wrist: 5.0 -> 5.25 -> 5.5 wide (~1.4 x the upper arm, slimmer than the shin)
    stack(al, AX, 0.25, [(43.0, 39.0, 5.0, 4.75, -0.25, 0.0), (39.0, 35.0, 5.25, 5.0, 0.0, 0.25),
                         (35.0, 31.0, 5.5, 5.25, -0.25, 0.0)],
          0.0, rng, plates_per=2, plate_faces=LAT_FACES, proud=(0.5, 0.5), soot=sootf)

    # hand: short palm that flares from the wrist (5 wide) to the knuckle row (8 wide, dormant_hands), palm faces
    # front (-Z); long thick fingers curled into a hooked cage
    hand = bone('hand_right', 'arm_right_lower', (-11, 31, 0))
    hs = ('const', 0.42)
    box(hand, AX - 2.5, AX + 2.25, 29.0, 31.5, -2.0, 2.25, soot=hs)              # wrist
    box(hand, AX - 3.25, AX + 2.75, 27.75, 29.0, -1.25, 1.5, soot=hs)            # palm (upper)
    box(hand, AX - 5.0, AX + 3.0, 26.5, 27.75, -1.25, 1.5, soot=hs)              # knuckle row
    box(hand, AX - 2.75, AX + 2.25, 26.75, 29.0, 1.5, 2.0, tag='plate', soot=hs)  # back of the hand
    box(hand, AX - 1.75, AX + 1.25, 27.25, 28.75, 2.0, 2.25, tag='plate', soot=hs)
    box(hand, AX - 2.5, AX + 2.0, 27.0, 28.75, -1.5, -1.25, tag='plate', soot=hs)  # palm pad
    box(hand, AX - 3.5, AX - 3.25, 27.75, 29.0, -0.75, 1.25, tag='plate', soot=hs)  # outer edge
    # four fingers: 1 = most medial (toward the body) ... 4 = most lateral, knuckles y 26.75.  Proximal 2.0 wide x
    # 2.25 deep, ~6.25 + 4.75 + 6.25 claw (claws ~40 % of the finger); curl -12 .. -78 deg hooks the claws forward,
    # tips at mid / lower shin height.  Lateral fingers fan out (span ~13); finger 1 stays straight so it clears
    # the shin at rest.
    specs = [  # knuckle x, la, lb, claw, splay(a, b, (claw0..2)), curl(a, b, claw0..2)
        (-10.0, 6.0, 4.75, 6.0, (2, 3, (6, 10, 14)), (-14, -27, -40, -54, -66)),
        (-12.0, 6.25, 5.0, 6.5, (7, 6, (2, -2, -6)), (-12, -25, -38, -52, -66)),
        (-14.0, 6.25, 5.0, 6.5, (15, 12, (2, -6, -14)), (-12, -25, -38, -52, -66)),
        (-16.0, 6.0, 4.75, 6.0, (30, 26, (12, 0, -12)), (-14, -27, -40, -54, -68)),
    ]
    tips = []
    for i, (x, la, lb, lc, sp, cu) in enumerate(specs):
        tips.append(finger('hand_right', f'finger_right_{i + 1}_a', f'finger_right_{i + 1}_b', (x, 26.75, 0.0),
                           la, lb, lc, sp, cu, w=2.0, d=2.25, soot=0.40))
    # thumb on the medial front edge of the palm: short, curls down and in toward the palm centre
    tips.append(finger('hand_right', 'thumb_right_a', 'thumb_right_b', (-9.75, 28.0, -1.25), 3.5, 2.75, 4.0,
                       (6, 14, (24, 34, 44)), (-24, -18, -24, -32, -40), w=1.75, d=1.75, soot=0.45))
    tip = np.mean(np.array(tips[:4]), axis=0)
    hand.locators['claw_right'] = qv((tip[0], tip[1] - 1.0, tip[2] - 1.0))
    TIPS['right'] = tips


TIPS = {}


def build_leg_right():
    rng = Rng(404)
    # ---- thigh: slim (3.75-4 wide), inner edge at |x| >= 3.75 so the gap between the thighs stays >= 7.5;
    #      plates only on the outer / front / back faces
    lu = bone('leg_right_upper', 'body', (-5, 47, 0))
    box(lu, -7.5, -3.75, 44.25, 48.5, -2.25, 2.25)                               # hip joint block (in the pelvis)
    box(lu, -8.25, -7.5, 43.0, 47.0, -1.75, 1.75, tag='plate')                    # hip plate
    stack(lu, -5.625, 0, [(44.25, 40.5, 3.75, 4.0, 0, 0), (40.5, 36.75, 4.0, 4.0, -0.25, 0.25),
                          (36.75, 33.0, 3.75, 4.25, 0, -0.25), (33.0, 29.75, 4.0, 4.0, -0.25, 0)],
          0, rng, plates_per=2, plate_faces=LAT_FACES, proud=(0.5, 0.75))

    # ---- shin: thicker than the thigh, flaring like a tree trunk into the root base (dormant_feet: ~6.5 wide at
    #      y 16, ~8 at y 11, ~10 at y 7 incl. the root buttresses), soot streaks on its lower half
    ll = bone('leg_right_lower', 'leg_right_upper', (-5, 28, 0))
    soot = ('y', 18.0, 6.0, 0.88)
    box(ll, -8.25, -3.25, 26.0, 30.25, -3.0, 2.25, soot=soot)                     # knee block (kneecap forward)
    box(ll, -6.75, -4.5, 26.75, 29.5, -3.5, -3.0, tag='plate', soot=soot)
    shin = [(22.5, 26.0, -8.25, -3.0, -2.5, 2.5), (18.5, 22.5, -8.5, -2.5, -2.75, 2.75),
            (14.0, 18.5, -8.75, -2.25, -3.0, 3.0), (10.0, 14.0, -9.75, -1.5, -3.25, 3.25),
            (6.5, 10.0, -10.25, -1.25, -3.5, 3.75)]
    for y0, y1, x0, x1, z0, z1 in shin:
        s = box(ll, x0, x1, y0, y1, z0, z1, soot=soot)
        # no proud plates on the outer face where the claws hang at rest; none at all on the root-ridged base
        if y0 >= 14:
            plates(ll, s, 2, rng, faces=('north', 'south'), size=(1.25, 2.5), proud=(0.5, 0.75), soot=soot)
    # root ridges: each toe-root continues up the lower shin as a proud buttress that fades out around y 16-17,
    # so the shin flares like a bell into the foot
    for x0, x1, y1 in ((-6.75, -5.5, 16.5), (-4.25, -2.75, 16.0), (-9.75, -8.25, 17.0)):
        box(ll, x0, x1, 5.0, y1, -4.25, -3.5, tag='plate', soot=soot)
    box(ll, -11.25, -10.5, 5.0, 12.0, -1.25, 0.75, tag='plate', soot=soot)         # outer ridge
    box(ll, -9.0, -8.75, 10.0, 16.0, -1.0, 0.5, tag='plate', soot=soot)            # its upper fade
    box(ll, -1.25, -0.75, 5.0, 11.0, -1.0, 0.5, tag='plate', soot=soot)            # medial ridge
    box(ll, -6.75, -5.25, 5.0, 13.0, 3.75, 4.5, tag='plate', soot=soot)            # rear ridge
    box(ll, -10.0, -8.75, 5.0, 10.5, 3.75, 4.5, tag='plate', soot=soot)            # rear-outer ridge

    # ---- foot: flared root base (~12.75 wide, balanced about the shin axis): ankle core + 3 tall front toe-roots
    #      separated by thin dark crevices, an outer and a medial root (5 root-toes across the front view) and a
    #      rear spur.  Inner edge x -0.75 at rest (1.5 gap between the feet; wider once the dormant pose splays them)
    ft = bone('foot_right', 'leg_right_lower', (-5, 6, 0))
    fs = ('y', 9.0, 0.0, 0.62)
    core = box(ft, -10.5, -2.25, 0.0, 6.75, -3.75, 4.0, soot=fs)
    roots = [  # stepped blocks (x0, x1, y0, y1, z0, z1), optional Y splay about the root's back
        ([(-7.25, -4.75, 0.0, 4.5, -7.5, -3.75), (-7.0, -5.0, 4.5, 6.5, -5.5, -3.75)], None, None),   # front centre
        ([(-4.25, -2.0, 0.0, 4.5, -7.25, -3.75), (-4.0, -2.25, 4.5, 6.25, -5.25, -3.75)], None, None),  # front medial
        ([(-10.0, -7.75, 0.0, 4.5, -7.25, -3.75), (-9.75, -8.0, 4.5, 6.5, -5.25, -3.75)],
         (0, 20, 0), (-8.75, 0, -3.75)),                                                              # front lateral
        ([(-13.5, -10.25, 0.0, 4.0, -1.25, 1.0), (-12.0, -10.25, 4.0, 5.5, -1.0, 0.75)],
         (0, -20, 0), (-10.5, 0, 0)),                                                                 # outer (~70 deg)
        ([(-2.25, -0.75, 0.0, 3.5, -3.5, 0.5), (-2.25, -1.25, 3.5, 5.0, -2.75, 0.0)], None, None),    # medial flare
        ([(-7.0, -4.75, 0.0, 3.0, 4.0, 7.5), (-6.75, -5.0, 3.0, 4.75, 4.0, 5.75)], None, None),       # rear spur
    ]
    for blocks, rot, piv in roots:
        kw = dict(rot=rot, pivot=piv) if rot else {}
        for i, (x0, x1, y0, y1, z0, z1) in enumerate(blocks):
            box(ft, x0, x1, y0, y1, z0, z1, tag='stone' if i == 0 else 'plate', soot=fs, **kw)
    box(ft, -10.0, -8.5, 0.0, 4.25, 4.0, 5.5, tag='plate', soot=fs, rot=(0, 30, 0), pivot=(-9.25, 0, 4.0))  # rear-outer root
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


def _inside_any(pw, skip=(), bones=None):
    """is world (rest pose) point pw strictly inside any cube (of `bones`, default: all bones)?"""
    for b in BONES.values():
        if bones is not None and b.name not in bones:
            continue
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
    Overlaps buried inside other geometry of the SAME two bones are ignored (a third, independently animated
    bone -- e.g. a mane flap -- may move away and expose them)."""
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
                    if not _inside_any(pw, skip=(c1, c2), bones=(c1.bone, c2.bone)):
                        buried = False
                        break
                if not buried:
                    issues.append((c1, f1, c2, f2))
    return issues


JAW_POSES = ((0, 40), (0, 55), (-20, 55), (-35, 55), (20, 30), (35, 0))   # (head X, jaw X) degrees


def check_jaw_sweep():
    """Pose head + jaw (rotations about their pivots, file convention) and return the cubes of other bones whose
    sample points fall inside the open-mouth cavity (below the palate, above the tongue, between the walls)."""
    hp, jp = np.array(BONES['head'].pivot), np.array(BONES['jaw'].pivot)
    g = (np.arange(4) + 0.5) / 4
    grid = np.array([[a, b, c] for a in g for b in g for c in g])
    bad = []
    for hx, jx in JAW_POSES:
        Rh, Rj = rot_matrix((hx, 0, 0)), rot_matrix((jx, 0, 0))
        for b in BONES.values():
            if b.name in ('head', 'jaw'):
                continue
            for c in b.cubes:
                pw = c.to_world(np.array(c.lo) + grid * np.array(c.size))
                ph = (pw - hp) @ Rh + hp                 # world -> head rest frame
                pj = (ph - jp) @ Rj + jp                 # head -> jaw rest frame
                cav = (np.abs(ph[:, 0]) < 3.0) & (ph[:, 1] < 73.5) & (ph[:, 2] > -4.5) & (ph[:, 2] < 3.5) & \
                      (pj[:, 1] > 72.75) & (pj[:, 2] > -4.5)
                if cav.any():
                    bad.append(((hx, jx), c, int(cav.sum())))
    return bad


def check_jaw_solid(angles=(20, 40, 55)):
    """the jaw itself (all its cubes) opened to 20 / 40 / 55 deg must not enter any cube of the neck / torso / mane
    (rest pose).  Returns [(angle, other cube, sample hits)]."""
    jp = np.array(BONES['jaw'].pivot)
    g = (np.arange(5) + 0.5) / 5
    grid = np.array([[a, b, c] for a in g for b in g for c in g])
    others = [o for b in BONES.values() if b.name not in ('head', 'jaw') for o in b.cubes]
    bad = []
    for ang in angles:
        Rj = rot_matrix((ang, 0, 0))
        pts = np.concatenate([c.to_world(np.array(c.lo) + grid * np.array(c.size)) for c in BONES['jaw'].cubes])
        pw = (pts - jp) @ Rj.T + jp
        for o in others:
            loc = pw if not o.rot else (pw - np.array(o.pivot)) @ o.matrix() + np.array(o.pivot)
            k = int(np.all((loc > np.array(o.lo) + 0.02) & (loc < np.array(o.hi) - 0.02), axis=1).sum())
            if k:
                bad.append((ang, o, k))
    return bad


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


PAL = {   # SPEC section 5 albedo (unlit): dusky "mauve-taupe" granite -- a low-chroma pinkish grey (hue ~335 deg, sat ~0.14).
    #   Under warm cave light (renderer --bg mine) it reads as the art's warm pink-brown (masked compare vs
    #   dormant_torso: hue ~15 deg like the art); the SPEC's warmer #96766c turns salmon-orange under that light.
    'base': hexc('#8c7882'), 'light': hexc('#bcaab0'), 'dark': hexc('#4a3a3e'), 'soot': hexc('#2a201e'),
    'spike': hexc('#968589'), 'spike_top': hexc('#b4a2a6'), 'spike_bevel': hexc('#c2b0b4'),
    'spike_down': hexc('#4e3c40'), 'claw': hexc('#1e1714'), 'claw_tip': hexc('#5a4a42'), 'claw_edge': hexc('#4a3c36'),
    'mouth': hexc('#120c0a'), 'mouth_bg': hexc('#1c120e'), 'mouth_rim': hexc('#241812'),
    'tooth_spill': hexc('#3a2418'), 'tooth_side': hexc('#6e5242'),
    'eye_core': hexc('#fff4dc'), 'eye_edge': hexc('#ffe6c0'), 'eye_rim': hexc('#ffb05a'), 'eye_halo': hexc('#c8805e'),
    'tooth': hexc('#fff0d8'), 'tooth_edge': hexc('#f2d6ae'), 'nostril': hexc('#2a1a14'),
}


WARM_B = 1.10     # stone texels: blue <= WARM_B * green and <= 0.96 * red (mauve, never blue-grey)


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
    """per-texel brick id, and distances (texels) to the brick's top/left/bottom/right seam.
    'cube' grid: fixed-size bricks (bw x bh units) on every face, rows starting at the face's top edge, the last
    row / column cut by the face edge -> the same brick scale on every limb segment and spike.
    'bone' grid: world-aligned rows/columns, continuous across neighbouring plates (the face)."""
    bw, bh = brick
    grid = c.paint.get('grid', 'cube')
    if f in SIDE_FACES and grid == 'bone':
        horiz = P[..., 0] if f in ('north', 'south') else P[..., 2]
        if f in ('south', 'east'):
            horiz = -horiz
        vert = -P[..., 1]
        rows = np.floor(vert / bh).astype(int)
        rv = (vert / bh - rows) * bh * TPU
        off = 0.0 if c.paint.get('bond') == 'stacked' else (rows % 2) * 0.5 * bw
        cols = np.floor((horiz + off) / bw).astype(int)
        cu = ((horiz + off) / bw - cols) * bw * TPU
        top, left = rv, cu
        bot, right = bh * TPU - rv, bw * TPU - cu
        return rows * 997 + cols, top, left, bot, right
    rh = int(round((bh if f in SIDE_FACES else bw) * TPU))
    cwid = bw * TPU
    jj = np.arange(H)
    ii = np.arange(W)
    row = jj // rh
    nrow = row.max() + 1
    if nrow > 1 and H - (nrow - 1) * rh < 3:            # no sliver row at the bottom edge
        row = np.minimum(row, nrow - 2)
    row_top = row * rh
    row_bot = np.where(row == row.max(), H, (row + 1) * rh)
    top_r = jj - row_top
    bot_r = row_bot - 1 - jj
    rid = np.zeros((H, W), int)
    L = np.zeros((H, W))
    R = np.zeros((H, W))
    stacked = c.paint.get('bond') == 'stacked'
    fo = 0.0 if stacked else hash01(c.seed, FACES.index(f)) * cwid
    for r in range(int(row.max()) + 1):
        # courses mostly line up (a near-square tile grid, dormant_torso), each shifted by a random 0..1/2 brick
        off = fo + (0.0 if stacked else hash01(c.seed, FACES.index(f), r, 9) * 0.5 * cwid)
        pos = (ii + off) / cwid
        col = np.floor(pos).astype(int)
        frac = (pos - col) * cwid
        sel = row == r
        rid[sel, :] = r * 101 + col[None, :]
        L[sel, :] = frac[None, :]
        R[sel, :] = np.minimum(cwid - frac - 1, W - 1 - ii)[None, :]
    T = np.repeat(top_r[:, None], W, 1).astype(float)
    B = np.repeat(bot_r[:, None], W, 1).astype(float)
    return rid, T, L, B, R


AO_CUBES = {}
AO_EXTRA = {}
# cross-bone contact shading (rest pose, half weight) between bones that barely move relative to each other
AO_PAIRS = {
    'body': ('leg_right_upper', 'leg_left_upper', 'waist'),
    'leg_right_upper': ('body',), 'leg_left_upper': ('body',),
    'waist': ('body', 'chest'),
    'chest': ('mane_front', 'mane_back', 'mane_left', 'mane_right', 'neck', 'waist'),
    'neck': ('head', 'jaw', 'chest', 'mane_back'),
    'arm_right_upper': ('mane_right', 'chest'), 'arm_left_upper': ('mane_left', 'chest'),
    'mane_front': ('chest', 'mane_left', 'mane_right'), 'mane_back': ('chest', 'mane_left', 'mane_right'),
    'mane_left': ('chest', 'mane_front', 'mane_back'), 'mane_right': ('chest', 'mane_front', 'mane_back'),
}


def _occlusion(c, cands, S, lo_box, hi_box):
    occ = np.zeros(S.shape[0])
    for o in cands:
        if o is c:
            continue
        if np.any(o.wlo > hi_box) or np.any(o.whi < lo_box):
            continue
        if o.rot:
            loc = (S - np.array(o.pivot)) @ o.matrix() + np.array(o.pivot)   # inverse rotation (R^T as row @ R)
        else:
            loc = S
        inside = np.all((loc > np.array(o.lo) + 1e-6) & (loc < np.array(o.hi) - 1e-6), axis=-1)
        occ = occ + inside.mean(1)
    return occ


def ambient_occlusion(c, Pw, Nw):
    """cheap AO: fraction of hemisphere sample points inside other cubes of the same bone (full weight) or of a
    static-ish neighbouring bone (AO_PAIRS, half weight)"""
    cands = AO_CUBES.get(c.bone, [])
    extra = AO_EXTRA.get(c.bone, [])
    H, W, _ = Pw.shape
    pts = Pw.reshape(-1, 3)
    n = Nw / np.linalg.norm(Nw)
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
    S = pts[:, None, :] + samples[None, :, :] + n[None, None, :] * 0.05
    occ = _occlusion(c, cands, S, lo_box, hi_box) + 0.5 * _occlusion(c, extra, S, lo_box, hi_box)
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
    for name, others in AO_PAIRS.items():
        if name in AO_CUBES:
            AO_EXTRA[name] = [o for on in others if on in AO_CUBES for o in AO_CUBES[on]]


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


def _ring(P, rects, lo, hi):
    """texels whose (x, y) lies between `lo` and `hi` units outside any of the rectangles (x0, x1, y0, y1)"""
    out = np.zeros(P.shape[:2], bool)
    for x0, x1, y0, y1 in rects:
        dx = np.maximum(np.maximum(x0 - P[..., 0], P[..., 0] - x1), 0)
        dy = np.maximum(np.maximum(y0 - P[..., 1], P[..., 1] - y1), 0)
        dd = np.maximum(dx, dy)
        out |= (dd > lo) & (dd <= hi)
    return out


def _blocky(v, step=0.5):
    """snap a world coordinate to `step`-unit columns (2 real texels) so soot streaks follow the block grid"""
    return np.floor(v / step) * step + step / 2


def paint_spike(c, f, W, H, P, I, J, Pw, Nw, seed):
    """mane shard: smooth stone lit from above (no bricks / mortar): up-facing facets light, vertical faces base,
    down-facing faces dark; a 1-texel light edge on the upper long edge and the leading (tip-side) edge of every
    step, a 1-texel dark seam where two segments meet."""
    ny = Nw[1]
    piv = c.pivot or (0, 0, 0)
    st = 1.0 + (hash01(int(piv[0] * 4) & 0xffff, int(piv[1] * 4), int(piv[2] * 4) & 0xffff, 5) - 0.5) * 0.08
    tone = c.paint.get('tone', 1.0) * st
    ku = float(np.clip(ny / 0.7, 0, 1))
    kd = float(np.clip(-ny / 0.7, 0, 1)) * 0.7       # the engine darkens down faces too: keep them stone, not black
    base = PAL['spike'] * (1 - ku) + PAL['spike_top'] * ku
    base = base * (1 - kd) + PAL['spike_down'] * kd
    col = np.broadcast_to(base * tone, (H, W, 3)).copy()
    drift = NZ_TONE(Pw[..., 0] * 0.35, Pw[..., 1] * 0.35, Pw[..., 2] * 0.35)
    grain = NZ_GRAIN(Pw[..., 0] * 5.0, Pw[..., 1] * 5.0, Pw[..., 2] * 5.0)
    rnd = np.random.default_rng(seed).uniform(-1, 1, (H, W))
    col *= (1 + 0.05 * drift + 0.035 * grain + 0.012 * rnd)[..., None]
    sl = c.paint.get('spike_len')
    if sl:                                            # a little darker at the root, lighter toward the tip
        y_loc = P[..., 1] - c.pivot[1]
        tt = np.clip((y_loc - sl[2]) / (sl[3] - sl[2]), 0, 1)
        col *= (0.88 + 0.16 * tt)[..., None]
    seg = c.paint.get('spike_seg')
    if f in SIDE_FACES and seg:
        i, n = seg
        if ny > -0.45:
            e0, e1 = Pw[:, 0, 1].mean(), Pw[:, -1, 1].mean()
            if abs(e0 - e1) > 0.05:
                edge = (I < 0.26) if e0 > e1 else (I > I.max() - 0.26)
                col[edge] = col[edge] * 0.45 + PAL['spike_bevel'] * 0.55
            lead = J < 0.26
            col[lead] = col[lead] * 0.6 + PAL['spike_bevel'] * 0.4
        if i > 0:
            seam = J > J.max() - 0.26
            col[seam] = col[seam] * 0.3 + PAL['dark'] * 0.7
    elif f in SIDE_FACES:                             # collar bulk: catch-light on the top edge only
        col[J < 0.26] *= 1.06
    fs = c.paint.get('front_shade')                   # faces turned toward the back of the head / throat
    if fs and Nw[2] < -0.3:
        col *= fs
    sh = c.paint.get('shadow')                        # baked shadow under the chin (no self-shadowing in game)
    if sh:
        y0, y1, amt = sh
        col *= (1 - amt * np.clip((Pw[..., 1] - y0) / (y1 - y0), 0, 1))[..., None]
    ao = ambient_occlusion(c, Pw, Nw)
    col *= ao[..., None]
    col[..., 2] = np.minimum(np.minimum(col[..., 2], col[..., 1] * WARM_B), col[..., 0] * 0.96)
    return col


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
    g3 = NZ_GRAIN(Pw[..., 0] * 3, Pw[..., 1] * 3, Pw[..., 2] * 3)

    shade = c.paint.get('shade', {}).get(f)      # shadow factor for this face (throat seen under the chin)
    # closed-mouth background (palate / gum front): near-black, a faint warm spill only directly beside each tooth
    # (none in the gap between the two rows, which stays dark)
    if tag == 'mouth' and f in c.paint.get('bg_faces', ()):
        rgb[:] = PAL['mouth_bg'] * (1 + 0.12 * g3)[..., None]
        rim = (I < 0.26) | (I > I.max() - 0.26)
        rgb[rim] = PAL['mouth_rim']
        teeth = c.paint.get('teeth', ())
        ty0 = 74.0 if c.lo[1] >= 73.4 else c.lo[1]      # palate: upper teeth hang 74-75.25; gum: lower teeth below
        ty1 = c.hi[1] if c.lo[1] >= 73.4 else 73.5
        beside = _ring(P, [(x0, x1, ty0, ty1) for x0, x1 in teeth], 0.0, 0.26)
        beside &= (P[..., 1] > ty0) & (P[..., 1] < ty1)
        rgb[beside] = PAL['tooth_spill']
        return np.dstack([rgb, alpha])
    dark = (tag == 'mouth' and f not in c.paint.get('stone_faces', ())) or f == c.paint.get('inner') or \
        f in c.paint.get('dark_faces', ()) or (f == 'up' and c.paint.get('top') == 'mouth') or \
        (tag == 'mouthwall' and f in ('north', 'up'))
    if tag == 'mouth' and not dark:
        tag = 'face'
    if dark:
        rgb[:] = PAL['mouth'] * (1 + 0.25 * g3)[..., None]
        return np.dstack([rgb, alpha])
    if tag == 'tooth':
        if f != 'north':
            # sides / top / bottom: opaque warm brown, so the teeth stay separate slits at oblique angles
            rgb[:] = PAL['tooth_side'] * (1 + 0.08 * g3)[..., None]
            return np.dstack([np.clip(rgb, 0, 255), alpha])
        # front: bright warm-white glow (alpha 35 = ~86 % emissive), barely darker toward the root, warmer edges
        v = J / max(J.max(), 1e-6)
        rgb[:] = PAL['tooth'] * (1.0 - 0.04 * v)[..., None]
        edge = (I < 0.26) | (I > I.max() - 0.26)
        rgb[edge] = PAL['tooth_edge']
        alpha[:] = 35
        return np.dstack([np.clip(rgb, 0, 255), alpha])
    if tag == 'eye':
        # square white-hot eye: warm-white core filling most of the square, 1-texel warm rim.
        # alpha 10 (core) .. 30 (rim): ~96 % glow, and robust against editors that zero alpha-0 RGB
        dd = np.minimum(np.minimum(I, I.max() + 0.125 - I), np.minimum(J, J.max() + 0.125 - J)) * TPU  # texels to edge
        core = np.clip((dd - 0.5) / 1.0, 0, 1)
        cen = np.clip((dd - 1.5) / 2.0, 0, 1)
        inner = PAL['eye_edge'] * (1 - cen[..., None]) + PAL['eye_core'] * cen[..., None]
        rim = PAL['eye_rim'] * 0.5 + PAL['eye_edge'] * 0.5
        rgb[:] = rim * (1 - core[..., None]) + inner * core[..., None]
        alpha[:] = 30 - 20 * core
        return np.dstack([rgb, alpha])
    if tag == 'claw':
        # near-black (#1e1714) at the root, lightening over the last ~40 % of the claw to a charcoal-brown point
        # (~#5a4a42); thin lighter edges on the top face and the lateral edge so the hooks read in silhouette
        k = c.paint.get('claw_k', 0)
        g = NZ_GRAIN(Pw[..., 0] * 4, Pw[..., 1] * 4, Pw[..., 2] * 4)
        base = PAL['claw'] * (1.0 + 0.12 * g)[..., None]
        v = J / max(J.max(), 1e-6) if f in SIDE_FACES else np.full((H, W), 0.5)
        u = (k + v) / 4.0                                 # 0 at the claw root .. 1 at the point
        m = np.clip((u - 0.55) / 0.45, 0, 1) ** 1.2 * 0.85
        base = base * (1 - m[..., None]) + PAL['claw_tip'] * (1.0 + 0.1 * g)[..., None] * m[..., None]
        if f in SIDE_FACES:
            edge = I < 0.3
            base[edge] = base[edge] * 0.5 + PAL['claw_edge'] * 0.5
        if f == 'up':
            base = base * 0.5 + PAL['claw_edge'] * 0.5
        rgb[:] = np.minimum(base, np.array([96, 80, 72]))
        return np.dstack([np.clip(rgb, 0, 255), alpha])
    if tag == 'spike':
        return np.dstack([np.clip(paint_spike(c, f, W, H, P, I, J, Pw, Nw, seed), 0, 255), alpha])

    # ---------------- stone family (stone / plate / band / face / cranium / mouthwall)
    headish = tag in ('face', 'cranium', 'mouthwall')
    brick = c.paint.get('brick', (1.25, 1.25))
    rid, T, L, B, R = brick_layout(c, f, W, H, P, brick)
    up_amt = Nw[1]
    if tag == 'plate':
        base = PAL['base'] * (1.0 + 0.07 * (hash01(c.seed, 3) - 0.45))
    elif tag == 'band':
        base = PAL['light'] * 0.93
    elif tag == 'mouthwall':
        base = PAL['base'] * 0.82                      # lit stone side wall of the open mouth
    else:
        base = PAL['base'].copy()
    base = base * c.paint.get('tone', 1.0) * (shade or 1.0)
    # per-brick tone: warm hues only; low-contrast (+-8 %, rare outliers) on the body, +-4 % on the head
    uniq = np.unique(rid)
    tone = np.ones((H, W))
    hue = np.zeros((H, W))
    spread, p_lo, p_hi, k_lo, k_hi = (0.16, 0.04, 0.96, 0.85, 1.1)
    if headish:
        spread, p_lo, p_hi, k_lo, k_hi = (0.08, 0.0, 1.0, 1.0, 1.0)
    for uu in uniq:
        h1 = hash01(seed, uu, 1)
        h2 = hash01(seed, uu, 2)
        t = 1.0 + (h1 - 0.5) * spread
        if h2 < p_lo:
            t *= k_lo
        elif h2 > p_hi:
            t *= k_hi
        sel = rid == uu
        tone[sel] = t
        hue[sel] = (hash01(seed, uu, 3) - 0.3) * 0.04          # never cooler than the base
    col = base[None, None, :] * tone[..., None]
    col[..., 0] *= 1 + hue
    col[..., 2] *= 1 - hue
    # large-scale tonal drift + granite grain + rare dark 2x1 chips (no single-texel pepper)
    drift = NZ_TONE(Pw[..., 0] * 0.35, Pw[..., 1] * 0.35, Pw[..., 2] * 0.35)
    col *= (1 + 0.06 * drift)[..., None]
    grain = NZ_GRAIN(Pw[..., 0] * 5.0, Pw[..., 1] * 5.0, Pw[..., 2] * 5.0)
    rnd = np.random.default_rng(seed).uniform(-1, 1, (H, W))
    col *= (1 + 0.03 * grain + (0.015 if headish else 0.022) * rnd)[..., None]
    if not headish and W > 2:
        chip = np.random.default_rng(seed + 7).uniform(0, 1, (H, W)) < 0.003
        chip[:, 1:] |= chip[:, :-1].copy()
        col[chip] *= 0.82
    # soft bevel per brick (lighter first row / column inside the seam, darker bottom / right); none on the head
    if not headish:
        bev = np.zeros((H, W))
        bev += np.where((T >= 1) & (T < 2), 0.06, 0) + np.where((L >= 1) & (L < 2), 0.03, 0)
        bev -= np.where(B < 1, 0.07, 0) + np.where(R < 1, 0.04, 0)
        col *= (1 + bev)[..., None]
    # faint mortar seams: a 1-texel line on the top / left of every brick; faces of very small cubes get none
    mortar = (T < 1) & (H > 4)
    mortar |= (L < 1) & (W > 4)
    if f in SIDE_FACES and c.paint.get('grid', 'cube') == 'cube':
        mortar &= ~(J < 0.26)                       # the cube's own top edge stays crisp
    mcol = PAL['dark'] * (0.9 + 0.2 * np.random.default_rng(seed + 3).uniform(0, 1, (H, W)))[..., None]
    if headish:
        mix = 0.35
    else:
        mix = 0.30 if f in SIDE_FACES else 0.25
    col[mortar] = col[mortar] * (1 - mix) + mcol[mortar] * mix
    # occasional cracks (stone / plate only, at most 2 per face): a dark jagged walk 5-12 texels long with a
    # 1-texel highlight on its left (light from the top-left)
    if not headish and W >= 6 and H >= 6:
        cr = np.random.default_rng(seed + 11)
        ncr = min(2, int(cr.poisson(W * H / 550.0)))
        for _ in range(ncr):
            x, y = int(cr.integers(1, W - 1)), int(cr.integers(0, H - 3))
            ln = int(cr.integers(5, 13))
            dx = int(cr.choice([-1, 0, 1]))
            for _s in range(ln):
                if 0 <= x < W and 0 <= y < H:
                    col[y, x] = col[y, x] * 0.45 + PAL['dark'] * 0.55
                    if x - 1 >= 0:
                        col[y, x - 1] = col[y, x - 1] * 1.07
                y += 1
                x += dx if cr.uniform() < 0.5 else 0
                if cr.uniform() < 0.25:
                    dx = int(cr.choice([-1, 0, 1]))
    # cube edge treatment (sides): catch-light on the top edge, darker bottom edge
    if f in SIDE_FACES:
        col[J < 0.26] *= 1.06
        col[(J > J.max() - 0.26)] *= 0.9
    # orientation: up faces dusty and lighter, down faces darker
    if up_amt > 0.3:
        dust = NZ_DUST(Pw[..., 0] * 1.3, Pw[..., 1] * 1.3, Pw[..., 2] * 1.3)
        k = (0.14 + 0.05 * dust) * up_amt
        col = col * (1 + k)[..., None] + np.array([12, 11, 10]) * up_amt
        dsp = np.random.default_rng(seed + 5).uniform(0, 1, (H, W))
        col[dsp > 0.93] = col[dsp > 0.93] * 0.85 + PAL['light'] * 0.15
    elif up_amt < -0.3:
        col *= 1 - 0.12 * (-up_amt)
    # soot / char: blocky dark vertical tears whose coverage grows lower down (world-aligned, snapped to 2-texel
    # columns so they follow the block grid); brick seams stay visible through it
    sa = soot_amount(c, Pw)
    if np.any(sa > 0):
        bx, bz = _blocky(Pw[..., 0]), _blocky(Pw[..., 2])
        by = _blocky(Pw[..., 1])
        st = NZ_STREAK(bx * 0.6, Pw[..., 1] * 0.12, bz * 0.6)
        st2 = NZ_GRAIN(bx * 1.1 + 7, by * 0.3, bz * 1.1 + 3)
        sv = np.clip(0.5 + 0.5 * (0.75 * st + 0.35 * st2) / 0.55, 0, 1)     # ~uniform 0..1
        th = 1.0 - np.clip(sa, 0, 0.95)
        m = np.clip((sv - th) / 0.1 + 0.5, 0, 1)
        if up_amt > 0.3:
            m *= 0.55                                    # tops catch dust, stay lighter
        sc = PAL['soot'] * (0.85 + 0.3 * np.random.default_rng(seed + 9).uniform(0, 1, (H, W)))[..., None]
        col = col * (1 - 0.8 * m[..., None]) + sc * (0.8 * m[..., None])
        col *= (1 - 0.1 * np.clip(sa, 0, 1))[..., None]
    # baked shadow under the collar (in-game entities get no self-shadowing)
    sh = c.paint.get('shadow')
    if sh:
        y0, y1, amt = sh
        col *= (1 - amt * np.clip((Pw[..., 1] - y0) / (y1 - y0), 0, 1))[..., None]
    # ambient occlusion (same bone + static neighbours); ledge tops stay dustier / lighter than the sides
    ao = ambient_occlusion(c, Pw, Nw)
    if up_amt > 0.3:
        ao = np.maximum(ao, 0.85)
    col *= ao[..., None]
    # keep every stone texel warm (no blue-grey bricks): B <= 0.96 G
    col[..., 2] = np.minimum(np.minimum(col[..., 2], col[..., 1] * WARM_B), col[..., 0] * 0.96)
    if tag == 'face':
        # warm tint around the eyes (opaque: only eyes and teeth glow, SPEC 5); the 0.25-deep socket walls inside
        # each eye square are part of the eye's glowing rim (alpha 30)
        eyes = [(x0, x1, EYE_Y[0], EYE_Y[1]) for x0, x1 in EYES]
        if Nw[2] < -0.9 and P[0, 0, 2] <= -4.49:
            halo = _ring(P, eyes, 0.0, 0.26)
            ring2 = _ring(P, eyes, 0.26, 0.51)
            col[ring2] = col[ring2] * 0.75 + PAL['eye_rim'] * 0.25
            col[halo] = col[halo] * 0.35 + PAL['eye_halo'] * 0.65
        ex = np.zeros(P.shape[:2], bool)
        for x0, x1, y0, y1 in eyes:
            ex |= (P[..., 0] > x0 - 0.01) & (P[..., 0] < x1 + 0.01) & (P[..., 1] > y0 - 0.01) & (P[..., 1] < y1 + 0.01)
        sock = ex & (P[..., 2] > -4.51) & (P[..., 2] < -4.24) & (abs(Nw[2]) < 0.5)
        if np.any(sock):
            col[sock] = PAL['eye_rim'] * 0.5 + PAL['eye_edge'] * 0.5
            alpha[sock] = 30
        if c.paint.get('nose') and Nw[2] < -0.9:
            nos = (np.abs(P[..., 0]) < 0.25) & (P[..., 1] > 76.25) & (P[..., 1] < 77.0)
            col[nos] = PAL['nostril']
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
                'visible_bounds_width': 8,
                'visible_bounds_height': 8,
                'visible_bounds_offset': [0, 3.5, 0],
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
    jaw = check_jaw_sweep()
    if jaw:
        for pose, c, k in jaw[:20]:
            print('JAW', pose, c.bone, c.lo, c.hi, k)
        raise SystemExit(f'{len(jaw)} cubes show inside the open mouth (jaw sweep)')
    jaw_solid = check_jaw_solid()
    if jaw_solid:
        for ang, o, k in jaw_solid[:20]:
            print('JAW-SOLID', ang, o.bone, o.lo, o.hi, k)
        raise SystemExit(f'{len(jaw_solid)} cubes are entered by the opening jaw')
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
