"""A small kit for building Bedrock entity models from code: bones and boxes, a painter that works in
model space, and an atlas packer. Used by the Golden Dog's generator (tools/entities/golden_dog.py) and by
the rework of the supplied cast (tools/entities/rework.py).

Conventions (the same as tools/entities/fk.py and tools/render/bedrock_model.js): model pixels, +y up,
the model's front is -z, its right side is -x. Every cube carries per-face UVs like the supplied models
(`uv` + `uv_size`, up / down faces stored with negative sizes).

How a texture is made
  1. every face of every cube is checked against the other cubes of its bone: faces (and parts of faces)
     buried inside the body are never seen, so a buried face gets a few shared texels and a mostly buried
     one fewer texels per pixel;
  2. the faces are packed into the atlas;
  3. every texel is painted by its cube's material: a function of the texel's position in the model, so
     mottling, seams and decals run across neighbouring boxes without a break;
  4. creases are shaded (texels close to another box of the same bone or of the bone's parent / children
     are darkened: the grime that collects in joints and steps).

Everything here is deterministic: the noise is an integer hash of the position.
"""
import math

import numpy as np
from PIL import Image

from fk import rot

FACES = ('north', 'east', 'south', 'west', 'up', 'down')
NORMAL = {'north': (0.0, 0.0, -1.0), 'south': (0.0, 0.0, 1.0), 'east': (-1.0, 0.0, 0.0), 'west': (1.0, 0.0, 0.0),
          'up': (0.0, 1.0, 0.0), 'down': (0.0, -1.0, 0.0)}
DENSITY = 8          # texels per model pixel, like the supplied models


# ------------------------------------------------------------------ noise
def ihash(ix, iy, iz, seed=0):
    """Integer lattice hash -> floats in [0, 1). Arrays of any (equal) shape."""
    h = (np.asarray(ix, np.int64) * 374761393 + np.asarray(iy, np.int64) * 668265263
         + np.asarray(iz, np.int64) * 2246822519 + int(seed) * 3266489917) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = ((h ^ (h >> 16)) * 2654435769) & 0xFFFFFFFF
    h = h ^ (h >> 15)
    return (h & 0xFFFFFF) / float(1 << 24)


def vnoise(x, y, z, scale, seed=0):
    """Smooth value noise in [0, 1): trilinear between hashed lattice points `scale` pixels apart."""
    x, y, z = (np.asarray(v, float) / scale for v in (x, y, z))
    x0, y0, z0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), np.floor(z).astype(np.int64)
    fx, fy, fz = x - x0, y - y0, z - z0
    fx, fy, fz = (f * f * (3 - 2 * f) for f in (fx, fy, fz))
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                out = out + w * ihash(x0 + dx, y0 + dy, z0 + dz, seed)
    return out


def fbm(x, y, z, scale, seed=0, octaves=3):
    out, amp, tot = 0.0, 1.0, 0.0
    for k in range(octaves):
        out = out + amp * vnoise(x, y, z, scale / (2 ** k), seed + 17 * k)
        tot += amp
        amp *= 0.5
    return out / tot


# ------------------------------------------------------------------ model
class Cube:
    def __init__(self, origin, size, mat=None, rotation=None, pivot=None, inflate=0.0, dens=None, src=None, tag=None, share=None, nest=True, full=False):
        self.origin = [float(v) for v in origin]
        self.size = [float(v) for v in size]
        self.mat = mat                # callable(Face) -> rgb array, or dict (see paint)
        self.rotation = [float(v) for v in rotation] if rotation else None
        self.pivot = [float(v) for v in pivot] if pivot else None
        self.inflate = float(inflate)
        self.dens = dens              # texels per pixel on this cube (None = the model's)
        self.src = src                # {face: (image, (u, v, us, vs))}: faces copied from an existing texture
        self.tag = tag
        self.share = share            # faces of cubes with the same share key and size share their texels
        self.nest = nest              # False: no other face is packed into the buried parts of this cube's faces
        self.full = full              # True: every face that shows at all keeps the full texel density
        self.bone = None
        self.uv = {}

    # cube-local frame <-> bone frame (the cube's own rotation about its pivot)
    def _rot(self):
        if not self.rotation:
            return None, None
        return rot(self.rotation), np.array(self.pivot or [0.0, 0.0, 0.0], float)

    def to_bone(self, P):
        R, cp = self._rot()
        return P if R is None else cp + (P - cp) @ R.T

    def from_bone(self, P):
        R, cp = self._rot()
        return P if R is None else cp + (P - cp) @ R

    def face_size(self, face):
        sx, sy, sz = self.size
        return {'north': (sx, sy), 'south': (sx, sy), 'east': (sz, sy), 'west': (sz, sy), 'up': (sx, sz), 'down': (sx, sz)}[face]

    def face_points(self, face, w, h, lift=0.0):
        """Cube-local positions of a w x h grid of texel centres on a face (shape h, w, 3): column 0 is the
        texture's left, row 0 its top. lift moves the points out along the normal."""
        ox, oy, oz = self.origin
        sx, sy, sz = self.size
        a = (np.arange(w) + 0.5) / w
        b = (np.arange(h) + 0.5) / h
        A, B = np.meshgrid(a, b)
        one = np.ones_like(A)
        if face == 'north':
            X, Y, Z = ox + A * sx, oy + (1 - B) * sy, (oz - lift) * one
        elif face == 'south':
            X, Y, Z = ox + (1 - A) * sx, oy + (1 - B) * sy, (oz + sz + lift) * one
        elif face == 'east':
            X, Y, Z = (ox - lift) * one, oy + (1 - B) * sy, oz + (1 - A) * sz
        elif face == 'west':
            X, Y, Z = (ox + sx + lift) * one, oy + (1 - B) * sy, oz + A * sz
        elif face == 'up':
            X, Y, Z = ox + (1 - A) * sx, (oy + sy + lift) * one, oz + B * sz
        else:
            X, Y, Z = ox + (1 - A) * sx, (oy - lift) * one, oz + (1 - B) * sz
        return np.stack([X, Y, Z], -1)

    def contains(self, P, eps=1e-4):
        """Which bone-frame points lie strictly inside this cube."""
        L = self.from_bone(P)
        lo = np.array(self.origin) - self.inflate + eps
        hi = np.array(self.origin) + np.array(self.size) + self.inflate - eps
        return np.all((L > lo) & (L < hi), axis=-1)

    def centre_radius(self):
        c = np.array(self.origin) + np.array(self.size) / 2
        return self.to_bone(c[None])[0], float(np.linalg.norm(np.array(self.size) / 2 + self.inflate))


class Bone:
    def __init__(self, name, parent=None, pivot=(0, 0, 0), rotation=None):
        self.name = name
        self.parent = parent
        self.pivot = [float(v) for v in pivot]
        self.rotation = [float(v) for v in rotation] if rotation else None
        self.cubes = []

    def add(self, cube):
        cube.bone = self
        self.cubes.append(cube)
        return cube

    def box(self, x0, y0, z0, x1, y1, z1, mat, **kw):
        """A box from its two corners."""
        lo = [min(x0, x1), min(y0, y1), min(z0, z1)]
        hi = [max(x0, x1), max(y0, y1), max(z0, z1)]
        return self.add(Cube(lo, [h - l for l, h in zip(lo, hi)], mat, **kw))

    def rounded(self, x0, y0, z0, x1, y1, z1, mat, r=0.5, level=1, flat=(), **kw):
        """A box with stepped, rounded edges, built from overlapping boxes.

        r: the corner radius (a number, or one per axis). level 1: three crossing boxes (edges cut by one
        step); 2: plus a box cut half as deep (two steps); 3: seven boxes (face, edge and corner boxes on a
        sphere: reads as round). flat: sides left square, e.g. ('y-',) where a limb ends inside a joint."""
        lo = [min(x0, x1), min(y0, y1), min(z0, z1)]
        hi = [max(x0, x1), max(y0, y1), max(z0, z1)]
        rr = [float(r)] * 3 if isinstance(r, (int, float)) else [float(v) for v in r]
        if level == 1:
            sets = [(0, 1, 1), (1, 0, 1), (1, 1, 0)]
        elif level == 2:
            sets = [(0, 1, 1), (1, 0, 1), (1, 1, 0), (0.45, 0.45, 0.45)]
        else:
            sets = [(0, 1, 1), (1, 0, 1), (1, 1, 0), (0.29, 0.29, 1), (0.29, 1, 0.29), (1, 0.29, 0.29), (0.42, 0.42, 0.42)]
        out = []
        for ins in sets:
            a, b = list(lo), list(hi)
            for i, ax in enumerate('xyz'):
                d = ins[i] * rr[i]
                if f'{ax}-' not in flat:
                    a[i] += d
                if f'{ax}+' not in flat:
                    b[i] -= d
            if all(q - p > 1e-6 for p, q in zip(a, b)):
                out.append(self.box(a[0], a[1], a[2], b[0], b[1], b[2], mat, **kw))
        return out


class Model:
    def __init__(self, dens=DENSITY):
        self.bones = []
        self.dens = dens
        self._by = {}

    def bone(self, name, parent=None, pivot=(0, 0, 0), rotation=None):
        b = Bone(name, parent, pivot, rotation)
        self.bones.append(b)
        self._by[name] = b
        return b

    def __getitem__(self, name):
        return self._by[name]

    def __contains__(self, name):
        return name in self._by

    def cubes(self):
        return [c for b in self.bones for c in b.cubes]

    # rest-pose bone frames -> model space
    def rest_frames(self):
        out = {}

        def get(b):
            if b.name in out:
                return out[b.name]
            piv = np.array(b.pivot)
            R = rot(b.rotation) if b.rotation else np.eye(3)
            if b.parent:
                PR, PO = get(self._by[b.parent])
                O = PO + PR @ (piv - np.array(self._by[b.parent].pivot))
                R = PR @ R
            else:
                O = piv
            out[b.name] = (R, O)
            return out[b.name]
        for b in self.bones:
            get(b)
        return out

    def mirror(self, src, dst_name, parent=None):
        """A mirrored copy (x -> -x) of a bone: 'right_arm' -> 'left_arm'. Cube materials are kept (they are
        handed the mirrored positions, so the paint differs side to side like worn fur does)."""
        s = self._by[src]
        b = self.bone(dst_name, parent if parent is not None else (s.parent.replace('right', 'left') if s.parent else None),
                      [-s.pivot[0], s.pivot[1], s.pivot[2]], [s.rotation[0], -s.rotation[1], -s.rotation[2]] if s.rotation else None)
        for c in s.cubes:
            o = [-(c.origin[0] + c.size[0]), c.origin[1], c.origin[2]]
            m = Cube(o, c.size, c.mat, [c.rotation[0], -c.rotation[1], -c.rotation[2]] if c.rotation else None,
                     [-c.pivot[0], c.pivot[1], c.pivot[2]] if c.pivot else None, c.inflate, c.dens, None, c.tag, c.share, c.nest, c.full)
            if c.src:
                # a mirrored copy of copied faces: east and west swap, every face flips left to right
                swap = {'east': 'west', 'west': 'east'}
                m.src = {swap.get(f, f): (img, rect, not flip) for f, (img, rect, flip) in c.src.items()}
            b.add(m)
        return b


# ------------------------------------------------------------------ what can be seen
class Face:
    """One face of a cube while it is painted: positions of its texels and what the material may want."""

    def __init__(self, cube, name, w, h, dens):
        self.cube, self.name, self.w, self.h, self.dens = cube, name, w, h, dens
        self.bone = cube.bone.name
        self.n = NORMAL[name]
        self.L = cube.face_points(name, w, h)             # cube-local
        self.P = cube.to_bone(self.L)                     # bone frame (the cube's own rotation applied)
        self.x, self.y, self.z = self.P[..., 0], self.P[..., 1], self.P[..., 2]
        self.tag = cube.tag

    def inner(self, d=0.02):
        """The positions a hair under the surface (so the grain of a face belongs to the box it is on)."""
        return self.P - np.array(self.n) * d if not self.cube.rotation else self.cube.to_bone(self.L - np.array(self.n) * d)

    def cells(self, g):
        """Integer grain cells (g pixels across) of the texels."""
        q = np.floor(self.inner() / g + 1e-6).astype(np.int64)
        return q[..., 0], q[..., 1], q[..., 2]


def _neighbours(model):
    """Per bone: the cubes that can hide / shade its faces, in the bone's own frame.
    Returns {bone: (same_bone_cubes, [(cube, to_local)]) } where to_local maps this bone's frame into the
    other cube's bone frame (parent and children, in the rest pose)."""
    frames = model.rest_frames()
    kids = {}
    for b in model.bones:
        kids.setdefault(b.parent, []).append(b)
    out = {}
    for b in model.bones:
        R, O = frames[b.name]
        piv = np.array(b.pivot)
        near = []
        rel = ([model[b.parent]] if b.parent else []) + kids.get(b.name, [])
        for o in rel:
            R2, O2 = frames[o.name]
            piv2 = np.array(o.pivot)
            # this bone's frame -> model space -> the other bone's frame
            M = R2.T @ R
            t = R2.T @ (O - R @ piv - O2) + piv2

            def conv(P, M=M, t=t):
                return P @ M.T + t
            for c in o.cubes:
                near.append((c, conv))
        out[b.name] = near
    return out


def largest_rect(free):
    """The largest all-True rectangle of a bool array: (area, x, y, w, h)."""
    h, w = free.shape
    heights = [0] * w
    best = (0, 0, 0, 0, 0)
    for y in range(h):
        row = free[y]
        heights = [heights[x] + 1 if row[x] else 0 for x in range(w)]
        stack = []
        for x in range(w + 1):
            cur = heights[x] if x < w else 0
            start = x
            while stack and stack[-1][1] >= cur:
                sx, sh = stack.pop()
                if sh * (x - sx) > best[0]:
                    best = (sh * (x - sx), sx, y - sh + 1, x - sx, sh)
                start = sx
            stack.append((start, cur))
    return best


def analyse(model, crease=0.55, crease_dark=0.34):
    """Visibility of every face. Sets on each cube:
       cube.vis[face]   fraction of the face that is not buried in other cubes of its bone
       cube.grid[face]  (w, h, density) of its texel grid ((2, 2, 0) = a shared swatch)
       cube.ao[face]    per texel shading in [1 - crease_dark, 1] (creases)
    """
    near = _neighbours(model)
    for b in model.bones:
        info = [(c, *c.centre_radius()) for c in b.cubes]
        for c, cc, cr in info:
            c.vis, c.grid, c.ao, c.holes = {}, {}, {}, {}
            base = c.dens or model.dens
            same = [o for o, oc, orad in info if o is not c and np.linalg.norm(oc - cc) < cr + orad + 1.0]
            for f in FACES:
                fw, fh = c.face_size(f)
                aw, ah = max(1, int(round(fw * 8))), max(1, int(round(fh * 8)))
                P = c.to_bone(c.face_points(f, aw, ah, lift=0.03))
                hidden = np.zeros((ah, aw), bool)
                for o in same:
                    hidden |= o.contains(P)
                vis = 1.0 - float(hidden.mean())
                c.vis[f] = vis
                if c.src and f in c.src:
                    _, (u, v, us, vs), _ = c.src[f]
                    w, h, d = int(round(abs(us))), int(round(abs(vs))), base
                elif vis <= 0.0:
                    w, h, d = 2, 2, 0
                else:
                    d = base if (vis >= 0.34 or c.full) else (base / 2 if vis >= 0.12 else base / 4)
                    w, h = max(1, int(math.ceil(fw * d - 1e-6))), max(1, int(math.ceil(fh * d - 1e-6)))
                c.grid[f] = (w, h, d)
                c.holes[f] = []
                if d == 0:
                    continue
                # creases: probes above the surface, counted when they fall inside another box
                L = c.face_points(f, w, h)
                n = np.array(NORMAL[f])
                tang = [np.array(v, float) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1)) if abs(np.dot(v, n)) < 0.5]
                probes = [L + n * crease * 0.45] + [L + n * crease * 0.5 + t * s * crease for t in tang for s in (1, -1)]
                occ = np.zeros((h, w))
                for k, Lp in enumerate(probes):
                    Pb = c.to_bone(Lp)
                    inside = np.zeros((h, w), bool)
                    for o in same:
                        inside |= o.contains(Pb)
                    for o, conv in near[b.name]:
                        inside |= o.contains(conv(Pb))
                    occ += inside * (1.6 if k == 0 else 1.0)
                c.ao[f] = 1.0 - crease_dark * np.clip(occ / 3.2, 0, 1)
                # which texels can be seen at all (any of 2 x 2 samples in the open), for the packer: a large
                # buried rectangle inside a face is room for other faces
                c.holes[f] = []
                if vis < 0.8 and w * h >= 160 and c.share is None and c.nest:
                    Pb = c.to_bone(c.face_points(f, 2 * w, 2 * h, lift=0.03))
                    hid = np.zeros((2 * h, 2 * w), bool)
                    for o in same:
                        hid |= o.contains(Pb)
                    seen = ~hid.reshape(h, 2, w, 2).all(axis=(1, 3))
                    pad = np.pad(seen, 1)
                    grown = np.zeros_like(seen)
                    for dy in (0, 1, 2):
                        for dx in (0, 1, 2):
                            grown |= pad[dy:dy + h, dx:dx + w]
                    free = ~grown
                    for _ in range(2):
                        area, hx, hy, hw, hh = largest_rect(free)
                        if area < 96 or min(hw, hh) < 6:
                            break
                        c.holes[f].append((hx, hy, hw, hh))
                        free[hy:hy + hh, hx:hx + hw] = False
    return model


# ------------------------------------------------------------------ packing
class Skyline:
    def __init__(self, width):
        self.w = width
        self.sky = [[0, 0, width]]      # x, y, w

    def _fit(self, i, w):
        x = self.sky[i][0]
        if x + w > self.w:
            return None
        y, left, j = 0, w, i
        while left > 0:
            if j >= len(self.sky):
                return None
            y = max(y, self.sky[j][1])
            left -= self.sky[j][2]
            j += 1
        return y

    def place(self, w, h):
        best = None
        for i in range(len(self.sky)):
            y = self._fit(i, w)
            if y is not None and (best is None or (y + h, self.sky[i][0]) < (best[1] + h, best[2])):
                best = (i, y, self.sky[i][0])
        if best is None:
            raise ValueError(f'rect {w}x{h} does not fit')
        i, y, x = best
        self.sky.insert(i, [x, y + h, w])
        j = i + 1
        end = x + w
        while j < len(self.sky):
            sx, sy, sw = self.sky[j]
            if sx >= end:
                break
            if sx + sw <= end:
                self.sky.pop(j)
            else:
                self.sky[j] = [end, sy, sx + sw - end]
                break
        # merge neighbours of equal height
        k = 0
        while k < len(self.sky) - 1:
            if self.sky[k][1] == self.sky[k + 1][1]:
                self.sky[k][2] += self.sky[k + 1][2]
                self.sky.pop(k + 1)
            else:
                k += 1
        return x, y

    def height(self):
        return max(s[1] for s in self.sky)


def pack(model, width=512, swatch=(34, 30, 30)):
    """Assigns every face its texel rectangle. Returns the atlas height in use."""
    sky = Skyline(width)
    sky.place(4, 4)                      # the swatch buried faces share (top-left corner)
    items = []
    shared = {}
    for c in model.cubes():
        c.rect = {}
        for f in FACES:
            w, h, d = c.grid[f]
            if d == 0:
                c.rect[f] = (1, 1, 2, 2)
                continue
            if c.share is not None and not (c.src and f in c.src):
                key = (c.share, f, w, h)
                if key in shared:
                    shared[key].append((c, f))
                    continue
                shared[key] = [(c, f)]
            items.append((h, w, len(items), c, f))
    holes = []                           # buried rectangles inside faces already placed: [x, y, w, h]
    for h, w, _, c, f in sorted(items, key=lambda t: (-t[0], -t[1], t[2])):
        spot = None
        fits = [k for k, (hx, hy, hw, hh) in enumerate(holes) if hw >= w and hh >= h]
        if fits:
            k = min(fits, key=lambda k: holes[k][2] * holes[k][3])
            hx, hy, hw, hh = holes.pop(k)
            spot = (hx, hy)
            # what is left of the hole: a strip to the right and a strip below
            if hw - w >= 2:
                holes.append([hx + w, hy, hw - w, h])
            if hh - h >= 2:
                holes.append([hx, hy + h, hw, hh - h])
        x, y = spot or sky.place(w, h)
        c.rect[f] = (x, y, w, h)
        for hx, hy, hw, hh in c.holes.get(f, []):
            holes.append([x + hx, y + hy, hw, hh])
    for key, lst in shared.items():
        c0, f0 = lst[0]
        for c, f in lst[1:]:
            c.rect[f] = c0.rect[f0]
            c.shared_from = getattr(c, 'shared_from', {})
            c.shared_from[f] = True
    model.swatch = swatch
    return sky.height()


# ------------------------------------------------------------------ painting
def paint(model, width, height, ao=True):
    """Paints the atlas. A material is a callable(Face) returning an (h, w, 3) colour array (0..255), or a
    dict with 'rgb' and optional 'metal', 'rough' (0..255, scalars or arrays), 'glow' (bool array: glowing
    pupil texels), 'ao' (False: no crease shading on this face, or a 0..1 strength, or one per texel), 'edge'
    (0..255 added to the face's outermost texels where they are not in a crease: worn, lit edges).
    Returns {'color': RGBA image, 'mer': RGB image, 'glow': bool array}."""
    col = np.zeros((height, width, 4), np.uint8)
    mer = np.zeros((height, width, 3), np.uint8)
    mer[..., 2] = 215
    glow = np.zeros((height, width), bool)
    col[0:4, 0:4, :3] = model.swatch
    col[0:4, 0:4, 3] = 255
    for c in model.cubes():
        for f in FACES:
            w, h, d = c.grid[f]
            if d == 0 or getattr(c, 'shared_from', {}).get(f):
                continue
            x, y, _, _ = c.rect[f]
            if c.src and f in c.src:
                img, (u, v, us, vs), flip = c.src[f]
                x0, x1 = sorted([int(round(u)), int(round(u + us))])
                y0, y1 = sorted([int(round(v)), int(round(v + vs))])
                px = np.asarray(img)[y0:y1, x0:x1].copy()
                if flip:
                    px = px[:, ::-1]
                F = Face(c, f, w, h, d)
                res = c.mat(F, px) if c.mat else px
                if not isinstance(res, dict):
                    res = {'rgb': res}
            else:
                F = Face(c, f, w, h, d)
                res = c.mat(F)
                if not isinstance(res, dict):
                    res = {'rgb': res}
            rgb = np.asarray(res['rgb'], float)
            alpha = None
            if rgb.shape[-1] == 4:
                alpha = rgb[..., 3]
                rgb = rgb[..., :3]
            k = res.get('ao', True)
            if ao and k is not False:
                s = 1.0 if k is True else np.asarray(k, float)       # a strength, or one per texel
                rgb = rgb * (1.0 - s * (1.0 - c.ao[f]))[..., None]
            keep = np.ones((h, w), bool)         # (the buried rectangles of this face hold other faces)
            for hx, hy, hw, hh in c.holes.get(f, []):
                keep[hy:hy + hh, hx:hx + hw] = False
            a = np.full((h, w), 255.0) if alpha is None else alpha
            full = lambda v: np.broadcast_to(np.asarray(v, float), (h, w))
            e = res.get('edge', 0)
            if e:
                # worn edges: the outermost texels of a face that are not in a crease catch a little light
                ring = np.zeros((h, w), bool)
                ring[0, :] = ring[-1, :] = ring[:, 0] = ring[:, -1] = True
                rgb = rgb + (ring & (c.ao[f] > 0.985))[..., None] * float(e)
            col[y:y + h, x:x + w, :3][keep] = np.clip(np.round(rgb), 0, 255).astype(np.uint8)[keep]
            col[y:y + h, x:x + w, 3][keep] = np.clip(a, 0, 255).astype(np.uint8)[keep]
            mer[y:y + h, x:x + w, 0][keep] = np.clip(full(res.get('metal', 0)), 0, 255).astype(np.uint8)[keep]
            mer[y:y + h, x:x + w, 2][keep] = np.clip(full(res.get('rough', 215)), 0, 255).astype(np.uint8)[keep]
            if 'glow' in res:
                glow[y:y + h, x:x + w][keep] = np.asarray(res['glow'], bool)[keep]
    return {'color': Image.fromarray(col, 'RGBA'), 'mer': Image.fromarray(mer, 'RGB'), 'glow': glow}


# ------------------------------------------------------------------ export
def _num(v):
    v = round(float(v), 4)
    return 0.0 if v == 0 else v


def to_geometry(model, identifier, tex_w, tex_h, bounds=(4, 4, (0, 1.5, 0))):
    bones = []
    for b in model.bones:
        o = {'name': b.name}
        if b.parent:
            o['parent'] = b.parent
        o['pivot'] = [_num(v) for v in b.pivot]
        if b.rotation and any(abs(v) > 1e-9 for v in b.rotation):
            o['rotation'] = [_num(v) for v in b.rotation]
        cubes = []
        for c in b.cubes:
            q = {'origin': [_num(v) for v in c.origin], 'size': [_num(v) for v in c.size]}
            if c.inflate:
                q['inflate'] = _num(c.inflate)
            if c.rotation and any(abs(v) > 1e-9 for v in c.rotation):
                q['pivot'] = [_num(v) for v in (c.pivot or [0, 0, 0])]
                q['rotation'] = [_num(v) for v in c.rotation]
            uv = {}
            for f in FACES:
                x, y, w, h = c.rect[f]
                if f in ('up', 'down'):
                    uv[f] = {'uv': [x + w, y + h], 'uv_size': [-w, -h]}
                else:
                    uv[f] = {'uv': [x, y], 'uv_size': [w, h]}
            q['uv'] = uv
            cubes.append(q)
        if cubes:
            o['cubes'] = cubes
        bones.append(o)
    return {
        'format_version': '1.16.0',
        'minecraft:geometry': [{
            'description': {
                'identifier': identifier, 'texture_width': tex_w, 'texture_height': tex_h,
                'visible_bounds_width': bounds[0], 'visible_bounds_height': bounds[1], 'visible_bounds_offset': list(bounds[2]),
            },
            'bones': bones,
        }],
    }


def build(model, width=512, swatch=(34, 30, 30), ao=True, crease=0.55, crease_dark=0.34):
    """analyse + pack + paint. Returns (texture height (512 or 1024...), painted layers, used rows)."""
    analyse(model, crease=crease, crease_dark=crease_dark)
    used = pack(model, width, swatch)
    height = 256
    while height < used:
        height *= 2
    layers = paint(model, width, height, ao=ao)
    return height, layers, used


# ------------------------------------------------------------------ colour helpers
def rgb(*v):
    return np.array(v, float)


def pick(tones, t):
    """Per texel: tones[k] chosen by t in [0, 1) (k = floor(t * len))."""
    tones = np.asarray(tones, float)
    k = np.clip((np.asarray(t) * len(tones)).astype(int), 0, len(tones) - 1)
    return tones[k]


def blend(a, b, w):
    w = np.asarray(w, float)
    if w.ndim == np.asarray(a).ndim - 1 or (np.asarray(a).ndim == 1 and w.ndim >= 1):
        w = w[..., None]
    return np.asarray(a, float) * (1 - w) + np.asarray(b, float) * w
