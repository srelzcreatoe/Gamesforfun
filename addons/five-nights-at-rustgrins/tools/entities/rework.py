"""The rework of the six supplied models (Rustgrin, Mirehop, Noxbriar thoroughly; the Purple Rat, the Cat and
the Ringmaster more lightly), so they stand beside the Golden Dog: stepped, rounded shapes instead of plain
boxes, a dark endoskeleton showing at every joint, deeper eye sockets, teeth that are teeth, dark fingertips,
and a richer, chequered, worn paint in each character's own colours.

The supplied files (assets/source_models/FNAF_Animatronics*_RP) are never written. tools/entities/
build_entities.py loads a model's geometry and texture from them and hands both to apply(), which returns the
reworked geometry, texture, its MER and what the build needs to find the eyes again.

What stays exactly as supplied: every bone's name, parent, pivot and rest rotation; the props; the fingers'
boxes (so every solved grip still holds); the paint of the eyes, texel for texel.

How it works
  * Every bone's big boxes are replaced by rounded sets of boxes (tools/entities/modelkit.py) that fill the
    same bounds. Their paint is the bone's own old look, cast back onto the new shape from the six sides
    (Skin): a vest, a button, a worn patch stays where it was.
  * Small parts (bow ties, buttons, whiskers, props) keep their boxes and their own paint.
  * New parts are painted from code: black ball joints at shoulders, elbows, wrists, knees and ankles, dark
    joint beads and fingertips, single teeth.
  * The frames around the eyes are thickened, so the eyes sit in real hollows.
  * All of it gets the dog's grain: half-pixel "voxels" a shade lighter or darker, worn patches, shaded
    creases (modelkit bakes those), so no face is flat any more.

Nothing here is random: the grain is a hash of the position in the model.
"""
import copy
import hashlib
import json
import math
import os

import numpy as np
from PIL import Image

import modelkit as mk
from modelkit import fbm, ihash

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'rework_cache')
DENS = 8
PROPS = ('right_maraca', 'left_maraca', 'right_cane', 'microphone', 'guitar')

# ------------------------------------------------------------------ what each model gets
FULL = {'limb_r': 0.875, 'limb_level': 2, 'slab_r': 1.0, 'head_r': 1.25, 'frame': 0.5, 'grain': 1.0, 'ball': 1.0, 'teeth': True, 'tips': True, 'grow': 0.25}
LIGHT = {'limb_r': 0.625, 'limb_level': 1, 'slab_r': 0.75, 'head_r': 0.875, 'frame': 0.375, 'grain': 0.75, 'ball': 0.9, 'teeth': True, 'tips': True, 'grow': 0.125}
PLAN = {
    'rustgrin': dict(FULL, seed=101),
}
PENDING = {
    'mirehop': dict(FULL, seed=202),
    'noxbriar': dict(FULL, seed=303),
    'purple_rat': dict(LIGHT, seed=404),
    'cat': dict(LIGHT, seed=505),
    'top_hat_rat': dict(LIGHT, seed=606),
}

BLACK = [(16, 15, 17), (24, 22, 25), (34, 31, 35)]
TIP = [(26, 22, 22), (36, 31, 30), (48, 41, 38)]


# ------------------------------------------------------------------ the supplied texture, read through a cube's face
def _ab(c, face, P):
    """Where bone-frame points lie on a source cube's face: (a, b) in [0, 1), a from the texture's left, b from its
    top (the conventions of modelkit.Cube.face_points), clamped to the face."""
    ox, oy, oz = c['origin']
    sx, sy, sz = (max(float(v), 1e-9) for v in c['size'])
    fx, fy, fz = (P[..., 0] - ox) / sx, (P[..., 1] - oy) / sy, (P[..., 2] - oz) / sz
    a, b = {'north': (fx, 1 - fy), 'south': (1 - fx, 1 - fy), 'east': (1 - fz, 1 - fy), 'west': (fz, 1 - fy),
            'up': (1 - fx, fz), 'down': (1 - fx, 1 - fz)}[face]
    return np.clip(a, 0.0, 1.0 - 1e-9), np.clip(b, 0.0, 1.0 - 1e-9)


def sample_src(arr, c, face, P):
    """The source texture's texels (RGBA) a cube's face shows at bone-frame points P."""
    (u, v), (us, vs) = c['uv'][face]['uv'], c['uv'][face]['uv_size']
    a, b = _ab(c, face, P)
    if face in ('up', 'down'):
        tx, ty = u + us * (1 - a), v + vs * (1 - b)
    else:
        tx, ty = u + us * a, v + vs * b
    x0, x1 = sorted((u, u + us))
    y0, y1 = sorted((v, v + vs))
    ix = np.clip(np.floor(tx).astype(int), int(math.floor(x0)), max(int(math.floor(x0)), int(math.ceil(x1)) - 1))
    iy = np.clip(np.floor(ty).astype(int), int(math.floor(y0)), max(int(math.floor(y0)), int(math.ceil(y1)) - 1))
    return arr[np.clip(iy, 0, arr.shape[0] - 1), np.clip(ix, 0, arr.shape[1] - 1)]


class Skin:
    """What a set of (unrotated) source cubes of one bone looks like from each of the six sides, at the
    texture's own resolution: the paint for whatever new shape takes their place."""
    PLANE = {'north': (0, 1, 2), 'south': (0, 1, 2), 'east': (2, 1, 0), 'west': (2, 1, 0), 'up': (0, 2, 1), 'down': (0, 2, 1)}

    def __init__(self, arr, cubes):
        self.arr = arr
        self.cubes = [c for c in cubes if not c.get('rotation')]
        los = np.array([c['origin'] for c in self.cubes], float)
        his = los + np.array([c['size'] for c in self.cubes], float)
        self.lo, self.hi = los.min(0), his.max(0)
        self._proj = {}

    def proj(self, face):
        """(rgba, covered) of the side `face`: the nearest cube face wins each texel; texels no cube covers take
        the nearest covered texel's colour."""
        if face in self._proj:
            return self._proj[face]
        iu, iv, iw = self.PLANE[face]
        nu = max(1, int(math.ceil((self.hi[iu] - self.lo[iu]) * DENS - 1e-6)))
        nv = max(1, int(math.ceil((self.hi[iv] - self.lo[iv]) * DENS - 1e-6)))
        rgba = np.zeros((nv, nu, 4), np.uint8)
        near = np.full((nv, nu), -np.inf)
        cu = self.lo[iu] + (np.arange(nu) + 0.5) / DENS
        cv = self.lo[iv] + (np.arange(nv) + 0.5) / DENS
        for c in self.cubes:
            o, s = np.array(c['origin'], float), np.array(c['size'], float)
            front = {'north': -o[2], 'south': o[2] + s[2], 'east': -o[0], 'west': o[0] + s[0], 'up': o[1] + s[1], 'down': -o[1]}[face]
            mu = (cu > o[iu]) & (cu < o[iu] + s[iu])
            mv = (cv > o[iv]) & (cv < o[iv] + s[iv])
            if not mu.any() or not mv.any():
                continue
            U, V = np.meshgrid(cu[mu], cv[mv])
            P = np.zeros(U.shape + (3,))
            P[..., iu], P[..., iv] = U, V
            P[..., iw] = {'north': o[2], 'south': o[2] + s[2], 'east': o[0], 'west': o[0] + s[0], 'up': o[1] + s[1], 'down': o[1]}[face]
            px = sample_src(self.arr, c, face, P)
            sub = np.ix_(np.nonzero(mv)[0], np.nonzero(mu)[0])
            win = front > near[sub]
            block = rgba[sub]
            block[win] = px[win]
            rgba[sub] = block
            nr = near[sub]
            nr[win] = front
            near[sub] = nr
        covered = np.isfinite(near)
        if not covered.all() and covered.any():
            from scipy import ndimage
            idx = ndimage.distance_transform_edt(~covered, return_distances=False, return_indices=True)
            rgba = rgba[idx[0], idx[1]]
        self._proj[face] = (rgba, covered)
        return self._proj[face]

    def sample(self, face, P):
        iu, iv, _ = self.PLANE[face]
        rgba, _ = self.proj(face)
        x = np.clip(np.floor((P[..., iu] - self.lo[iu]) * DENS + 1e-6).astype(int), 0, rgba.shape[1] - 1)
        y = np.clip(np.floor((P[..., iv] - self.lo[iv]) * DENS + 1e-6).astype(int), 0, rgba.shape[0] - 1)
        return rgba[y, x]


# ------------------------------------------------------------------ paint
def _bevel(F, rgbv, amount, grain=0.5):
    per = grain * F.dens
    if per < 3.5 or amount <= 0:
        return rgbv
    P = F.inner()
    n = np.array(F.n)
    k = np.ones(F.x.shape)
    for i in [i for i in range(3) if abs(n[i]) < 0.5]:
        fr = (P[..., i] / grain) % 1.0
        lo, hi = fr < 1.0 / per + 1e-6, fr > 1.0 - 1.0 / per - 1e-6
        k = k + (amount * hi - amount * lo if i == 1 else 0.5 * amount * lo - 0.5 * amount * hi)
    return rgbv * k[..., None]


def grain(F, rgbv, k, seed):
    """The dog's grain over a supplied paint: half-pixel voxels a shade lighter or darker, slow patches,
    darker worn islands, a hint of an edge on every voxel, a few pits. k: how strongly (0 = none)."""
    if k <= 0:
        return rgbv
    ix, iy, iz = F.cells(0.5)
    cx, cy, cz = (ix + 0.5) * 0.5, (iy + 0.5) * 0.5, (iz + 0.5) * 0.5
    t = 1.0 + k * (0.10 + 0.20 * (ihash(ix, iy, iz, seed) - 0.5) + 0.28 * (fbm(cx, cy, cz, 3.2, seed + 3) - 0.5))
    w = fbm(cx, cy, cz, 5.5, seed + 40) + (ihash(ix, iy, iz, seed + 41) - 0.5) * 0.16
    t = np.where(w > 0.64, t * (1.0 - 0.18 * k), t)
    out = _bevel(F, rgbv * t[..., None], 0.028 * k)
    q = np.floor(F.inner() * F.dens + 1e-6).astype(np.int64)
    pit = ihash(q[..., 0], q[..., 1], q[..., 2], seed + 91) < 0.011 * k
    return np.where(pit[..., None], out * 0.62, out)


def glossy(tones=BLACK, centre=None, seed=3, rough=70, metal=40, light=(-0.35, 0.75, -0.55)):
    """Black joints and beads: dark, with a soft highlight towards the light."""
    L = np.array(light, float)
    L /= np.linalg.norm(L)
    base = np.array(tones, float)

    def mat(F):
        ix, iy, iz = F.cells(0.25)
        out = mk.pick(base, np.clip(ihash(ix, iy, iz, seed), 0, 0.999))
        n = np.array(F.n)
        if centre is not None:
            d = F.P - np.array(centre)
            d = d / np.maximum(np.linalg.norm(d, axis=-1, keepdims=True), 1e-6)
            lit = np.clip(d @ L, 0, 1) * 0.55 + max(0.0, float(n @ L)) * 0.45
        else:
            lit = np.full(F.x.shape, max(0.0, float(n @ L)))
        out = out + 64.0 * lit[..., None] ** 2.2 + 110.0 * (lit[..., None] > 0.9)
        return {'rgb': out, 'rough': rough, 'metal': metal}
    return mat


def tip_mat(F):
    """Dark fingertips: worn black rubber."""
    ix, iy, iz = F.cells(0.25)
    return {'rgb': mk.pick(np.array(TIP, float), np.clip(ihash(ix, iy, iz, 81), 0, 0.999)), 'rough': 150}


# ------------------------------------------------------------------ boxes
def _snap(v, grid):
    return round(v / grid) * grid if grid else v


def rounded(bone, lo, hi, mat, r, level=1, flat=(), grid=None, **kw):
    """Like modelkit.Bone.rounded, with insets that can be snapped to a grid (the eyes' texels must stay on
    theirs) and without the boxes another box of the set already holds (an axis with r = 0 makes some)."""
    rr = [float(r)] * 3 if isinstance(r, (int, float)) else [float(v) for v in r]
    sets = {1: [(0, 1, 1), (1, 0, 1), (1, 1, 0)], 2: [(0, 1, 1), (1, 0, 1), (1, 1, 0), (0.5, 0.5, 0.5)],
            3: [(0, 1, 1), (1, 0, 1), (1, 1, 0), (0.29, 0.29, 1), (0.29, 1, 0.29), (1, 0.29, 0.29), (0.42, 0.42, 0.42)]}[level]
    boxes = []
    for ins in sets:
        a, b = list(lo), list(hi)
        for i, ax in enumerate('xyz'):
            d = _snap(ins[i] * rr[i], grid)
            if f'{ax}-' not in flat:
                a[i] += d
            if f'{ax}+' not in flat:
                b[i] -= d
        if all(q - p > 1e-6 for p, q in zip(a, b)) and (a, b) not in boxes:
            boxes.append((a, b))
    inside = lambda p, q: all(q[0][i] - 1e-9 <= p[0][i] and p[1][i] <= q[1][i] + 1e-9 for i in range(3))
    keep = [p for k, p in enumerate(boxes) if not any(inside(p, q) and (not inside(q, p) or j < k) for j, q in enumerate(boxes) if j != k)]
    return [bone.box(a[0], a[1], a[2], b[0], b[1], b[2], mat, **kw) for a, b in keep]


def ball(bone, c, r, seed=3):
    m = glossy(centre=c, seed=seed)
    return rounded(bone, [c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r], m, r * 0.58, level=2 if r >= 0.85 else 1)


def lo_hi(c):
    o, s = c['origin'], c['size']
    return [float(v) for v in o], [float(o[i] + s[i]) for i in range(3)]


def union(cubes):
    los = np.array([c['origin'] for c in cubes], float)
    his = los + np.array([c['size'] for c in cubes], float)
    return list(los.min(0)), list(his.max(0))


def role(name):
    for s in ('right_', 'left_'):
        if name.startswith(s):
            r = name[len(s):]
            if r.startswith('finger') or r.startswith('thumb'):
                return 'digit_tip' if r.endswith('_tip') else 'digit'
            return r
    return 'tail' if name.startswith('tail') else name


# ------------------------------------------------------------------ one model
class Rework:
    def __init__(self, cid, geo, img, find_sockets):
        self.cid, self.P = cid, PLAN[cid]
        self.g = geo['minecraft:geometry'][0]
        self.arr = np.asarray(img.convert('RGBA'))
        self.find_sockets = find_sockets
        self.m = mk.Model()
        self.seed = self.P['seed']
        self.window = None            # the eyes' rectangle on the head's front: (x0, y0, x1, y1) in model pixels
        self.eye_cubes = []

    # ---- materials
    def own(self, c, k=None):
        """A kept cube: its own supplied paint (stretched if the box has grown), with the grain."""
        k = self.P['grain'] if k is None else k

        def mat(F):
            px = sample_src(self.arr, c, F.name, F.L).astype(float)
            return {'rgb': np.concatenate([grain(F, px[..., :3], k, self.seed), px[..., 3:]], -1)}
        return mat

    def skin(self, sk, k=None, eyes=False):
        """A reshaped part: the old look of its bone cast onto it. eyes: the texels inside the eyes' rectangle on
        front faces are the supplied ones untouched (no grain, no crease shading)."""
        k = self.P['grain'] if k is None else k

        def mat(F):
            px = sk.sample(F.name, F.P).astype(float)
            out = grain(F, px[..., :3], k, self.seed)
            res = {'rgb': out}
            if eyes and self.window and F.name == 'north':
                x0, y0, x1, y1 = self.window
                keep = (F.x > x0) & (F.x < x1) & (F.y > y0) & (F.y < y1)
                res['rgb'] = np.where(keep[..., None], px[..., :3], out)
                res['ao'] = np.where(keep, 0.0, 1.0)
            return res
        return mat

    # ---- helpers
    def fuller(self, lo, hi):
        """A limb block a little wider and deeper: cutting its edges takes weight off it, this gives it back."""
        g = self.P['grow']
        return [lo[0] - g, lo[1], lo[2] - g], [hi[0] + g, hi[1], hi[2] + g]

    def radii(self, lo, hi, r, frac=0.26, grid=None):
        out = []
        for i in range(3):
            s = hi[i] - lo[i]
            v = 0.0 if s < 1.4 else min(r, frac * s)
            out.append(_snap(v, grid) if grid else v)
        return out

    def limb_ball(self, bone, cs, scale=0.3, lo=0.75, hi=1.3):
        big = max(cs, key=lambda c: c['size'][0] * c['size'][2]) if cs else None
        w = (big['size'][0] + big['size'][2]) / 2 if big else 3.0
        r = float(np.clip(scale * w * self.P['ball'], lo, hi))
        ball(bone, bone.pivot, r, seed=len(self.m.bones))
        return r

    # ---- bones
    def limb(self, b, src, joint=True):
        """Upper arm, forearm, thigh: the big box (with a cap slab, if it has one) becomes one rounded block;
        the little endoskeleton pieces turn black; a black ball sits on the joint the bone turns on."""
        P = self.P
        cs = [c for c in src.get('cubes', []) if not c.get('rotation')]
        bulk = [c for c in cs if c['size'][0] >= 2.4 and c['size'][2] >= 2.4]
        piv = np.array(b.pivot)
        if bulk:
            lo, hi = union(bulk)
            sk = Skin(self.arr, bulk)
            lo, hi = self.fuller(lo, hi)
            rounded(b, lo, hi, self.skin(sk), self.radii(lo, hi, P['limb_r']), level=P['limb_level'])
        rad = self.limb_ball(b, bulk) if joint else 0.0
        for c in src.get('cubes', []):
            if c in bulk:
                continue
            lo, hi = lo_hi(c)
            centre = (np.array(lo) + np.array(hi)) / 2
            if joint and np.linalg.norm(centre - piv) < rad + 0.2 and max(c['size']) <= 2 * rad + 0.3:
                continue                                         # (inside the new ball)
            self.keep(b, c, mat=glossy(seed=7))

    def keep(self, b, c, mat=None, **kw):
        lo, hi = lo_hi(c)
        return b.add(mk.Cube(lo, c['size'], mat or self.own(c), c.get('rotation'), c.get('pivot'), c.get('inflate', 0.0), **kw))

    def hand(self, b, src):
        cs = [c for c in src.get('cubes', []) if not c.get('rotation')]
        palm = max(cs, key=lambda c: np.prod(c['size']))
        piv = np.array(b.pivot)
        r = float(np.clip(0.27 * (palm['size'][0] + palm['size'][2]) / 2 * self.P['ball'], 0.65, 0.9))
        ball(b, b.pivot, r, seed=11)
        for c in src.get('cubes', []):
            lo, hi = lo_hi(c)
            if c is palm:
                rounded(b, lo, hi, self.skin(Skin(self.arr, [c])), self.radii(lo, hi, 0.35, frac=0.2), level=1)
            elif not c.get('rotation') and np.linalg.norm((np.array(lo) + np.array(hi)) / 2 - piv) < r + 0.2 and max(c['size']) <= 2 * r + 0.3:
                continue                                         # the wrist block: the ball takes its place
            else:
                self.keep(b, c)

    def digit(self, b, src, tip):
        """Fingers and thumbs keep their boxes (the grips were solved on them): the joint bead turns black, and
        the last segment becomes a dark fingertip with a small cap."""
        cs = src.get('cubes', [])
        if not cs:
            return
        seg = max(cs, key=lambda c: np.prod(c['size']))
        for c in cs:
            if c is seg:
                if tip and self.P['tips']:
                    self.keep(b, c, mat=tip_mat)
                    lo, hi = lo_hi(c)
                    if not c.get('rotation'):
                        w, d = (hi[0] - lo[0]) * 0.16, (hi[2] - lo[2]) * 0.16
                        b.box(lo[0] + w, lo[1] - 0.25, lo[2] + d, hi[0] - w, lo[1], hi[2] - d, tip_mat)
                else:
                    self.keep(b, c)
            else:
                self.keep(b, c, mat=glossy(seed=13))

    def shin(self, b, src):
        P = self.P
        cs = [c for c in src.get('cubes', []) if not c.get('rotation') and c['size'][0] >= 2.4 and c['size'][2] >= 2.4]
        big = [c for c in cs if c['size'][1] >= 1.6]
        if cs:
            sk = Skin(self.arr, cs)
        rad = self.limb_ball(b, big or cs, scale=0.24, lo=0.8, hi=1.25)
        piv = np.array(b.pivot)
        for c in src.get('cubes', []):
            lo, hi = lo_hi(c)
            if c in big:
                lo, hi = self.fuller(lo, hi)
                rounded(b, lo, hi, self.skin(sk), self.radii(lo, hi, P['limb_r']), level=P['limb_level'])
            elif c in cs:
                rx, _, rz = self.radii(lo, hi, 0.6)
                rounded(b, lo, hi, self.skin(sk), (rx, 0.0, rz), level=1)
            elif np.linalg.norm((np.array(lo) + np.array(hi)) / 2 - piv) < rad + 0.2 and max(c['size']) <= 2 * rad + 0.3:
                continue
            else:
                self.keep(b, c, mat=glossy(seed=17))

    def foot(self, b, src):
        cs = [c for c in src.get('cubes', []) if not c.get('rotation')]
        sk = Skin(self.arr, cs) if cs else None
        main = [c for c in cs if c['size'][0] >= 4 and c['size'][1] >= 2]
        ball(b, b.pivot, float(np.clip(0.9 * self.P['ball'], 0.7, 1.0)), seed=19)
        for c in src.get('cubes', []):
            lo, hi = lo_hi(c)
            s = c['size']
            if c.get('rotation'):
                self.keep(b, c)
            elif c in main:
                rounded(b, lo, hi, self.skin(sk), self.radii(lo, hi, 0.75, frac=0.2), level=1, flat=('y-',))
            elif s[1] <= 1.1 and s[2] >= 6:                      # the sole
                rx, _, rz = self.radii(lo, hi, 0.75)
                rounded(b, lo, hi, self.skin(sk), (rx, 0.0, rz), level=1)
            elif s[0] <= 1.8 and s[2] >= 2.5 and s[1] >= 1.2:    # a toe
                rounded(b, lo, hi, self.skin(sk), (min(0.3, 0.2 * s[0]), min(0.5, 0.3 * s[1]), 0.5), level=1, flat=('y-', 'z+'))
            elif s[1] < 1.4 and s[0] >= 4:                       # the plate over the foot
                rx, _, rz = self.radii(lo, hi, 0.6)
                rounded(b, lo, hi, self.skin(sk), (rx, 0.0, rz), level=1)
            else:
                self.keep(b, c)

    def torso(self, b, src):
        P = self.P
        cs = [c for c in src.get('cubes', []) if not c.get('rotation') and c['size'][0] >= 6.0]
        sk = Skin(self.arr, cs) if cs else None
        top = max((c['origin'][1] + c['size'][1] for c in cs), default=0)
        for c in src.get('cubes', []):
            lo, hi = lo_hi(c)
            s = c['size']
            if c in cs:
                rx, _, rz = self.radii(lo, hi, P['slab_r'])
                rounded(b, lo, hi, self.skin(sk), (rx, 0.0, rz), level=P['limb_level'])
            elif not c.get('rotation') and abs(lo[0] + hi[0]) < 0.1 and abs(lo[2] + hi[2]) < 0.6 and 2.0 <= s[0] <= 4.0 and hi[1] >= top:
                self.keep(b, c, mat=glossy(seed=23))             # the neck
            else:
                self.keep(b, c)

    def head(self, b, src):
        """The head: its big boxes rounded (on the texel grid, so the eyes' paint lands texel for texel), thin
        plates on its front (the frames of the eyes) thickened so the eyes lie in hollows."""
        P = self.P
        cubes = src.get('cubes', [])
        un = [c for c in cubes if not c.get('rotation')]
        bulk = [c for c in un if np.prod(c['size']) >= 20 and min(c['size']) >= 1.4]
        slab = [c for c in un if c not in bulk and c['size'][1] < 1.4 and c['size'][0] * c['size'][2] >= 12]
        body = bulk + slab
        sk = Skin(self.arr, body)
        front = min(c['origin'][2] for c in body)
        # the eyes: found on the head's front as the build finds them (red pupils on dark eyeballs)
        rgba, _ = sk.proj('north')
        a = rgba[::-1].astype(int)                               # rows from the top
        red = (a[..., 0] > 140) & (a[..., 1] < 90) & (a[..., 2] < 90) & (a[..., 3] > 0)
        if red.any():
            sock, _ = self.find_sockets(a, red)
            ys, xs = np.nonzero(sock | red)
            m = 3
            x0, x1 = sk.lo[0] + (xs.min() - m) / DENS, sk.lo[0] + (xs.max() + 1 + m) / DENS
            y1, y0 = sk.hi[1] - (ys.min() - m) / DENS, sk.hi[1] - (ys.max() + 1 + m) / DENS
            self.window = (x0, y0, x1, y1)
        tag = dict(skin={'eyes': True}, cube={'full': True, 'nest': False, 'tag': 'eyes'})
        for c in cubes:
            lo, hi = lo_hi(c)
            s = c['size']
            if c in bulk:
                rounded(b, lo, hi, self.skin(sk, eyes=True), self.radii(lo, hi, P['head_r'], frac=0.17, grid=0.125), level=2, grid=0.125,
                        **tag['cube'])
            elif c in slab:
                rx, _, rz = self.radii(lo, hi, min(P['head_r'], 0.875), frac=0.14, grid=0.125)
                rounded(b, lo, hi, self.skin(sk, eyes=True), (rx, 0.0, rz), level=1, grid=0.125, **tag['cube'])
            elif not c.get('rotation') and s[2] <= 0.3 and lo[2] <= front + 0.05 and P['frame']:
                # a frame of the eyes: thicker, so it stands proud and the eye behind it sinks
                b.add(mk.Cube([lo[0], lo[1], lo[2] - P['frame']], [s[0], s[1], s[2] + P['frame']], self.own(c)))
            elif not c.get('rotation') and np.prod(s) >= 3 and min(s) >= 0.7:
                rounded(b, lo, hi, self.skin(Skin(self.arr, [c])), self.radii(lo, hi, 0.375, frac=0.2), level=1)
            else:
                self.keep(b, c)

    def jaw(self, b, src):
        P = self.P
        for c in src.get('cubes', []):
            lo, hi = lo_hi(c)
            s = c['size']
            if not c.get('rotation') and s[2] <= 0.3 and s[1] <= 0.6 and P['teeth']:
                self.teeth(b, c)
            elif not c.get('rotation') and s[1] <= 1.4 and s[0] * s[2] >= 12:
                rx, _, rz = self.radii(lo, hi, 0.5)
                rounded(b, lo, hi, self.skin(Skin(self.arr, [c])), (rx, 0.0, rz), level=1)
            else:
                self.keep(b, c)

    def teeth(self, b, c):
        """A painted strip of teeth becomes single teeth: one box per bright run of the strip, a little proud."""
        lo, hi = lo_hi(c)
        (u, v), (us, vs) = c['uv']['north']['uv'], c['uv']['north']['uv_size']
        x0, x1 = sorted((int(u), int(u + us)))
        y0, y1 = sorted((int(v), int(v + vs)))
        strip = self.arr[y0:y1, x0:x1, :3].astype(float)
        lum = (strip @ [0.299, 0.587, 0.114]).mean(0)
        bright = lum > (lum.min() + lum.max()) / 2
        runs, start = [], None
        for i, on in enumerate(list(bright) + [False]):
            if on and start is None:
                start = i
            elif not on and start is not None:
                runs.append((start, i))
                start = None
        if len(runs) < 2:
            n = max(3, int(round((hi[0] - lo[0]) / 0.95)))
            w = (x1 - x0) / n
            runs = [(int(round(k * w + 0.12 * w)), int(round((k + 1) * w - 0.12 * w))) for k in range(n)]
        tone = strip.reshape(-1, 3)[np.argsort(strip.reshape(-1, 3) @ [0.299, 0.587, 0.114])[-max(1, strip.size // 12):]].mean(0)
        dark = strip.reshape(-1, 3).min(0) * 0.5

        def tooth(F):
            ix, iy, iz = F.cells(0.25)
            k = 0.86 + 0.2 * ihash(ix, iy, iz, 53)
            return {'rgb': np.zeros(F.x.shape + (3,)) + tone * k[..., None], 'rough': 120}
        n = x1 - x0
        for s_, e_ in runs:
            ax, bx = lo[0] + (hi[0] - lo[0]) * s_ / n, lo[0] + (hi[0] - lo[0]) * e_ / n
            b.box(ax, lo[1], lo[2] - 0.2, bx, hi[1] + 0.12, hi[2] + 0.1, tooth)
        b.box(lo[0], lo[1], hi[2], hi[0], hi[1], hi[2] + 0.15, lambda F: {'rgb': np.zeros(F.x.shape + (3,)) + dark, 'rough': 230})

    def generic(self, b, src, r=0.5):
        """Hats, ears, tails: boxes big enough get their edges cut; the rest stay."""
        cs = [c for c in src.get('cubes', []) if not c.get('rotation') and np.prod(c['size']) >= 6]
        sk = Skin(self.arr, cs) if cs else None
        for c in src.get('cubes', []):
            lo, hi = lo_hi(c)
            if c in cs:
                rr = [0.0 if (hi[i] - lo[i]) < 1.2 else min(r, 0.2 * (hi[i] - lo[i])) for i in range(3)]
                if max(rr) > 0.05:
                    rounded(b, lo, hi, self.skin(sk), rr, level=1)
                    continue
            self.keep(b, c)

    # ---- the whole model
    def build(self):
        for src in self.g['bones']:
            b = self.m.bone(src['name'], src.get('parent'), src.get('pivot', [0, 0, 0]), src.get('rotation'))
            r = role(src['name'])
            if src['name'] in PROPS:
                for c in src.get('cubes', []):
                    self.keep(b, c, mat=self.own(c, k=0.35 * self.P['grain']))
            elif r in ('arm', 'forearm'):
                self.limb(b, src)
            elif r == 'leg':
                self.limb(b, src, joint=False)
            elif r == 'hand':
                self.hand(b, src)
            elif r in ('digit', 'digit_tip'):
                self.digit(b, src, r == 'digit_tip')
            elif r == 'shin':
                self.shin(b, src)
            elif r == 'foot':
                self.foot(b, src)
            elif r in ('torso', 'waist'):
                self.torso(b, src)
            elif r == 'head':
                self.head(b, src)
            elif r == 'jaw':
                self.jaw(b, src)
            else:
                self.generic(b, src)
        return self.m

    def result(self):
        m = self.build()
        height, layers, used = mk.build(m, 512, crease_dark=0.27)
        d = self.g['description']
        geo = mk.to_geometry(m, d['identifier'], 512, height,
                             (d.get('visible_bounds_width', 4), d.get('visible_bounds_height', 4), d.get('visible_bounds_offset', [0, 1.5, 0])))
        col = np.asarray(layers['color']).copy()
        mer = np.asarray(layers['mer'])
        # the faces that carry the eyes: where each sits in the atlas and on the head's front
        faces, pupils = [], np.zeros(col.shape[:2], bool)
        if self.window:
            x0, y0, x1, y1 = self.window
            for c in m['head'].cubes:
                w, h, dns = c.grid['north']
                if c.tag != 'eyes' or dns != DENS:
                    continue
                cx0, cx1 = c.origin[0], c.origin[0] + c.size[0]
                cy0, cy1 = c.origin[1], c.origin[1] + c.size[1]
                if cx1 <= x0 or cx0 >= x1 or cy1 <= y0 or cy0 >= y1:
                    continue
                ax, ay, _, _ = c.rect['north']
                faces.append([int(ax), int(ay), int(w), int(h), int(round((cx0 - x0) * DENS)), int(round((y1 - cy1) * DENS))])
                # pupils: the build's red rule, inside the eyes' rectangle only
                sub = col[ay:ay + h, ax:ax + w].astype(int)
                red = (sub[..., 0] > 140) & (sub[..., 1] < 90) & (sub[..., 2] < 90) & (sub[..., 3] > 0)
                F = mk.Face(c, 'north', w, h, dns)
                front = c.to_bone(c.face_points('north', w, h, lift=0.03))
                buried = np.zeros((h, w), bool)
                for o in m['head'].cubes:
                    if o is not c:
                        buried |= o.contains(front)
                pupils[ay:ay + h, ax:ax + w] |= red & ~buried & (F.x > x0) & (F.x < x1) & (F.y > y0) & (F.y < y1)
            size = [int(round((x1 - x0) * DENS)), int(round((y1 - y0) * DENS))]
        else:
            size = [0, 0]
        info = {'cubes': len(m.cubes()), 'bones': len(m.bones), 'rows': int(used), 'eye_faces': faces, 'eye_size': size}
        explicit = (mer[..., 0] > 0) | (mer[..., 2] != 215)
        return geo, Image.fromarray(col, 'RGBA'), Image.fromarray(mer, 'RGB'), explicit, pupils, info


# ------------------------------------------------------------------ entry point (+ cache)
def source_hash(extra=b''):
    h = hashlib.sha1()
    for f in ('rework.py', 'modelkit.py', 'fk.py'):
        with open(os.path.join(HERE, f), 'rb') as fh:
            h.update(fh.read())
    h.update(extra)
    return h.hexdigest()


def apply(cid, geo, img, find_sockets, log=print, cache=True):
    """The reworked model of `cid`: {'geo', 'img', 'mer' (RGB image), 'explicit' (bool array: texels whose MER was
    painted, not to be guessed from the colour), 'pupils' (bool array), 'info'}. Unknown models come back as None.
    The result is kept in tools/entities/rework_cache and reused while the sources and this code are unchanged."""
    if cid not in PLAN:
        return None
    key = source_hash(json.dumps(geo, sort_keys=True).encode() + np.asarray(img.convert('RGBA')).tobytes() + json.dumps(PLAN[cid], sort_keys=True).encode())
    base = os.path.join(CACHE, cid)
    if cache:
        try:
            with open(base + '.json') as f:
                saved = json.load(f)
            if saved.get('key') == key:
                return {'geo': saved['geo'], 'img': Image.open(base + '.png').convert('RGBA'), 'mer': Image.open(base + '_mer.png').convert('RGB'),
                        'explicit': np.asarray(Image.open(base + '_explicit.png').convert('L')) > 127,
                        'pupils': np.asarray(Image.open(base + '_pupils.png').convert('L')) > 127, 'info': saved['info']}
        except (OSError, ValueError, KeyError):
            pass
    geo2, img2, mer, explicit, pupils, info = Rework(cid, copy.deepcopy(geo), img, find_sockets).result()
    log(f"{cid}: reworked: {info['cubes']} cubes, texture {img2.size[0]} x {img2.size[1]} ({info['rows']} rows used), {len(info['eye_faces'])} faces carry the eyes")
    if cache:
        os.makedirs(CACHE, exist_ok=True)
        img2.save(base + '.png')
        mer.save(base + '_mer.png')
        Image.fromarray((explicit * 255).astype(np.uint8), 'L').save(base + '_explicit.png')
        Image.fromarray((pupils * 255).astype(np.uint8), 'L').save(base + '_pupils.png')
        with open(base + '.json', 'w') as f:
            json.dump({'key': key, 'info': info, 'geo': geo2}, f, separators=(',', ':'))
            f.write('\n')
    return {'geo': geo2, 'img': img2, 'mer': mer, 'explicit': explicit, 'pupils': pupils, 'info': info}
