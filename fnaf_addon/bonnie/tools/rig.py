"""Bonnie geometry, texture painting and forward kinematics.

Coordinates are Blockbench's own: +Y is up, the character faces north (-Z) and
the character's RIGHT side is +X.  One unit is one Minecraft model pixel; the
texture is painted at TPU texels per unit so the pixel grain matches the
reference sheet.
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
# Materials (albedo tones sampled from the reference palette)
# --------------------------------------------------------------------------

MATS = {
    "fur": dict(
        tones=[(54, 57, 94), (60, 63, 103), (66, 69, 112), (72, 75, 121), (78, 81, 130), (85, 88, 140)],
        w=[1, 2, 3, 3, 2, 1],
        spots=[((100, 72, 66), 0.02), ((86, 62, 60), 0.012), ((44, 46, 76), 0.015)],
    ),
    "fur_dark": dict(
        tones=[(30, 31, 54), (35, 37, 62), (40, 42, 70), (45, 47, 78)],
        w=[1, 2, 2, 1],
        spots=[((62, 44, 40), 0.03)],
    ),
    "white": dict(
        tones=[(140, 136, 136), (151, 147, 146), (162, 158, 157), (172, 168, 167), (182, 178, 176), (193, 189, 187)],
        w=[1, 2, 3, 3, 2, 1],
        spots=[((122, 118, 120), 0.045), ((150, 138, 128), 0.03)],
    ),
    "red": dict(
        tones=[(102, 23, 25), (114, 29, 30), (126, 35, 36), (138, 41, 41), (150, 47, 46)],
        w=[1, 2, 3, 2, 1],
        spots=[((84, 17, 19), 0.06)],
    ),
    "red_dark": dict(tones=[(70, 13, 15), (80, 17, 18), (90, 21, 22)], w=[1, 2, 1], spots=[]),
    "black": dict(tones=[(15, 15, 16), (20, 20, 21), (26, 25, 25), (32, 31, 30)], w=[1, 2, 2, 1], spots=[]),
    "endo": dict(
        tones=[(36, 34, 34), (44, 42, 41), (52, 49, 48), (60, 57, 55), (70, 66, 63)],
        w=[1, 2, 3, 2, 1],
        spots=[((84, 64, 52), 0.05)],
    ),
    "endo_light": dict(tones=[(70, 67, 64), (80, 77, 73), (90, 86, 81), (102, 98, 92)], w=[1, 2, 2, 1], spots=[]),
    "cream": dict(tones=[(198, 184, 150), (208, 194, 161), (216, 203, 172), (224, 212, 184)], w=[1, 2, 2, 1], spots=[]),
    "drumhead": dict(
        tones=[(196, 181, 154), (205, 191, 165), (213, 200, 175), (221, 209, 185), (229, 218, 196)],
        w=[1, 2, 3, 2, 1],
        spots=[((178, 160, 132), 0.05)],
    ),
    "banjo_purple": dict(tones=[(84, 37, 116), (96, 45, 132), (108, 53, 146), (120, 61, 160)], w=[1, 2, 2, 1], spots=[]),
    "wood": dict(tones=[(38, 27, 24), (46, 33, 29), (54, 39, 33), (62, 45, 37)], w=[1, 2, 2, 1], spots=[]),
    "brass": dict(tones=[(150, 128, 88), (166, 144, 100), (182, 160, 114), (196, 176, 130)], w=[1, 2, 2, 1], spots=[]),
    "metal": dict(tones=[(176, 176, 178), (192, 192, 194), (206, 206, 208)], w=[1, 2, 1], spots=[]),
    "pupil_red": dict(tones=[(255, 52, 44)], w=[1], spots=[]),
}


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
# Detail painters
# --------------------------------------------------------------------------

PUPIL_Y = 39.875
PUPIL_X = 2.375


def p_socket(ctx):
    """Back wall of the eye sockets: black with a red glow around each pupil."""
    if ctx.face != "north":
        ctx.paint(ctx.cube.mat)
        return
    ctx.paint("black")
    for sx in (PUPIL_X, -PUPIL_X):
        d = np.maximum(np.abs(ctx.X - sx), np.abs(ctx.Y - PUPIL_Y))
        ring = (d < 1.35) & (d >= 0.5)
        k = np.clip(1.0 - (d - 0.5) / 0.85, 0, 1)[..., None]
        glow = np.array([120, 12, 10], np.float32)
        ctx.rgb[ring] = (ctx.rgb * (1 - k) + glow * k)[ring]
        ctx.emi[ring] = (glow * k * 0.9)[ring]


def p_forehead(ctx):
    ctx.paint(ctx.cube.mat)
    if ctx.face == "north":
        streak = (np.abs(ctx.X - 0.25) < 0.8) & (ctx.rng.random(ctx.X.shape) < 0.45)
        ctx.rgb[streak] = np.array([92, 64, 58], np.float32) * (0.85 + 0.3 * ctx.rng.random((streak.sum(), 1)))


def p_ear(ctx):
    ctx.paint("fur")
    if ctx.face == "north":
        c = ctx.cube
        inner = (
            (ctx.X > c.frm[0] + 0.5) & (ctx.X < c.to[0] - 0.5)
            & (ctx.Y < c.to[1] - 0.5) & (ctx.Y > c.frm[1] + 0.25)
        )
        ctx.paint("white", inner, mult=0.97)


def p_muzzle(ctx):
    ctx.paint("white")
    if ctx.face == "north":
        low = ctx.Y < ctx.cube.frm[1] + 0.5
        ctx.rgb[low] *= 0.86


def p_bowtie(ctx):
    ctx.paint("red")
    if ctx.face == "north":
        c = ctx.cube
        edge = (ctx.Y < c.frm[1] + 0.5) | (ctx.Y > c.to[1] - 0.5)
        ctx.rgb[edge] *= 0.8


def p_knot(ctx):
    ctx.paint("red_dark")


def p_eye_glow(ctx):
    """Performance eyes: glowing white with a purple pupil."""
    c = ctx.cube
    cx = (c.frm[0] + c.to[0]) / 2
    cy = (c.frm[1] + c.to[1]) / 2
    white = np.array([248, 246, 255], np.float32)
    ctx.rgb[...] = white
    ctx.glow((150, 146, 160))
    if ctx.face == "north":
        pupil = (np.abs(ctx.X - cx) < 0.5) & (np.abs(ctx.Y - cy) < 0.5)
        purple = np.array([176, 38, 236], np.float32)
        ctx.rgb[pupil] = purple
        ctx.emi[pupil] = purple * 0.8


def p_pupil(ctx):
    ctx.paint("pupil_red")
    ctx.glow((255, 60, 50))


# Banjo drum, painted in the banjo bone's local frame (drum centre = origin)
BANJO_PIVOT = [2.0, 22.25, -7.25]
DRUM_R = 5.5
HEAD_R = 4.75


def p_drum(ctx):
    lx = ctx.X - BANJO_PIVOT[0]
    ly = ctx.Y - BANJO_PIVOT[1]
    lz = ctx.Z - BANJO_PIVOT[2]
    if ctx.face == "north":
        r = np.sqrt(lx ** 2 + ly ** 2)
        ctx.paint("banjo_purple")
        head = r < HEAD_R
        ctx.paint("drumhead", head)
        ring = (r >= HEAD_R) & (r < HEAD_R + 0.5)
        ctx.rgb[ring] *= 0.62
    elif ctx.face == "south":
        ctx.paint("wood")
        r = np.sqrt(lx ** 2 + ly ** 2)
        ctx.rgb[(r > 2.0) & (r < 2.5)] *= 0.7
    else:
        ctx.paint("banjo_purple")
        back = lz > 0.25
        ctx.paint("wood", back)


def p_fingerboard(ctx):
    ctx.paint("wood")
    if ctx.face == "north":
        lx = ctx.X - BANJO_PIVOT[0]
        frets = np.abs(((lx + 16.5) % 1.5) - 0.75) > 0.55
        ctx.rgb[frets] = np.array([150, 140, 122], np.float32)
        dots = (np.abs(ctx.Y - BANJO_PIVOT[1]) < 0.3) & (np.abs(((lx + 16.5) % 3.0) - 1.5) < 0.3)
        ctx.rgb[dots] = np.array([210, 205, 190], np.float32)


def p_headstock(ctx):
    ctx.paint("banjo_purple")
    if ctx.face == "north":
        c = ctx.cube
        border = (
            (ctx.X < c.frm[0] + 0.5) | (ctx.X > c.to[0] - 0.5)
            | (ctx.Y < c.frm[1] + 0.5) | (ctx.Y > c.to[1] - 0.5)
        )
        ctx.rgb[border] *= 0.7


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------


def build():
    BONES.clear()
    bone("root", None, [0, 0, 0])

    # ---- body / pelvis ---------------------------------------------------
    bone("body", "root", [0, 19, 0])
    cube("body", "pelvis", [-5.5, 18.25, -3.5], [5.5, 21, 3.5], "fur")
    cube("body", "tail", [-1.375, 18.5, 3.5], [1.375, 20.75, 5], "white")

    # ---- torso -----------------------------------------------------------
    bone("torso", "body", [0, 21, 0])
    cube("torso", "waist_joint", [-3.5, 20.5, -2.5], [3.5, 21.75, 2.5], "endo")
    cube("torso", "chest", [-5.5, 21.5, -3.75], [5.5, 32.5, 3.75], "fur")
    cube("torso", "belly", [-4, 21.75, -4], [4, 29.5, -3.75], "white")
    cube("torso", "belly_top", [-3.25, 29.5, -4], [3.25, 30.25, -3.75], "white")
    cube("torso", "bowtie_knot", [-0.75, 30.5, -4.75], [0.75, 31.75, -3.75], "red", painter=p_knot)
    for s in (1, -1):
        cube("torso", "bowtie_inner", [0.75, 30.25, -4.5], [1.75, 32, -3.75], "red", s, painter=p_bowtie)
        cube("torso", "bowtie_wing", [1.75, 29.75, -4.5], [3.25, 32.5, -3.75], "red", s, painter=p_bowtie)
    cube("torso", "button", [-0.625, 27.25, -4.375], [0.625, 28.5, -4], "black")
    cube("torso", "neck", [-1.75, 31.75, -1.75], [1.75, 33.75, 1.75], "endo")
    cube("torso", "neck_ring", [-2.25, 32.25, -2.25], [2.25, 32.75, 2.25], "endo_light")

    # ---- head ------------------------------------------------------------
    bone("head", "torso", [0, 33.25, 0])
    cube("head", "cranium_top", [-5, 41, -4.25], [5, 44.5, 4.5], "fur", painter=p_forehead)
    cube("head", "cranium_eyes", [-5, 38.75, -3.75], [5, 41, 4.5], "fur", painter=p_socket)
    cube("head", "nose_bridge", [-0.875, 38.75, -4.25], [0.875, 41, -3.75], "fur",
         faces={"east": "fur_dark", "west": "fur_dark"})
    for s in (1, -1):
        cube("head", "brow_side", [3.875, 38.75, -4.25], [5, 41, -3.75], "fur", s, faces={"west": "fur_dark"})
    cube("head", "cheeks", [-5.5, 35.75, -4.25], [5.5, 38.75, 4.25], "fur")
    for s in (1, -1):
        cube("head", "muzzle", [0.2, 35.75, -6.75], [4, 38.75, -4.25], "white", s, painter=p_muzzle)
    cube("head", "muzzle_groove", [-0.2, 35.75, -6.5], [0.2, 38.5, -4.25], "black")
    cube("head", "nose", [-1.25, 37.875, -7.125], [1.25, 39, -6.25], "black")
    for s in (1, -1):
        cube("head", "tooth", [0.125, 34.75, -6.25], [1.125, 35.875, -5.5], "cream", s)
    cube("head", "mouth_upper", [-4.25, 34.85, -5.5], [4.25, 35.75, 3.75], "endo")
    for s in (1, -1):
        for x0, x1 in ((1.6, 2.3), (2.6, 3.3), (3.6, 4.2)):
            cube("head", "endo_tooth_upper", [x0, 34.95, -5.75], [x1, 35.75, -5.25], "endo_light", s)

    bone("jaw", "head", [0, 34.85, 3.25])
    cube("jaw", "jaw", [-4.5, 33, -5.75], [4.5, 34.85, 3.75], "fur")
    cube("jaw", "mouth_floor", [-4, 34.85, -5.25], [4, 35.1, 3], "black")
    for s in (1, -1):
        for x0, x1 in ((0.5, 1.2), (1.6, 2.3), (2.7, 3.4)):
            cube("jaw", "endo_tooth_lower", [x0, 34.85, -5.6], [x1, 35.5, -5.15], "endo_light", s)

    bone("eyesNormal", "head", [0, PUPIL_Y, -3.8])
    bone("eyesPerformance", "head", [0, PUPIL_Y, -3.8])
    for s in (1, -1):
        cube("eyesNormal", "pupil", [PUPIL_X - 0.5, PUPIL_Y - 0.5, -3.875], [PUPIL_X + 0.5, PUPIL_Y + 0.5, -3.75],
             "pupil_red", s, painter=p_pupil)
        cube("eyesPerformance", "eye_glow", [PUPIL_X - 1, PUPIL_Y - 1, -3.6], [PUPIL_X + 1, PUPIL_Y + 1, -3.45],
             "white", s, painter=p_eye_glow)

    # ---- ears (asymmetric rest pose like the sheet) -------------------------
    ear_pose = {
        1: dict(base=[6, 0, -4], upper=[-8, 0, 0], tip=[-52, 0, 0]),
        -1: dict(base=[8, 0, 22], upper=[0, 0, 10], tip=[-18, 0, 48]),
    }
    for s, side in ((1, "right"), (-1, "left")):
        p = ear_pose[s]
        bone(f"{side}Ear", "head", [s * 3, 44.5, 0.5], p["base"])
        cube(f"{side}Ear", "ear_stalk", [2.25, 44.25, -0.25], [3.75, 46, 1.25], "endo", s)
        cube(f"{side}Ear", "ear_lower", [1.125, 45.75, -0.625], [4.875, 49.5, 1.625], "fur", s, painter=p_ear)
        bone(f"{side}EarUpper", f"{side}Ear", [s * 3, 49.5, 0.5], p["upper"])
        cube(f"{side}EarUpper", "ear_joint", [2.25, 49.25, 0], [3.75, 50.1, 1], "endo", s)
        cube(f"{side}EarUpper", "ear_upper", [1.125, 49.9, -0.625], [4.875, 53, 1.625], "fur", s, painter=p_ear)
        bone(f"{side}EarTip", f"{side}EarUpper", [s * 3, 53, 0.5], p["tip"])
        cube(f"{side}EarTip", "ear_tip", [1.0, 52.85, -0.75], [5.0, 55.1, 1.75], "fur", s, painter=p_ear)

    # ---- arms -------------------------------------------------------------
    for s, side in ((1, "right"), (-1, "left")):
        arm = f"{side}Arm"
        bone(arm, "torso", [s * 6.5, 31.25, 0], [0, 0, s * 8])
        cube(arm, "shoulder_joint", [5, 30.25, -1.25], [6.75, 32.25, 1.25], "endo", s)
        cube(arm, "shoulder_pad", [5.625, 29.75, -2.5], [10.125, 33.25, 2.5], "fur", s)
        cube(arm, "upper_arm", [5.875, 24.5, -2.125], [9.875, 30, 2.125], "fur", s)
        fa = f"{side}Forearm"
        bone(fa, arm, [s * 7.875, 24.25, 0])
        cube(fa, "elbow_joint", [6.875, 23.25, -1.25], [8.875, 24.75, 1.25], "endo", s)
        cube(fa, "elbow_hinge", [6.5, 23.5, -0.75], [9.25, 24.5, 0.75], "endo_light", s)
        cube(fa, "forearm", [5.875, 19.25, -2], [9.875, 23.5, 2], "fur", s)
        hand = f"{side}Hand"
        bone(hand, fa, [s * 7.875, 19, 0])
        cube(hand, "wrist_joint", [7.125, 18.25, -1], [8.625, 19.5, 1], "endo", s)
        cube(hand, "palm", [6.75, 15.5, -2], [9, 18.5, 2], "fur", s)
        fing = f"{side}Fingers"
        bone(fing, hand, [s * 7.875, 15.75, 0])
        for i, (z0, z1) in enumerate(((-2, -1.1), (-0.95, -0.05), (0.05, 0.95), (1.1, 2))):
            cube(fing, f"finger{i + 1}_base", [7.0, 13.75, z0], [8.75, 15.75, z1], "fur", s)
            cube(fing, f"finger{i + 1}_tip", [6.375, 12.75, z0], [7.875, 14.25, z1], "fur", s)
        th = f"{side}Thumb"
        bone(th, hand, [s * 7.25, 17.5, -2])
        cube(th, "thumb_base", [6.375, 15.75, -2.875], [7.625, 17.75, -1.75], "fur", s)
        cube(th, "thumb_tip", [6.125, 14.75, -2.75], [7.375, 16.25, -1.875], "fur", s)

    # ---- legs -------------------------------------------------------------
    LC = 3.4
    for s, side in ((1, "right"), (-1, "left")):
        leg = f"{side}Leg"
        bone(leg, "root", [s * LC, 19, 0])
        cube(leg, "hip_joint", [LC - 1.5, 18.25, -1.5], [LC + 1.5, 19.75, 1.5], "endo", s)
        cube(leg, "thigh", [LC - 2.75, 12.25, -2.75], [LC + 2.75, 18.75, 2.75], "fur", s)
        shin = f"{side}Shin"
        bone(shin, leg, [s * LC, 12, 0])
        cube(shin, "knee_joint", [LC - 1.75, 11, -1.75], [LC + 1.75, 12.75, 1.75], "endo", s)
        cube(shin, "knee_hinge", [LC - 2.5, 11.25, -1], [LC + 2.5, 12.5, 1], "endo_light", s)
        cube(shin, "shin", [LC - 2.5, 5, -2.5], [LC + 2.5, 11.25, 2.5], "fur", s)
        foot = f"{side}Foot"
        bone(foot, shin, [s * LC, 4.75, 0])
        cube(foot, "ankle_joint", [LC - 1.5, 4, -1.5], [LC + 1.5, 5.25, 1.5], "endo", s)
        cube(foot, "foot_top", [0.9, 3, -4], [7.1, 4.5, 3.25], "fur", s)
        cube(foot, "foot_base", [0.6, 0, -3.5], [7.4, 3, 3.5], "fur", s)
        for i, (x0, x1) in enumerate(((0.7, 2.85), (2.95, 5.05), (5.15, 7.3))):
            cube(foot, f"toe{i + 1}", [x0, 0, -6.25], [x1, 2.75, -3.5], "fur", s)

    # ---- banjo (rests across the belly; animations hide it when not performing)
    P = BANJO_PIVOT
    bone("banjo", "torso", P, [4, -15, -36])

    def bc(name, frm, to, mat, **kw):
        return cube("banjo", name, [frm[0] + P[0], frm[1] + P[1], frm[2] + P[2]],
                    [to[0] + P[0], to[1] + P[1], to[2] + P[2]], mat, **kw)

    rows = int(round(2 * DRUM_R))
    for j in range(rows):
        y0 = -DRUM_R + j
        yc = y0 + 0.5
        hw = round(math.sqrt(DRUM_R ** 2 - yc ** 2) * 4) / 4
        bc(f"drum_row{j + 1}", [-hw, y0, -0.75], [hw, y0 + 1, 1.25], "banjo_purple", painter=p_drum)
    for k in range(12):
        a = math.radians(k * 30 + 15)
        cx, cy = (DRUM_R - 0.4) * math.cos(a), (DRUM_R - 0.4) * math.sin(a)
        bc(f"stud{k + 1}", [cx - 0.25, cy - 0.25, -1.0], [cx + 0.25, cy + 0.25, -0.75], "brass")
    bc("bridge", [1.75, -1.0, -1.05], [2.25, 1.0, -0.75], "cream")
    bc("tailpiece", [4.25, -0.75, -1.0], [5.25, 0.75, -0.75], "brass")
    bc("neck", [-16.5, -0.75, -0.9], [-4.75, 0.75, 0.5], "wood", painter=p_fingerboard)
    bc("neck_heel", [-5.75, -1.0, -0.5], [-4.5, 1.0, 1.0], "wood")
    bc("headstock", [-20, -1.25, -0.9], [-16.5, 1.25, 0.5], "banjo_purple", painter=p_headstock)
    for k, x in enumerate((-19.25, -17.75)):
        bc(f"peg{k * 2 + 1}", [x, 1.25, -0.5], [x + 0.75, 1.9, 0.2], "cream")
        bc(f"peg{k * 2 + 2}", [x, -1.9, -0.5], [x + 0.75, -1.25, 0.2], "cream")
    for k, y in enumerate((-0.45, -0.15, 0.15, 0.45)):
        bc(f"string{k + 1}", [-16.5, y - 0.05, -1.1], [4.75, y + 0.05, -1.0], "metal")


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
