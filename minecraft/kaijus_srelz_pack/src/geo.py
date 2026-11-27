"""Tiny geometry DSL for Bedrock entity models.

Everything is designed in *block* units (1 block = 16 model pixels) in
Bedrock model space: +y up, the creature faces -z (north), x is left/right.

Rotation sign rules (same as the game / Blockbench):
  * +rx tilts an up-pointing part forward (toward -z) and a forward-pointing
    part downward; a backward-pointing part (+z) goes up.
  * +rz tilts the top of an up-pointing part toward +x.
  * +ry turns a forward-pointing part toward -x.

Each cube gets a "material" that picks a tiling region of the texture atlas.
Every face samples a window of that region at a random offset, so dozens of
cubes can share one detailed, seamless skin texture without visible repeats.
"""
import json
import math
import random

PX = 16.0


def r2(v):
    return round(v, 3)


class Model:
    def __init__(self, identifier, tex_size, regions, k=0.5, seed=1):
        self.identifier = identifier
        self.tex_w, self.tex_h = tex_size
        self.regions = regions  # name -> (u, v, w, h) in UV units
        self.k = k  # UV units per model pixel
        self.bones = []
        self.bmap = {}
        self.rng = random.Random(seed)

    # ------------------------------------------------------------------ bones
    def bone(self, name, parent=None, pivot=(0, 0, 0), rot=None):
        if name in self.bmap:
            raise ValueError("duplicate bone " + name)
        if parent is not None and parent not in self.bmap:
            raise ValueError("unknown parent %s for %s" % (parent, name))
        b = {"name": name, "parent": parent, "pivot": tuple(pivot),
             "rotation": tuple(rot) if rot else None, "cubes": []}
        self.bones.append(b)
        self.bmap[name] = b
        return name

    # ------------------------------------------------------------------ cubes
    def box(self, bone, c, s, mat, rot=None, pivot=None, faces=None,
            k=None, inflate=None):
        """Axis box centred at c (blocks) with size s (blocks)."""
        if bone not in self.bmap:
            raise ValueError("unknown bone " + bone)
        sx, sy, sz = [max(0.02, v) for v in s]
        cx, cy, cz = c
        cube = {
            "origin": [r2((cx - sx / 2) * PX), r2((cy - sy / 2) * PX), r2((cz - sz / 2) * PX)],
            "size": [r2(sx * PX), r2(sy * PX), r2(sz * PX)],
        }
        if rot and any(abs(a) > 1e-6 for a in rot):
            p = pivot if pivot is not None else c
            cube["pivot"] = [r2(p[0] * PX), r2(p[1] * PX), r2(p[2] * PX)]
            cube["rotation"] = [r2(a) for a in rot]
        if inflate:
            cube["inflate"] = r2(inflate)
        cube["uv"] = self._uv(cube["size"], mat, faces or {}, k)
        self.bmap[bone]["cubes"].append(cube)
        return cube

    def _uv(self, size_px, mat, faces, k):
        k = self.k if k is None else k
        sx, sy, sz = size_px
        dims = {
            "north": (sx, sy), "south": (sx, sy),
            "east": (sz, sy), "west": (sz, sy),
            "up": (sx, sz), "down": (sx, sz),
        }
        out = {}
        for face, (w, h) in dims.items():
            m = faces.get(face, mat)
            if m is None:
                continue
            reg = self.regions[m]
            u0, v0, rw, rh = reg[:4]
            flag = reg[4] if len(reg) > 4 else None
            if flag == "fit":
                uw, vh, u, v = rw, rh, u0, v0
            elif flag == "vfit":  # gradient strips: full height, random column
                uw, vh, v = min(rw, max(0.25, w * k)), rh, v0
                u = u0 + self.rng.uniform(0, rw - uw)
            else:
                uw = min(rw, max(0.25, w * k))
                vh = min(rh, max(0.25, h * k))
                u = u0 + self.rng.uniform(0, rw - uw)
                v = v0 + self.rng.uniform(0, rh - vh)
            if face == "down":
                # Bedrock samples the down face upside-down; flip it back.
                out[face] = {"uv": [r2(u), r2(v + vh)], "uv_size": [r2(uw), r2(-vh)]}
            else:
                out[face] = {"uv": [r2(u), r2(v)], "uv_size": [r2(uw), r2(vh)]}
        return out

    # ----------------------------------------------------------- compounds
    def blob(self, bone, c, s, mat, rot=None, pivot=None, faces=None, r=0.22):
        """Rounded box made of three overlapping boxes (octagonal section)."""
        w, h, d = s
        p = pivot if pivot is not None else c
        self.box(bone, c, (w, h * (1 - r), d * (1 - 2 * r)), mat, rot, p, faces)
        self.box(bone, c, (w * (1 - 2 * r), h * (1 - r), d), mat, rot, p, faces)
        self.box(bone, c, (w * (1 - r), h, d * (1 - r)), mat, rot, p, faces)

    def rings(self, bone, c, s, mat, n, thick=(0.25, 0.5), grow=(0.25, 0.6),
              tilt=6.0, rot=None, pivot=None, faces=None, axis="y", span=0.9):
        """Keloid ridges: thin, slightly larger slabs stacked along an axis."""
        w, h, d = s
        rng = self.rng
        for i in range(n):
            t = (i + 0.5) / n
            g = rng.uniform(*grow)
            th = rng.uniform(*thick)
            if axis == "y":
                pos = (c[0], c[1] - h * span / 2 + h * span * t + rng.uniform(-0.15, 0.15), c[2])
                size = (w * (0.82 + rng.uniform(0, 0.1)) + g, th, d * (0.82 + rng.uniform(0, 0.1)) + g)
                lr = (rng.uniform(-tilt, tilt), 0, rng.uniform(-tilt, tilt))
            else:  # along z
                pos = (c[0], c[1], c[2] - d * span / 2 + d * span * t + rng.uniform(-0.15, 0.15))
                size = (w * (0.84 + rng.uniform(0, 0.08)) + g, h * (0.84 + rng.uniform(0, 0.08)) + g, th)
                lr = (0, rng.uniform(-tilt, tilt), rng.uniform(-tilt, tilt))
            if rot:
                lr = tuple(a + b for a, b in zip(lr, rot))
            self.box(bone, pos, size, mat, lr, pivot if rot else None, faces)

    def bumps(self, bone, c, s, mat, n, size=(0.4, 1.2), rot=None, pivot=None,
              sides=("north", "south", "east", "west"), faces=None):
        """Random lumps sitting on the surface of a box."""
        w, h, d = s
        rng = self.rng
        for _ in range(n):
            side = rng.choice(sides)
            a = rng.uniform(*size)
            b = rng.uniform(*size) * 0.8
            dep = rng.uniform(0.2, 0.45)
            y = c[1] + rng.uniform(-h / 2 + 0.3, h / 2 - 0.3)
            if side in ("north", "south"):
                z = c[2] + (d / 2 if side == "south" else -d / 2)
                x = c[0] + rng.uniform(-w / 2 + 0.3, w / 2 - 0.3)
                sz = (a, b, dep * 2)
            else:
                x = c[0] + (w / 2 if side == "east" else -w / 2)
                z = c[2] + rng.uniform(-d / 2 + 0.3, d / 2 - 0.3)
                sz = (dep * 2, b, a)
            lr = (rng.uniform(-15, 15), rng.uniform(-15, 15), rng.uniform(-15, 15))
            if rot:
                lr = tuple(p + q for p, q in zip(lr, rot))
            self.box(bone, (x, y, z), sz, mat, lr, pivot if rot else None, faces)

    # ------------------------------------------------------------- scaling
    def scale_bones(self, names, about, f):
        """Shrink/grow a set of bones (and their cubes) about a point (blocks)."""
        a = [v * PX for v in about]
        sc = lambda p: [r2(a[i] + (p[i] - a[i]) * f) for i in range(3)]
        for n in names:
            b = self.bmap[n]
            b["pivot"] = tuple(about[i] + (b["pivot"][i] - about[i]) * f for i in range(3))
            for c in b["cubes"]:
                c["origin"] = sc(c["origin"])
                c["size"] = [r2(v * f) for v in c["size"]]
                if "pivot" in c:
                    c["pivot"] = sc(c["pivot"])

    def translate_bones(self, names, off):
        """Move bones (pivots + cubes) by an offset in blocks."""
        o = [v * PX for v in off]
        for n in names:
            b = self.bmap[n]
            b["pivot"] = tuple(b["pivot"][i] + off[i] for i in range(3))
            for c in b["cubes"]:
                c["origin"] = [r2(c["origin"][i] + o[i]) for i in range(3)]
                if "pivot" in c:
                    c["pivot"] = [r2(c["pivot"][i] + o[i]) for i in range(3)]

    def scale_all(self, f):
        self.scale_bones([b["name"] for b in self.bones], (0, 0, 0), f)

    # ---------------------------------------------------------------- export
    def to_json(self, visible=(40, 40), vis_offset=(0, 0, 0)):
        bones = []
        for b in self.bones:
            o = {"name": b["name"]}
            if b["parent"]:
                o["parent"] = b["parent"]
            o["pivot"] = [r2(v * PX) for v in b["pivot"]]
            if b["rotation"]:
                o["rotation"] = [r2(a) for a in b["rotation"]]
            if b["cubes"]:
                o["cubes"] = b["cubes"]
            bones.append(o)
        return {
            "format_version": "1.12.0",
            "minecraft:geometry": [{
                "description": {
                    "identifier": self.identifier,
                    "texture_width": self.tex_w,
                    "texture_height": self.tex_h,
                    "visible_bounds_width": visible[0],
                    "visible_bounds_height": visible[1],
                    "visible_bounds_offset": list(vis_offset),
                },
                "bones": bones,
            }]
        }

    def cube_count(self):
        return sum(len(b["cubes"]) for b in self.bones)


# ---------------------------------------------------------------------------
# Forward kinematics (matches the game/Blockbench conventions). Used to place
# script effects (mouth, dorsal plates, tail tip) exactly on the model.
# ---------------------------------------------------------------------------

def _rot_matrix_bb(rx, ry, rz):
    """three.js Euler 'ZYX' matrix for Blockbench-space degrees."""
    x, y, z = [math.radians(a) for a in (rx, ry, rz)]
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return _mm(_mm(Rz, Ry), Rx)


def _mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mv(m, v):
    return [sum(m[i][k] * v[k] for k in range(3)) for i in range(3)]


def world_point(model, bone_name, point, extra_rot=None):
    """Transform a rest-pose point (blocks, Bedrock space) through the bone
    chain. extra_rot: {bone: (rx,ry,rz)} added animation rotations."""
    extra_rot = extra_rot or {}
    chain = []
    b = model.bmap[bone_name]
    while b:
        chain.append(b)
        b = model.bmap.get(b["parent"]) if b["parent"] else None
    # convert to blockbench space (x flipped)
    p = [-point[0], point[1], point[2]]
    for bone in chain:  # innermost first
        rot = list(bone["rotation"] or (0, 0, 0))
        er = extra_rot.get(bone["name"])
        if er:
            rot = [a + e for a, e in zip(rot, er)]
        piv = [-bone["pivot"][0], bone["pivot"][1], bone["pivot"][2]]
        m = _rot_matrix_bb(-rot[0], -rot[1], rot[2])
        rel = [p[i] - piv[i] for i in range(3)]
        rr = _mv(m, rel)
        p = [rr[i] + piv[i] for i in range(3)]
    return [-p[0], p[1], p[2]]


def save(path, data):
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)


# ---------------------------------------------------------------------------
# Organic sculpting: oriented boxes, lofted octagonal tubes, surface nodules.
#
# Bodies are described as a centre-line "Path" of elliptical cross-sections.
# Each span is filled with four boxes whose union is an octagonal prism, so
# necks, torsos, limbs and tails come out round and tapering instead of the
# stacked-crate look of axis-aligned cubes.
# ---------------------------------------------------------------------------
import numpy as np  # noqa: E402

T8 = math.tan(math.radians(22.5))
FACES = ("east", "west", "up", "down", "south", "north")


def V(*a):
    return np.array(a if len(a) != 1 else a[0], float)


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def _to_bb(v):
    return np.array([-v[0], v[1], v[2]], float)


def axes_to_bedrock(ax, ay, az):
    """Box local axes (unit vectors, model space) -> (Bedrock euler, face normals)."""
    R = np.column_stack([_to_bb(unit(ax)), _to_bb(unit(ay)), _to_bb(unit(az))])
    if np.linalg.det(R) < 0:
        R[:, 0] = -R[:, 0]
    sb = max(-1.0, min(1.0, -R[2, 0]))
    beta = math.asin(sb)
    if abs(sb) > 0.99999:
        alpha, gamma = math.atan2(-R[1, 2], R[1, 1]), 0.0
    else:
        alpha, gamma = math.atan2(R[2, 1], R[2, 2]), math.atan2(R[1, 0], R[0, 0])
    normals = {}
    for i, (pos, neg) in enumerate((("east", "west"), ("up", "down"), ("south", "north"))):
        n = np.array([-R[0, i], R[1, i], R[2, i]])
        normals[pos], normals[neg] = n, -n
    return (-math.degrees(alpha), -math.degrees(beta), math.degrees(gamma)), normals


def rot_about(v, axis, deg):
    """Rodrigues rotation of v about a unit axis."""
    v, k = np.asarray(v, float), unit(axis)
    a = math.radians(deg)
    return v * math.cos(a) + np.cross(k, v) * math.sin(a) + k * np.dot(k, v) * (1 - math.cos(a))


class Path:
    """Centre line with elliptical sections. pts: [(pos, a, b)], a = lateral
    half-width, b = half-depth toward `hint` (the dorsal/'up' side)."""

    def __init__(self, pts, hint=(0, 0, 1)):
        self.P = [V(p[0]) for p in pts]
        self.A = [float(p[1]) for p in pts]
        self.B = [float(p[2]) for p in pts]
        self.hint = V(hint)

    def __len__(self):
        return len(self.P)

    def seg_frame(self, i):
        i = max(0, min(len(self.P) - 2, i))
        d = unit(self.P[i + 1] - self.P[i])
        t = self.hint - np.dot(self.hint, d) * d
        if np.linalg.norm(t) < 1e-6:
            t = V(0, 1, 0) - d[1] * d
        t = unit(t)
        return np.cross(d, t), t, d

    def at(self, u):
        u = max(0.0, min(len(self.P) - 1.0, u))
        i = min(int(u), len(self.P) - 2)
        f = u - i
        c = self.P[i] * (1 - f) + self.P[i + 1] * f
        return c, self.A[i] * (1 - f) + self.A[i + 1] * f, self.B[i] * (1 - f) + self.B[i + 1] * f, self.seg_frame(i)

    def surface(self, u, phi, out=0.0):
        """Point + outward normal on the skin. phi: 0 = +lateral, 90 = dorsal."""
        c, a, b, (l, t, d) = self.at(u)
        cs, sn = math.cos(math.radians(phi)), math.sin(math.radians(phi))
        nrm = unit((cs / a) * l + (sn / b) * t)
        return c + a * cs * l + b * sn * t + nrm * out, nrm, d


def _mat_faces(mat, normals, ctx=None):
    if callable(mat):
        return {f: mat(normals[f], ctx) for f in FACES}
    return {f: mat for f in FACES}


def orient(axes):
    """(Bedrock euler, face normals, face u/v directions) for local box axes."""
    ax, ay, az = axes
    R = np.column_stack([_to_bb(unit(ax)), _to_bb(unit(ay)), _to_bb(unit(az))])
    if np.linalg.det(R) < 0:
        R[:, 0] = -R[:, 0]
    rot, normals = axes_to_bedrock(ax, ay, az)
    dv = lambda v: np.array([-v[0], v[1], v[2]])  # bb -> model space
    # direction in which texture u / v grow across the north/south faces
    uvdir = {"south": (dv(R[:, 0]), dv(-R[:, 1])), "north": (dv(-R[:, 0]), dv(-R[:, 1]))}
    return rot, normals, uvdir


def _obox(self, bone, c, size, axes, mat, k=None, ctx=None, uv=None):
    """Arbitrarily oriented box. axes = (local x, y, z) directions."""
    if bone not in self.bmap:
        raise ValueError("unknown bone " + bone)
    rot, normals, _ = orient(axes)
    sx, sy, sz = [max(0.03, float(v)) for v in size]
    c = [float(v) for v in c]
    cube = {
        "origin": [r2((c[0] - sx / 2) * PX), r2((c[1] - sy / 2) * PX), r2((c[2] - sz / 2) * PX)],
        "size": [r2(sx * PX), r2(sy * PX), r2(sz * PX)],
    }
    if any(abs(a) > 0.01 for a in rot):
        cube["pivot"] = [r2(v * PX) for v in c]
        cube["rotation"] = [r2(a) for a in rot]
    cube["uv"] = uv if uv is not None else self._uv(cube["size"], None, _mat_faces(mat, normals, ctx), k)
    self.bmap[bone]["cubes"].append(cube)
    return cube


# facet columns of a sleeve texture, by facet angle order (see atlas.py):
#   col 0 = ventral (-t), 2 = +l side, 4 = dorsal (+t), 6 = -l side
def _sleeve_face(reg, col, f0, f1, udir, vdir, around, d):
    u0, v0, W, H = reg[:4]
    cw = W / 8.0
    ua, ub = u0 + col * cw, u0 + (col + 1) * cw
    vt, vb = v0 + (1 - f1) * H, v0 + (1 - f0) * H   # top of texture = far end of the path
    if float(np.dot(udir, around)) < 0:
        ua, ub = ub, ua
    if float(np.dot(vdir, -d)) < 0:
        vt, vb = vb, vt
    return {"uv": [r2(ua), r2(vt)], "uv_size": [r2(ub - ua), r2(vb - vt)]}


def _section(self, bone, c, L, a, b, frame, mat, shape="oct", k=None, sleeve=None, caps=None):
    """One rounded slice. With sleeve=(region, f0, f1) the eight outer facets
    are UV-mapped as a continuous cylindrical unwrap and hidden faces are
    dropped; otherwise faces sample random windows of `mat`."""
    l, t, d = frame
    ctx = {"l": l, "t": t, "d": d}
    if shape == "box":
        self.obox(bone, c, (2 * a, 2 * b, L), (l, t, d), mat, k, ctx)
        return
    if shape == "plus":
        self.obox(bone, c, (2 * a, 2 * b * 0.6, L), (l, t, d), mat, k, ctx)
        self.obox(bone, c, (2 * a * 0.6, 2 * b, L * 1.01), (l, t, d), mat, k, ctx)
        return
    r = math.hypot(a, b)
    rho = math.atan2(b, a)
    hl, hw = (1 + T8) * r / 2, a * b * (1 - T8) / r
    # (facet angle, facet half-width, half-depth through the body, south col, north col)
    specs = ((0.0, b * T8, a, 2, 6), (rho, hw, hl, 3, 7), (math.pi / 2, a * T8, b, 4, 0), (math.pi - rho, hw, hl, 5, 1))
    reg = self.regions[sleeve[0]] if sleeve else None
    for j, (ang, fw, depth, cs, cn) in enumerate(specs):
        nrm = math.cos(ang) * l + math.sin(ang) * t
        around = -math.sin(ang) * l + math.cos(ang) * t
        axes = (around, d, nrm)
        Lj = L * (1 + 0.006 * j)
        if reg is None:
            self.obox(bone, c, (2 * fw, Lj, 2 * depth), axes, mat, k, ctx)
            continue
        _, normals, uvdir = orient(axes)
        uv = {}
        for face, col, arnd in (("south", cs, around), ("north", cn, -around)):
            uv[face] = _sleeve_face(reg, col, sleeve[1], sleeve[2], uvdir[face][0], uvdir[face][1], arnd, d)
        # end faces: the little step between slices reads as a skin crease
        cm = caps or getattr(self, "cap_mat", "skin2")
        size_px = [2 * fw * PX, Lj * PX, 2 * depth * PX]
        uv.update(self._uv(size_px, None, {"up": cm, "down": cm, "north": None, "south": None, "east": cm, "west": cm}, k))
        self.obox(bone, c, (2 * fw, Lj, 2 * depth), axes, None, uv=uv)


def _loft(self, bone, path, i0=0, i1=None, mat="skin", shape="oct", overlap=0.14, wobble=0.03, k=None, sub=1,
          sleeve=None, frange=None, caps=None):
    """Fill path spans i0..i1 with rounded slices.

    sleeve: name of a sleeve region -> continuous skin along/around the part.
    frange: (f at path start, f at path end) inside the sleeve; defaults to
    the whole path = whole sleeve height.  `wobble` alternates the radius per
    slice (reads as skin folds and avoids coplanar faces).
    """
    i1 = len(path) - 1 if i1 is None else i1
    cum = [0.0]
    for i in range(len(path) - 1):
        cum.append(cum[-1] + float(np.linalg.norm(path.P[i + 1] - path.P[i])))
    total = cum[-1] or 1.0
    fa, fb = frange if frange else (0.0, 1.0)
    for i in range(i0, i1):
        for s in range(sub):
            u0, u1 = i + s / sub, i + (s + 1) / sub
            c0, a0, b0, fr = path.at(u0)
            c1, a1, b1, _ = path.at(u1 - 1e-6)
            L = float(np.linalg.norm(c1 - c0))
            Lbox = L * (1 + overlap) + 0.12
            g = 1 + wobble * (1 if (i * sub + s) % 2 == 0 else -1) * self.rng.uniform(0.5, 1.2)
            sl = None
            if sleeve:
                arc0 = cum[i] + (cum[i + 1] - cum[i]) * (s / sub)
                mid = (arc0 + L / 2) / total
                half = (Lbox / 2) / total
                f0 = fa + (fb - fa) * max(0.0, mid - half)
                f1 = fa + (fb - fa) * min(1.0, mid + half)
                sl = (sleeve, f0, f1)
            end = (i == i0 and s == 0) or (i == i1 - 1 and s == sub - 1)
            self.section(bone, (c0 + c1) / 2, Lbox, (a0 + a1) / 2 * g, (b0 + b1) / 2 * g, fr, mat, shape, k, sl,
                         caps if end else None)


def _nodules(self, bone, path, n, u_rng, phis, size=(0.6, 1.4), mat="skin2", elong=(1.2, 2.6),
             along=True, sink=0.55, twist=25.0, mirror=True, k=None):
    """Keloid lumps hugging the skin of a lofted path. phis: [(lo, hi)] angle
    ranges; with mirror=True each lump is repeated on the other side."""
    rng = self.rng
    for _ in range(n):
        u = rng.uniform(*u_rng)
        lo, hi = rng.choice(phis)
        phi = rng.uniform(lo, hi)
        w = rng.uniform(*size)
        ln = w * rng.uniform(*elong)
        th = w * rng.uniform(0.45, 0.8)
        tw = rng.uniform(-twist, twist)
        for side in ((1, -1) if mirror else (1,)):
            ph = phi if side == 1 else 180 - phi
            p, nrm, d = path.surface(u, ph)
            around = unit(np.cross(d, nrm))
            z = d if along else around
            x = around if along else d
            z2 = rot_about(z, nrm, tw * side)
            x2 = rot_about(x, nrm, tw * side)
            self.obox(bone, p + nrm * th * (0.5 - sink), (w, th, ln), (x2, nrm, z2), mat, k)


Model.obox = _obox
Model.section = _section
Model.loft = _loft
Model.nodules = _nodules
