"""Shared rig core: cubes and bones, texture painting, atlas packing and forward kinematics.

Coordinates are Blockbench's own: +Y is up, the character faces north (-Z) and
the character's RIGHT side is +X.  One unit is one Minecraft model pixel; the
texture is painted at TPU texels per unit.

A character module fills BONES (via bone()/cube()) and MATS, then the exporter
packs, paints and writes everything.
"""
import math
from collections import OrderedDict

import numpy as np

TPU = 2  # texels per model unit

# --------------------------------------------------------------------------
# Rig containers
# --------------------------------------------------------------------------


class Cube:
    def __init__(self, name, frm, to, mat, faces=None, painter=None, rot=None, origin=None):
        self.name = name
        self.frm = [float(v) for v in frm]
        self.to = [float(v) for v in to]
        assert all(self.to[i] > self.frm[i] for i in range(3)), name
        self.mat = mat
        self.faces = dict(faces or {})  # face -> material override
        self.painter = painter  # fn(ctx) for custom detail
        self.rot = rot
        self.origin = origin
        self.uv = {}  # face -> [u1, v1, u2, v2] (filled by the atlas packer)


class Bone:
    def __init__(self, name, parent, pivot, rot=None):
        self.name = name
        self.parent = parent
        self.pivot = [float(v) for v in pivot]
        self.rot = [float(v) for v in (rot or [0, 0, 0])]
        self.cubes = []
        self.children = []


BONES = OrderedDict()


def bone(name, parent, pivot, rot=None):
    b = Bone(name, parent, pivot, rot)
    BONES[name] = b
    if parent:
        BONES[parent].children.append(name)
    return b


def mx(lo, hi, s):
    """Mirror an x interval for side s (+1 right / -1 left)."""
    a, b = lo * s, hi * s
    return (min(a, b), max(a, b))


def cube(bone_name, name, frm, to, mat, s=1, faces=None, painter=None, rot=None, origin=None):
    x0, x1 = mx(frm[0], to[0], s)
    if s < 0 and faces:
        swap = {"east": "west", "west": "east"}
        faces = {swap.get(k, k): v for k, v in faces.items()}
    if rot is not None and s < 0:
        rot = [rot[0], -rot[1], -rot[2]]
    if origin is not None and s < 0:
        origin = [-origin[0], origin[1], origin[2]]
    c = Cube(name, [x0, frm[1], frm[2]], [x1, to[1], to[2]], mat, faces, painter, rot, origin)
    BONES[bone_name].cubes.append(c)
    return c



# --------------------------------------------------------------------------
# Materials: {name: dict(tones=[rgb...], w=[weights], spots=[(rgb, probability)],
#                        grime=(scale, threshold, darken) optional)}
# --------------------------------------------------------------------------

MATS = {}


def reset(materials, tpu=2):
    """Start a new character: clear the rig, install its materials and texel density."""
    global TPU
    BONES.clear()
    MATS.clear()
    MATS.update(materials)
    TPU = tpu


def hash01(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791)
    h = (h ^ (seed * 2654435761)) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF) / 65535.0


class PaintCtx:
    def __init__(self, cube_obj, face, X, Y, Z, rng):
        self.cube = cube_obj
        self.face = face
        self.X, self.Y, self.Z = X, Y, Z
        self.rng = rng
        self.rgb = np.zeros(X.shape + (3,), np.float32)
        self.emi = np.zeros(X.shape + (3,), np.float32)

    def paint(self, mat, mask=None, mult=1.0):
        if "cell" in MATS[mat]:
            col = voxel_fill(mat, self) * mult
        else:
            col = material_fill(mat, self.X, self.Y, self.Z, self.rng) * mult
        if mask is None:
            self.rgb[...] = col
        else:
            self.rgb[mask] = col[mask]

    def glow(self, color, mask=None, strength=1.0):
        c = np.array(color, np.float32) * strength
        if mask is None:
            self.emi[...] = c
        else:
            self.emi[mask] = c


def cell_grid(ctx, cell):
    """Split a face into whole cells of about `cell` model pixels.  Returns per-texel
    cell indices (cv, cu), the cell counts and edge masks (top, bottom, left, right)."""
    H, W = ctx.X.shape
    c = cell * TPU
    nu, nv = max(1, int(round(W / c))), max(1, int(round(H / c)))
    iu = (np.arange(W) * nu) // W
    iv = (np.arange(H) * nv) // H
    cu, cv = np.meshgrid(iu, iv)
    left = np.zeros((H, W), bool)
    left[:, 0] = True
    left[:, 1:] = cu[:, 1:] != cu[:, :-1]
    right = np.zeros((H, W), bool)
    right[:, -1] = True
    right[:, :-1] = cu[:, :-1] != cu[:, 1:]
    top = np.zeros((H, W), bool)
    top[0, :] = True
    top[1:, :] = cv[1:, :] != cv[:-1, :]
    bottom = np.zeros((H, W), bool)
    bottom[-1, :] = True
    bottom[:-1, :] = cv[:-1, :] != cv[1:, :]
    return cv, cu, nv, nu, (top, bottom, left, right)


def voxel_fill(mat, ctx):
    """Blocky "every pixel is a little cube" look: one tone per cell (about one model pixel),
    a lit top/left edge and a shaded bottom/right edge on every cell, optional big patches."""
    m = MATS[mat]
    rng = ctx.rng
    cv, cu, nv, nu, (top, bottom, left, right) = cell_grid(ctx, m["cell"])
    tones = np.array(m["tones"], np.float32)
    w = np.array(m["w"], np.float64)
    pick = rng.choice(len(tones), size=(nv, nu), p=w / w.sum())
    cells = tones[pick]
    # cell centres in model space (for position-based patches)
    rep_v = np.array([np.argmax(cv[:, 0] == j) for j in range(nv)])
    rep_u = np.array([np.argmax(cu[0, :] == i) for i in range(nu)])
    PX, PY, PZ = (A[np.ix_(rep_v, rep_u)] for A in (ctx.X, ctx.Y, ctx.Z))
    for p_scale, thresh, p_tones in m.get("patches", ()):
        g = sum(hash01(np.floor(PX / (p_scale * k) + 500), np.floor(PY / (p_scale * k) + 500),
                       np.floor(PZ / (p_scale * k) + 500), 23 + int(k * 10)) for k in (1, 1.7)) / 2
        hit = g > thresh
        pt = np.array(p_tones, np.float32)
        cells[hit] = pt[rng.integers(0, len(pt), size=hit.sum())]
    for spot_col, prob in m.get("spots", ()):
        sp = rng.random((nv, nu)) < prob
        cells[sp] = np.array(spot_col, np.float32)
    col = cells[cv, cu].copy()
    b = m.get("bevel", 0.14)
    if b:
        col[top | left] *= 1 + b
        col[bottom | right] *= 1 - b
        col[(bottom | right) & (top | left)] /= (1 + b) * (1 - b)
    g = m.get("grain", 0.0)
    if g:
        # fine per-texel grain inside each flat cell (a granite-like surface instead of bevelled tiles)
        col *= np.clip(1 + g * rng.standard_normal(col.shape[:2]), 0.6, 1.4)[..., None]
    return col


def material_fill(mat, X, Y, Z, rng):
    m = MATS[mat]
    tones = np.array(m["tones"], np.float32)
    w = np.array(m["w"], np.float64)
    idx = rng.choice(len(tones), size=X.shape, p=w / w.sum())
    col = tones[idx]
    # low frequency mottling so the grain clumps like the reference
    q = 1.5
    lf = hash01(np.floor(X / q + 1000), np.floor(Y / q + 1000), np.floor(Z / q + 1000), 7)
    col = col * (0.95 + 0.10 * lf[..., None])
    for spot_col, p in m["spots"]:
        sp = rng.random(X.shape) < p
        col[sp] = np.array(spot_col, np.float32) * (0.9 + 0.2 * rng.random((sp.sum(), 1)))
    if "grime" in m:
        g_scale, g_thresh, g_dark = m["grime"]
        g = sum(
            hash01(np.floor(X / (g_scale * k) + 500), np.floor(Y / (g_scale * k) + 500), np.floor(Z / (g_scale * k) + 500), 11 + k)
            for k in (1, 2)
        ) / 2
        col[g > g_thresh] *= g_dark
    return col


def face_dims(c, face):
    dx, dy, dz = (c.to[i] - c.frm[i] for i in range(3))
    return {
        "north": (dx, dy), "south": (dx, dy),
        "east": (dz, dy), "west": (dz, dy),
        "up": (dx, dz), "down": (dx, dz),
    }[face]


def tex_size(v):
    return max(1, int(round(v * TPU)))


def face_points(c, face, W, H):
    """3D position of every texel centre, using Blockbench's per-face UV orientation."""
    (x0, y0, z0), (x1, y1, z1) = c.frm, c.to
    s = (np.arange(W) + 0.5) / W
    t = (np.arange(H) + 0.5) / H
    S, T = np.meshgrid(s, t)
    full = np.full_like(S, 0.0)
    if face == "north":
        return x1 - S * (x1 - x0), y1 - T * (y1 - y0), full + z0
    if face == "south":
        return x0 + S * (x1 - x0), y1 - T * (y1 - y0), full + z1
    if face == "east":
        return full + x1, y1 - T * (y1 - y0), z1 - S * (z1 - z0)
    if face == "west":
        return full + x0, y1 - T * (y1 - y0), z0 + S * (z1 - z0)
    if face == "up":
        return x0 + S * (x1 - x0), full + y1, z0 + T * (z1 - z0)
    if face == "down":
        return x0 + S * (x1 - x0), full + y0, z1 - T * (z1 - z0)
    raise ValueError(face)


FACES = ["north", "east", "south", "west", "up", "down"]

# --------------------------------------------------------------------------
# Texture atlas
# --------------------------------------------------------------------------


def all_cubes():
    for b in BONES.values():
        for c in b.cubes:
            yield b, c


def pack_atlas(width=512):
    """Lay each cube out in a box-UV style cross and shelf-pack the crosses."""
    blocks = []
    for _, c in all_cubes():
        W = tex_size(c.to[0] - c.frm[0])
        H = tex_size(c.to[1] - c.frm[1])
        D = tex_size(c.to[2] - c.frm[2])
        blocks.append((c, W, H, D, 2 * D + 2 * W, D + H))
    order = sorted(blocks, key=lambda b: (-b[5], -b[4]))
    x = y = shelf_h = 0
    for c, W, H, D, bw, bh in order:
        if x + bw > width:
            x, y = 0, y + shelf_h
            shelf_h = 0
        ox, oy = x, y
        c.uv = {
            "up": [ox + D, oy, ox + D + W, oy + D],
            "down": [ox + D + W, oy, ox + D + 2 * W, oy + D],
            "east": [ox, oy + D, ox + D, oy + D + H],
            "north": [ox + D, oy + D, ox + D + W, oy + D + H],
            "west": [ox + D + W, oy + D, ox + 2 * D + W, oy + D + H],
            "south": [ox + 2 * D + W, oy + D, ox + 2 * D + 2 * W, oy + D + H],
        }
        x += bw
        shelf_h = max(shelf_h, bh)
    used_h = y + shelf_h
    height = 64
    while height < used_h:
        height *= 2
    return width, height


def paint_atlas(width, height, seed=1987):
    rgb = np.zeros((height, width, 3), np.float32)
    emi = np.zeros((height, width, 3), np.float32)
    ci = 0
    for _, c in all_cubes():
        ci += 1
        for fi, face in enumerate(FACES):
            u1, v1, u2, v2 = c.uv[face]
            W, H = u2 - u1, v2 - v1
            X, Y, Z = face_points(c, face, W, H)
            rng = np.random.default_rng(seed + ci * 16 + fi)
            ctx = PaintCtx(c, face, X, Y, Z, rng)
            if c.painter:
                c.painter(ctx)
            else:
                ctx.paint(c.faces.get(face, c.mat))
            rgb[v1:v2, u1:u2] = ctx.rgb
            emi[v1:v2, u1:u2] = ctx.emi
    return np.clip(rgb, 0, 255).astype(np.uint8), np.clip(emi, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# Forward kinematics (mirrors Blockbench's preview maths)
# --------------------------------------------------------------------------


def rot_zyx(rx, ry, rz):
    """three.js Euler order 'ZYX' (degrees) -> 3x3 matrix  (M = Rz @ Ry @ Rx)."""
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def world_matrices(pose, only=None):
    """pose: {bone: {'rotation': [x,y,z], 'position': [x,y,z]}} in Bedrock animation values.

    Returns {bone: 4x4 matrix} mapping (point - bone.pivot) to world space.  With
    `only`, just those bones and their ancestors are evaluated.
    """
    names = BONES.keys()
    if only is not None:
        need = set()
        for n in only:
            while n and n not in need:
                need.add(n)
                n = BONES[n].parent
        names = [n for n in BONES if n in need]
    out = {}
    for name in names:
        b = BONES[name]
        p = pose.get(name, {})
        ar = p.get("rotation", [0, 0, 0])
        ap = p.get("position", [0, 0, 0])
        rot = [b.rot[0] - ar[0], b.rot[1] - ar[1], b.rot[2] + ar[2]]
        parent_pivot = BONES[b.parent].pivot if b.parent else [0, 0, 0]
        t = [b.pivot[i] - parent_pivot[i] for i in range(3)]
        t = [t[0] - ap[0], t[1] + ap[1], t[2] + ap[2]]
        M = np.eye(4)
        M[:3, :3] = rot_zyx(*rot)
        M[:3, 3] = t
        out[name] = (out[b.parent] @ M) if b.parent else M
    return out


def to_world(mats, bone_name, point):
    b = BONES[bone_name]
    v = np.array([point[0] - b.pivot[0], point[1] - b.pivot[1], point[2] - b.pivot[2], 1.0])
    return (mats[bone_name] @ v)[:3]


def dir_world(mats, bone_name, d):
    return mats[bone_name][:3, :3] @ np.array(d, float)
