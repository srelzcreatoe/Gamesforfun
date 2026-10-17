"""Three animatronics from front-view reference pictures, measured part by part:

  golden_freddy   Golden Freddy: golden fur, black top hat, round ears with a dark ring,
                  hollow black eye sockets with tiny dull irises, black wires running down
                  from the eyes, bare endoskeleton fingers on both hands
  crimson_freddy  dark-red Freddy: maroon fur, pink face plate around the eyes, red eyes,
                  big pink-lined ears on chrome pins, square black buttons, mitten hands
  violet_bunny    purple bunny: one ear upright, the other folded down at its joint, lilac
                  face plate, red eyes, red bow tie with dark-red stripes down the chest

All three pictures are measured at the same scale (26 picture pixels = 1 model pixel), so
every part, and every character, keeps exactly the size it has in its picture.  Each part is
written below in picture pixels and converted by Pic; the character's right is the left half
of a picture.  Depths (front to back), which a front view can't show, follow the widths.

Animations are in fred3_anims.py.
"""
import math
import os

import numpy as np

from characters.body import COMMON, ENDO, p_chrome, vox
from fnafkit import export
from fnafkit.rig import bone, cube

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE = 26.0          # picture pixels per model pixel (shared by all three pictures)


class Pic:
    """Picture pixels -> model pixels for one reference (cx: body centre line, gy: floor)."""

    def __init__(self, cx, gy):
        self.cx, self.gy = cx, gy

    def x(self, ix):
        return (self.cx - ix) / SCALE

    def y(self, iy):
        return (self.gy - iy) / SCALE

    @staticmethod
    def d(px):
        return px / SCALE


# --------------------------------------------------------------------------
# Colours (sampled from each picture's lit side, brought up to albedo)
# --------------------------------------------------------------------------

def _fur(tones, w, dark, cover=0.66):
    return vox(*tones, w=w, patches=[(2.4, cover, dark)], cell=0.77, bevel=0.2)


MATERIALS = {
    "golden_freddy": {
        **COMMON,
        "fur": _fur([(150, 88, 20), (170, 104, 26), (132, 74, 16), (188, 120, 34), (112, 62, 14), (94, 50, 10)],
                    [3, 3, 3, 2, 2, 1], [(72, 38, 8), (58, 30, 6), (86, 48, 12)], cover=0.6),
        "fur_dark": vox((86, 46, 10), (72, 38, 8), (100, 56, 12), cell=0.77),
        "brow": vox((196, 132, 42), (182, 120, 36), (208, 144, 50), cell=0.77),
        "belly": vox((196, 140, 58), (180, 124, 46), (212, 158, 72), (164, 110, 40), w=[3, 3, 2, 1], cell=0.77),
        "muzzle": vox((188, 128, 48), (202, 142, 58), (172, 114, 40), (150, 98, 32), w=[3, 3, 2, 1], cell=0.77),
        "ear_ring": vox((70, 38, 8), (58, 31, 6), (82, 45, 10), cell=0.77),
        "hat": vox((30, 26, 22), (38, 34, 30), (24, 21, 18), (46, 42, 38), cell=0.77),
        "sole": vox((80, 60, 46), (66, 50, 38), (92, 70, 54), cell=0.77),
        "teeth": vox((206, 205, 198), (188, 187, 180), (220, 219, 214), cell=0.5, bevel=0.2),
        "endo": ENDO,
    },
    "crimson_freddy": {
        **COMMON,
        "fur": _fur([(98, 34, 42), (84, 30, 38), (112, 42, 50), (72, 26, 34), (124, 50, 58), (62, 22, 30)],
                    [3, 3, 3, 2, 1, 1], [(54, 22, 34), (46, 18, 28)]),
        "fur_dark": vox((66, 26, 34), (56, 22, 30), (76, 30, 38), cell=0.77),
        "mask": vox((168, 122, 114), (152, 108, 102), (180, 134, 124), (140, 98, 92), w=[3, 3, 2, 1], cell=0.77),
        "belly": vox((178, 134, 126), (162, 120, 114), (192, 148, 140), (148, 108, 102), w=[3, 3, 2, 1], cell=0.77),
        "muzzle": vox((160, 114, 106), (174, 128, 118), (146, 102, 96), w=[3, 2, 2], cell=0.77),
        "ear_inner": vox((164, 116, 106), (150, 104, 96), (176, 128, 118), cell=0.77),
        "hat": vox((40, 22, 30), (52, 30, 40), (30, 16, 22), (60, 34, 44), cell=0.77),
        "sole": vox((152, 122, 124), (134, 106, 108), (166, 136, 138), cell=0.77),
        "teeth": vox((208, 198, 184), (190, 180, 166), (220, 212, 200), cell=0.5, bevel=0.2),
        "endo": ENDO,
    },
    "violet_bunny": {
        **COMMON,
        "fur": _fur([(92, 46, 68), (80, 40, 60), (104, 56, 80), (70, 34, 52), (116, 64, 92), (62, 30, 48)],
                    [3, 3, 3, 2, 1, 1], [(58, 26, 42), (50, 22, 36)]),
        "fur_dark": vox((64, 30, 46), (56, 26, 40), (72, 34, 52), cell=0.77),
        "mask": vox((152, 114, 140), (140, 102, 128), (164, 126, 150), cell=0.77),
        "belly": vox((204, 170, 180), (188, 154, 166), (214, 184, 192), (176, 142, 154), w=[3, 3, 2, 1], cell=0.77),
        "muzzle": vox((188, 142, 152), (202, 158, 166), (172, 128, 140), w=[3, 2, 2], cell=0.77),
        "ear_inner": vox((166, 136, 156), (152, 122, 144), (178, 148, 166), cell=0.77),
        "red": vox((112, 20, 24), (98, 16, 20), (126, 26, 30), cell=0.6),
        "strap": vox((100, 30, 34), (88, 26, 30), (110, 36, 40), cell=0.6),
        "band": vox((76, 30, 42), (66, 26, 36), (86, 36, 48), cell=0.77),
        "sole": vox((162, 130, 146), (148, 118, 134), (176, 144, 158), cell=0.77),
        "teeth": vox((212, 202, 198), (194, 184, 180), (224, 216, 212), cell=0.5, bevel=0.2),
        "endo": ENDO,
    },
}


# Colour correction measured against the pictures: the studio render of each material, sampled at the
# same picture points as the reference, scaled per channel to match (see the README).
CALIBRATION = {
    "golden_freddy": {"fur": (1.08, 1.07, 0.64), "fur_dark": (1.08, 1.07, 0.64), "ear_ring": (1.08, 1.07, 0.64), "belly": (0.95, 0.93, 0.89), "muzzle": (1.12, 1.20, 1.50), "brow": (0.98, 0.95, 0.75), "hat": (0.88, 0.89, 1.02), "sole": (1.19, 1.19, 1.20)},
    "crimson_freddy": {"fur": (1.02, 1.14, 1.18), "fur_dark": (1.02, 1.14, 1.18), "belly": (0.92, 0.92, 0.92), "muzzle": (1.36, 1.37, 1.38), "mask": (1.05, 1.00, 0.97), "ear_inner": (0.92, 0.88, 0.87), "hat": (0.85, 1.05, 1.06), "sole": (0.89, 0.83, 0.83)},
    "violet_bunny": {"fur": (1.12, 1.22, 1.40), "fur_dark": (1.12, 1.22, 1.40), "belly": (0.87, 0.87, 0.86), "muzzle": (1.08, 1.02, 1.02), "mask": (1.17, 1.18, 1.16), "band": (0.74, 0.68, 0.76), "strap": (0.74, 0.68, 0.76), "sole": (1.30, 1.28, 1.32), "red": (1.37, 1.61, 1.79)},
}

for _n, _cal in CALIBRATION.items():
    for _mat, _k in _cal.items():
        _m = MATERIALS[_n][_mat]
        _m["tones"] = [tuple(int(round(min(255, c * k))) for c, k in zip(t, _k)) for t in _m["tones"]]
        if _m.get("patches"):
            _m["patches"] = [(a, b, [tuple(int(round(c * k)) for c, k in zip(t, _k)) for t in ts]) for a, b, ts in _m["patches"]]

# Half-pixel cells with fine grain, small clusters and scattered dark specks, like the pictures (no
# bevelled tile edges).  Light and shadow are baked in afterwards (SHADING).  Each material is copied
# first: the COMMON ones are shared with the other characters.
for _n, _mats in MATERIALS.items():
    for _k, _m in list(_mats.items()):
        if "cell" in _m:
            _mats[_k] = dict(_m, cell=0.5, bevel=0.0, grain=0.04)
        elif _k in ("black", "socket"):
            _mats[_k] = dict(_m, bevel=0.0, grain=0.03)
    _fur_dark = _mats["fur"]["patches"][0][2]
    _mats["fur"]["patches"] = [(0.9, 0.86, _fur_dark)]
    _mats["fur"]["spots"] = [(tuple(int(c * 0.8) for c in _fur_dark[0]), 0.03),
                             (tuple(int(c * 0.55) for c in _fur_dark[0]), 0.012)]

# rig.bake_shading: parts darken towards their edges and where they meet other parts; the pale face
# plates, belly and teeth stay brighter, as they do in the pictures
SHADING = dict(ao=0.6, rim=0.55, reach=2.5)
for _mats in MATERIALS.values():
    for _k, _v in (("muzzle", 0.6), ("mask", 0.6), ("teeth", 0.5), ("belly", 0.85), ("ear_inner", 0.7)):
        if _k in _mats:
            _mats[_k]["shade"] = _v
    _mats["eyeball"] = dict(_mats["socket"], shade=0.0)       # the painted eye keeps its own light

# Eyes, read off the pictures (radii in model px): a glossy black eyeball filling the socket, an iris
# with a darker ring and a pupil, a white glint up and to the picture's right, a soft halo round the
# iris and white reflections curving along the outer bottom of the socket.  Crimson Freddy's iris is
# drawn in square pixels (pixel = their size), the other two are smooth.
EYES = {
    "golden_freddy": dict(iris=(138, 52, 30), ring=(58, 22, 12), pupil=(26, 10, 8), r_iris=0.3, r_ring=0.05, r_pupil=0.12,
                          halo=(226, 214, 208), r_halo=0.63, halo_a=0.75, glint=(246, 242, 236), glow=None,
                          reflect=(-78, -14, 0.9), reflect_w=(0.08, 0.3), pixel=None),
    "crimson_freddy": dict(iris=(236, 44, 46), ring=(118, 14, 20), pupil=(18, 4, 6), r_iris=0.33, r_ring=0.09, r_pupil=0.17,
                           halo=(150, 40, 46), r_halo=0.66, halo_a=0.6, glint=(252, 240, 240), glow=(210, 24, 30),
                           reflect=(-102, 4, 1.0), reflect_w=(0.06, 0.45), pixel=0.15),
    "violet_bunny": dict(iris=(232, 36, 42), ring=(100, 10, 16), pupil=(18, 4, 8), r_iris=0.33, r_ring=0.06, r_pupil=0.11,
                         halo=(240, 226, 232), r_halo=0.74, halo_a=0.8, glint=(252, 240, 244), glow=(200, 20, 24),
                         reflect=(-98, -24, 0.9), reflect_w=(0.08, 0.3), pixel=None),
}

# --------------------------------------------------------------------------
# Painters
# --------------------------------------------------------------------------


def p_endo(ctx):
    """Dark glossy endoskeleton metal (finger joints, neck, wrist rods)."""
    p_chrome(ctx)
    ctx.rgb[...] = ctx.rgb * 0.3 + np.array([4, 4, 6], np.float32)


def eyeball_painter(name, s):
    """The eyeball's front, at a fine resolution: everything is worked out in right-side coordinates
    (x grows outward), so both eyes mirror except the glint, which keeps to the picture's right."""
    e, pic, H = EYES[name], P[name], HEADS[name]
    px, py = half_pair(pic, *H["pupils"]["x"]), pic.y(H["pupils"]["row"])
    S_ = H["sockets"]
    x0, x1 = half_pair(pic, *S_["inner"]), half_pair(pic, *S_["outer"])
    y0, y1 = pic.y(S_["rows"][0]), pic.y(S_["rows"][1])
    xc, yc, hw, hh = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2

    def painter(ctx):
        ctx.paint("eyeball")
        if ctx.face != "north":
            return
        X, Y = ctx.X * s, ctx.Y
        q = e["pixel"]
        if q:
            X = (np.floor((X - px) / q) + 0.5) * q + px
            Y = (np.floor((Y - py) / q) + 0.5) * q + py
        dx, dy = X - px, Y - py
        r = np.maximum(np.abs(dx), np.abs(dy)) if q else np.hypot(dx, dy)
        rgb, emi = ctx.rgb, ctx.emi
        # glossy black, a touch lighter toward the top
        rgb[...] = (np.array([7, 6, 7], np.float32) + np.clip(Y - yc, 0, None)[..., None] * np.array([5, 4, 5], np.float32))
        # halo fading out from the iris
        a = np.clip(1 - (r - e["r_iris"]) / (e["r_halo"] - e["r_iris"]), 0, 1) ** 1.2 * e["halo_a"]
        a = np.where(r < e["r_iris"], 0, a)[..., None]
        rgb[...] = rgb * (1 - a) + np.array(e["halo"], np.float32) * a
        # iris: darker ring outside, a little lighter toward the middle, then the pupil
        iris = r < e["r_iris"]
        t = np.clip(r / e["r_iris"], 0, 1)[..., None]
        ring_w = e["r_ring"] / e["r_iris"]
        col = np.array(e["iris"], np.float32) * (1.12 - 0.24 * t)
        col = np.where(t > 1 - ring_w, np.array(e["ring"], np.float32), col)
        rgb[iris] = col[iris]
        pupil = r < e["r_pupil"]
        rgb[pupil] = np.array(e["pupil"], np.float32)
        # glint: up and to the picture's right (the model's -x: inward on the right eye, outward on the left)
        gx, gy = px - s * e["r_iris"] * 0.42, py + e["r_iris"] * 0.42
        gd = (np.maximum(np.abs(X - gx), np.abs(Y - gy)) if q else np.hypot(X - gx, Y - gy))
        glint = gd < (q * 0.55 if q else e["r_iris"] * 0.24)
        rgb[glint] = np.array(e["glint"], np.float32)
        # reflections curving along the outer bottom of the socket (a band just inside its rounded edge)
        rc = 0.75
        qx, qy = np.abs(X - xc) - (hw - rc), np.abs(Y - yc) - (hh - rc)
        d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - rc
        ang = np.degrees(np.arctan2(Y - yc, X - xc))
        a0, a1, k = e["reflect"]
        mid = (a0 + a1) / 2
        along = np.clip(1 - np.abs(ang - mid) / ((a1 - a0) / 2), 0, 1)
        w0, w1 = e["reflect_w"]
        band = (d > -w1) & (d < -w0) & (along > 0)
        shine = np.clip(along * 1.8, 0, 1)[..., None] * k
        rgb[band] = (rgb * (1 - shine) + 250 * shine)[band]
        if e["glow"]:
            g = np.array(e["glow"], np.float32)
            emi[iris & ~pupil] = g * 0.45
            ha = np.where(r < e["r_iris"], 0, a[..., 0])[..., None]
            emi[...] = np.maximum(emi, g * ha * 0.35)
            emi[glint] = np.array(e["glint"], np.float32) * 0.6

    return painter


def socket_wall(name, pupils):
    """Back wall of the eye band: black, faintly lit around the irises (its other faces keep their
    own material: the fur on the sides and back of the head)."""
    e = EYES[name]

    def painter(ctx):
        ctx.paint(ctx.cube.faces.get(ctx.face, "socket"))
        if ctx.face != "north" or not e["glow"]:
            return
        for px, py in pupils:
            for sx in (px, -px):
                d = np.sqrt((ctx.X - sx) ** 2 + (ctx.Y - py) ** 2)
                ring = (d < 1.2) & (d >= 0.5)
                k = np.clip(1.0 - (d - 0.5) / 0.7, 0, 1)[..., None] ** 2
                g = np.array(e["glow"], np.float32)
                ctx.rgb[ring] = (ctx.rgb * (1 - k * 0.35) + g * k * 0.35)[ring]
                ctx.emi[ring] = (g * k * 0.3)[ring]

    return painter


def ring_painter(outer, ring, inner, ring_w, inner_r):
    """Round ear: outer fur, a darker ring band, a lighter disc in the middle (front and back)."""

    def painter(ctx):
        ctx.paint(outer)
        if ctx.face not in ("north", "south"):
            return
        c = ctx.cube
        cx, cy = (c.frm[0] + c.to[0]) / 2, (c.frm[1] + c.to[1]) / 2
        # the ear is several stacked cubes: measure from the ear's centre, stored on the cube
        cx, cy = getattr(c, "ear_c", (cx, cy))
        d = np.maximum(np.abs(ctx.X - cx), np.abs(ctx.Y - cy)) * 0.6 + np.sqrt((ctx.X - cx) ** 2 + (ctx.Y - cy) ** 2) * 0.4
        ctx.paint(ring, d < inner_r + ring_w)
        ctx.paint(inner, d < inner_r)

    return painter


def panel_painter(inner, outer, rim, faces=("north",)):
    def painter(ctx):
        ctx.paint(outer)
        if ctx.face in faces:
            c = ctx.cube
            m = ((ctx.X > c.frm[0] + rim) & (ctx.X < c.to[0] - rim) & (ctx.Y > c.frm[1] + rim) & (ctx.Y < c.to[1] - rim))
            ctx.paint(inner, m)

    return painter


def freckle_painter(mat, dots):
    def painter(ctx):
        ctx.paint(mat)
        if ctx.face == "north":
            for fx, fy in dots:
                for s in (1, -1):
                    m = (np.abs(ctx.X - s * fx) < 0.22) & (np.abs(ctx.Y - fy) < 0.22)
                    ctx.rgb[m] = np.array([22, 16, 16], np.float32)

    return painter


# --------------------------------------------------------------------------
# Shapes
# --------------------------------------------------------------------------


def rbox(b, name, x0, x1, y0, y1, z0, z1, mat, s=1, r=0.5, painter=None, faces=None, axes="xyz", steps=2):
    """Box with its edges rounded off in two voxel steps (four overlapping cubes): the chunky,
    pillowy look of the pictures.  axes="xz" rounds only the vertical edges (for stacked slabs).
    steps=3 cuts every edge and corner back in three even steps instead (ten cubes, or four for
    "xz"): the octagonal barrels of the pictures' limbs."""
    lim = [(x1 - x0) / 2.2, (z1 - z0) / 2.2] + ([(y1 - y0) / 2.2] if "y" in axes else [])
    r = min([r] + lim)
    if r <= 0.05:
        return [cube(b, name, [x0, y0, z0], [x1, y1, z1], mat, s, painter=painter, faces=faces)]
    if steps == 3:
        t = r / 3
        if "y" in axes:
            # every cube is cut back six steps in all (three on two axes, or two on each ...), so
            # each corner and edge steps in evenly from every side
            insets = [(i * t, j * t, (6 - i - j) * t) for i in range(4) for j in range(4) if 0 <= 6 - i - j <= 3]
        else:
            insets = [(i * t, 0.0, (3 - i) * t) for i in range(4)]
    else:
        h = r / 2
        ry = r if "y" in axes else 0.0
        hy = h if "y" in axes else 0.0
        insets = [(0, ry, r), (r, 0, r), (r, ry, 0), (h, hy, h)] if "y" in axes else [(0, 0, r), (r, 0, 0), (h, 0, h)]
    return [cube(b, name + ("" if k == 0 else f"_{k}"), [x0 + ix, y0 + iy, z0 + iz], [x1 - ix, y1 - iy, z1 - iz], mat, s,
                 painter=painter, faces=faces) for k, (ix, iy, iz) in enumerate(insets)]


def disc(b, name, cx, cy, w, h, z0, z1, mat, s=1, painter=None):
    """Stepped round plate in the x-y plane (two corner steps)."""
    r = min(w, h) * 0.17
    out = []
    for k, (dx, dy) in enumerate(((0, 2 * r), (r, r), (2 * r, 0))):
        c = cube(b, f"{name}{k + 1}", [cx - w / 2 + dx, cy - h / 2 + dy, z0], [cx + w / 2 - dx, cy + h / 2 - dy, z1], mat, s,
                 painter=painter)
        c.ear_c = (cx * s, cy)
        out.append(c)
    return out


# --------------------------------------------------------------------------
# Measurements (picture pixels; character's right = left half of the picture)
# --------------------------------------------------------------------------

P = {"golden_freddy": Pic(548, 1425), "crimson_freddy": Pic(548, 1421), "violet_bunny": Pic(521, 1425)}

# body: chest / belly / pelvis spans, half widths in picture px measured symmetrically
BODY = {
    "golden_freddy": dict(chest=(800, 445), chest_half=174.9, depth=4.4, belly=(761, 516), belly_half=120, pelvis=(866, 796),
            pelvis_half=172, bow=(561, 496), bow_half=105, bow_mat="black", buttons=((568, 22), (623, 22)),
            button_round=True),
    "crimson_freddy": dict(chest=(845, 490), chest_half=189.9, depth=4.5, belly=(836, 571), belly_half=112, pelvis=(936, 841),
            pelvis_half=190, bow=(590, 530), bow_half=85, bow_mat="black", buttons=((597, 20), (661, 20)),
            button_round=False),
    "violet_bunny": dict(chest=(850, 545), chest_half=155.9, depth=3.9, belly=(841, 596), belly_half=97, pelvis=(916, 846),
            pelvis_half=177, pelvis_mat="band", bow=(616, 571), bow_half=75, bow_mat="red", buttons=(), straps=(404,
            596, 841)),
}

# legs: thigh and shin centres (pairs), thigh/knee/shin/heel/toes/sole picture rows, widths, foot span; the
# toe top is the top of the toes' front faces (the picture also shows their tops, from above)
LEGS = {
    "golden_freddy": dict(leg_x=(444.3, 651.7), shin_x=(429, 667), thigh=(1037, 862), thigh_half=85, knee=(1075, 1037),
            knee_half=28, shin=(1241, 1049), shin_half=85.5, shin_cap=(1105, 70), heel_top=1265, toe_top=1305,
            sole_top=1381, foot=(229.9, 509.8)),
    "crimson_freddy": dict(leg_x=(431, 665), shin_x=(412.5, 683.5), thigh=(1057, 880), thigh_half=87, knee=(1092, 1057),
            knee_half=36, shin=(1241, 1085), shin_half=88.5, heel_top=1265, toe_top=1305, sole_top=1377,
            foot=(193.7, 497.9)),
    "violet_bunny": dict(leg_x=(419, 623), shin_x=(405, 637), thigh=(1067, 886), thigh_half=82.5, knee=(1097, 1067), knee_half=27,
            shin=(1255, 1086), shin_half=82, heel_top=1272, toe_top=1302, sole_top=1378, foot=(211.6, 491.4)),
}

# arms: shoulder pivot (picture point), then each segment along its own axis in model px:
#   angle  absolute outward tilt of the segment in the picture (degrees)
#   span   (top, bottom) of the block measured down the axis from the segment's pivot
#   ox     sideways offset of the block centre from the axis (+ = outward)
#   half   half width / half depth of the block
#   next   (sideways offset, distance) of the elbow pivot (the wrist comes from HANDS)
#   cap    the shoulder cap: centre offset, top, half width, height
ARMS = {
    "golden_freddy": dict(shoulder=(365.89, 460.2), upper=dict(angle=18.2, span=(-0.71, 7.56), ox=0.56, half=(2.95, 2.7),
            next=(0.66, 8.4)), fore=dict(angle=13.17, span=(0.12, 6.12), ox=-0.13, half=(2.98, 2.7)),
            cap=(-1.05, 3.16, 1.2, 2.2)),
    "crimson_freddy": dict(shoulder=(360.86, 483.52), upper=dict(angle=1.73, span=(-0.33, 7.53), ox=2.06, half=(2.56, 2.7),
            next=(3.19, 7.45)), fore=dict(angle=3.54, span=(0.31, 6.78), ox=0.37, half=(2.95, 2.6)),
            cap=(-1.71, 2.89, 2.49, 3.9)),
    "violet_bunny": dict(shoulder=(374.34, 528.98), upper=dict(angle=0.84, span=(-0.38, 6.63), ox=2.44, half=(2.46, 2.5),
            next=(3.22, 7.33)), fore=dict(angle=3.82, span=(-0.22, 6.14), ox=0.38, half=(2.73, 2.5)),
            cap=(-0.55, 3.29, 2.2, 5.79)),
}

# heads: slabs (bottom row, top row, half width) top-down silhouette; sockets, mask, muzzle, nose,
# jaw and teeth rows; ears; hat.  Everything in picture px except depths.
HEADS = {
    "golden_freddy": dict(pivot=460, front=-5.2, back=5, slabs=((160, 135, 127.5), (200, 160, 138.3), (275, 200, 142.5), (365, 275,
            134.7), (405, 365, 151.5)), sockets=dict(rows=(312, 220), inner=(533, 563), outer=(445.5, 650.5)),
            pupils=dict(x=(510, 606), row=265), deep=0.8, mask=None, brow=dict(rows=(216, 198), inner=(532, 568),
            outer=(462, 640), mat="brow"), cheeks=dict(rows=(360, 249.1), out=(391.8, 718.4)), muzzle=dict(rows=(405,
            315), half=(445, 650), depth=2.8, freckles=()), nose=dict(rows=(355, 315), half=(518, 585)),
            jaw=dict(rows=(460, 425), half=(440, 650), mat="fur"), teeth=dict(rows=(425, 406), span=(488, 622), n=4,
            w=25), tears=dict(x=((466, 648), (480, 632)), rows=(385, 305)), ears=dict(kind="round", centre=((346.4,
            700.2), 152.9), size=(116.6, 151.7), inner=0.8, ring=0.6, colours=("fur", "ear_ring", "brow")),
            hat=dict(brim=(135, 100, 443.5, 642.6), crown=(100, 6.3, 478.1, 607.5))),
    "crimson_freddy": dict(pivot=490, front=-5.3, back=5.1, slabs=((160, 145, 107.7), (230, 160, 152.7), (350, 230, 157.3), (445,
            350, 155.9)), sockets=dict(rows=(334, 249), inner=(530, 566), outer=(448, 648)), pupils=dict(x=(489, 593),
            row=287), deep=0.8, mask=dict(rows=(335, 220), half=(445, 650)), brow=None, cheeks=dict(rows=(355, 267),
            out=(357.6, 712.6)), muzzle=dict(rows=(445, 345), half=(448, 655), depth=2.9, freckles=((468, 405), (482,
            395), (474, 420))), nose=dict(rows=(380, 335), half=(520, 600)), jaw=dict(rows=(500, 475), half=(450, 650),
            mat="fur"), teeth=dict(rows=(475, 455), span=(485, 630), n=4, w=28), tears=None, ears=dict(kind="round",
            centre=((357.2, 753.6), 161.9), size=(139.4, 175.6), inner=1.4, ring=0, colours=("fur", "ear_inner",
            "ear_inner"), pin=True), hat=dict(brim=(145, 112, 456, 651.5), crown=(112, 18.2, 469.9, 616.3))),
    "violet_bunny": dict(pivot=545, front=-5, back=4.8, slabs=((206, 192, 45), (216, 206, 82), (240, 216, 120), (262, 240, 135),
            (300, 262, 147), (328, 300, 155), (420, 328, 163), (500, 420, 87.8)), sockets=dict(rows=(402, 306),
            inner=(501.5, 540.5), outer=(424.5, 617.5)), pupils=dict(x=(465, 570), row=352), deep=0.8,
            mask=dict(rows=(420, 300), half=(425, 620)), brow=None, cheeks=dict(rows=(480, 403.5), out=(360.7, 656.5)),
            muzzle=dict(rows=(500, 430), half=(420, 630), depth=2.6, freckles=((438, 445), (452, 452), (444, 470))),
            nose=dict(rows=(445, 420), half=(495, 545)), jaw=dict(rows=(555, 540), half=(430, 630), mat="fur"),
            teeth=dict(rows=(540, 510), span=(465, 595), n=5, w=25), tears=None, ears=dict(kind="bunny"), hat=None),
}

TITLES = {"golden_freddy": "GOLDEN FREDDY", "crimson_freddy": "CRIMSON FREDDY", "violet_bunny": "VIOLET BUNNY"}
EGGS = {"golden_freddy": ("#9a6214", "#1e1a16"), "crimson_freddy": ("#5e1e28", "#b0827a"),
        "violet_bunny": ("#5c2e46", "#7a1418")}

# --------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------


def half_pair(pic, a, b):
    """Half the distance between a symmetric pair of picture x positions, in model px."""
    return abs(b - a) / 2 / SCALE


def build_legs(name):
    pic, L = P[name], LEGS[name]
    lx = half_pair(pic, *L["leg_x"])
    sx = half_pair(pic, *L.get("shin_x", L["leg_x"]))       # the shins stand a little wider than the thighs
    for s, side in ((1, "right"), (-1, "left")):
        leg, shin, foot = f"{side}Leg", f"{side}Shin", f"{side}Foot"
        t0, t1 = pic.y(L["thigh"][0]), pic.y(L["thigh"][1])
        tw = pic.d(L["thigh_half"])
        bone(leg, "root", [s * lx, t1 - 0.6, 0])
        cube(leg, "hip_joint", [lx - 1.3, t1 - 1.2, -1.3], [lx + 1.3, t1 + 0.8, 1.3], "endo", s, painter=p_endo)
        rbox(leg, "thigh", lx - tw, lx + tw, t0, t1, -tw, tw, "fur", s, r=0.9, steps=3)
        k0, k1 = pic.y(L["knee"][0]), pic.y(L["knee"][1])
        kw = pic.d(L["knee_half"])
        kx = (lx + sx) / 2
        bone(shin, leg, [s * kx, (k0 + k1) / 2, 0])
        cube(shin, "knee_joint", [kx - kw, k0 - 0.2, -kw], [kx + kw, k1 + 0.2, kw], "endo", s, painter=p_endo)
        s0, s1 = pic.y(L["shin"][0]), pic.y(L["shin"][1])
        sw = pic.d(L["shin_half"])
        cap = L.get("shin_cap")
        if cap:
            # a narrower knee cap ring on top of the shin
            c0, cw = pic.y(cap[0]), pic.d(cap[1])
            rbox(shin, "shin_cap", sx - cw, sx + cw, c0 - 0.2, s1, -cw, cw, "fur", s, r=0.7, steps=3)
            s1 = c0
        rbox(shin, "shin", sx - sw, sx + sw, s0, s1, -sw, sw, "fur", s, r=0.95, steps=3)
        heel = pic.y(L["heel_top"])
        bone(foot, shin, [s * sx, heel + 0.4, 0])
        cube(foot, "ankle_joint", [sx - 1.1, heel - 0.4, -1.1], [sx + 1.1, heel + 0.9, 1.1], "endo", s, painter=p_endo)
        # the foot is centred under its shin (as wide as in the picture, but never past the middle line)
        fhw = min(abs(pic.x(L["foot"][0]) - pic.x(L["foot"][1])) / 2, sx - 0.3)
        fi, fo = sx - fhw, sx + fhw
        sole, toe = pic.y(L["sole_top"]), pic.y(L["toe_top"])
        td = L.get("toe_depth", 3.3)
        fz0 = -sw - td + 0.3                     # the toes reach forward from the front of the shin
        fz1 = sw + 0.4
        cube(foot, "sole", [fi, 0.0, fz0], [fo, sole, fz1 + 0.2], "sole", s)
        rbox(foot, "heel", fi + 0.5, fo - 0.5, sole, heel, fz0 + td - 0.6, fz1, "fur", s, r=0.8)
        gap = 0.18
        tw_ = (fo - fi - 2 * gap) / 3
        x = fi
        for i in range(3):
            rbox(foot, f"toe{i + 1}", x, x + tw_, sole, toe, fz0 + 0.1, fz0 + td + 0.2, "fur", s, r=0.75)
            rbox(foot, f"toe{i + 1}_top", x + 0.25, x + tw_ - 0.25, toe - 0.3, toe + 0.8, fz0 + td * 0.55, fz0 + td + 0.4,
                 "fur", s, r=0.45)
            x += tw_ + gap


def build_body(name):
    pic, B = P[name], BODY[name]
    hd = B["depth"]
    p0, p1 = pic.y(B["pelvis"][0]), pic.y(B["pelvis"][1])
    ph = pic.d(B["pelvis_half"])
    bone("body", "root", [0, p0 + 0.8, 0])
    rbox("body", "pelvis", -ph, ph, p0, p1, -hd + 0.15, hd - 0.15, B.get("pelvis_mat", "fur"), r=0.9, steps=3)
    c0, c1 = pic.y(B["chest"][0]), pic.y(B["chest"][1])
    hw = pic.d(B["chest_half"])
    bone("torso", "body", [0, p1, 0])
    cube("torso", "waist", [-hw + 1.0, p1 - 0.6, -hd + 1.0], [hw - 1.0, c0 + 0.4, hd - 1.0], "socket")
    rbox("torso", "chest", -hw, hw, c0, c1, -hd, hd, "fur", r=1.2, steps=3)
    # belly panel with a rounded top
    b0, b1 = pic.y(B["belly"][0]), pic.y(B["belly"][1])
    bx = pic.d(B["belly_half"])
    fz = -hd
    cube("torso", "belly", [-bx, b0, fz - 0.25], [bx, b1 - 0.75, fz + 0.1], "belly")
    cube("torso", "belly_top", [-bx + 0.75, b1 - 0.8, fz - 0.25], [bx - 0.75, b1, fz + 0.1], "belly")
    # bow tie
    w0, w1 = pic.y(B["bow"][0]), pic.y(B["bow"][1])
    wh = pic.d(B["bow_half"])
    mat = B["bow_mat"]
    k = (w1 - w0)
    cube("torso", "bowtie_knot", [-0.75, w0 + k * 0.15, fz - 0.9], [0.75, w1 - k * 0.15, fz - 0.05], mat)
    for s in (1, -1):
        cube("torso", "bowtie_inner", [0.75, w0 + k * 0.08, fz - 0.7], [wh * 0.55, w1 - k * 0.08, fz - 0.05], mat, s)
        cube("torso", "bowtie_wing", [wh * 0.55, w0, fz - 0.7], [wh, w1, fz - 0.05], mat, s)
    for i, (by, br) in enumerate(B["buttons"]):
        y = pic.y(by)
        r = pic.d(br)
        if B["button_round"]:
            cube("torso", f"button{i + 1}", [-r, y - r * 0.6, fz - 0.65], [r, y + r * 0.6, fz - 0.2], "black")
            cube("torso", f"button{i + 1}_v", [-r * 0.6, y - r, fz - 0.65], [r * 0.6, y + r, fz - 0.2], "black")
        else:
            cube("torso", f"button{i + 1}", [-r, y - r, fz - 0.6], [r, y + r, fz - 0.2], "black")
    if B.get("straps"):
        sx, t, b = B["straps"]
        x = pic.x(sx)
        for s in (1, -1):
            cube("torso", "strap", [x - 0.22, pic.y(b), fz - 0.2], [x + 0.22, pic.y(t), fz + 0.05], "strap", s)
    return hd, hw, c1


def arm_segment(b, s, piv, seg, mat="fur", name="block"):
    """Block of one arm segment in authored (straight-down) coordinates below pivot piv."""
    px, py = piv
    a0, a1 = seg["span"]
    hw, hd = seg["half"]
    cx = px + seg["ox"]
    rbox(b, name, cx - hw, cx + hw, py - a1, py - a0, -hd, hd, mat, s, r=0.9, steps=3)


def build_arms(name, hw):
    pic, A = P[name], ARMS[name]
    sx, sy = pic.x(A["shoulder"][0]), pic.y(A["shoulder"][1])
    up, fo = A["upper"], A["fore"]
    palm_centre = None
    for s, side in ((1, "right"), (-1, "left")):
        arm, fa, hand = f"{side}Arm", f"{side}Forearm", f"{side}Hand"
        bone(arm, "torso", [s * sx, sy, 0], [0, 0, s * up["angle"]])
        # shoulder joint from the chest edge into the top of the upper arm
        inner = sx + up["ox"] - up["half"][0]
        cube(arm, "shoulder_joint", [min(hw - 0.4, sx - 1.0), sy - 1.1, -1.3], [max(inner + 0.6, sx + 1.0), sy + 0.7, 1.3],
             "endo", s, painter=p_endo)
        rbox(arm, "shoulder_ball", sx - 1.35, sx + 1.35, sy - 1.35, sy + 1.35, -1.35, 1.35, "endo", s, r=0.6, painter=p_endo)
        arm_segment(arm, s, (sx, sy), up, name="upper_arm")
        cap = A.get("cap")
        if cap:
            # rounded shoulder cap on top of the upper arm, toward the neck (peeks out beside the jaw)
            cxc, top, cw, ch = sx + cap[0], sy + cap[1], cap[2], cap[3]
            rbox(arm, "shoulder_cap", cxc - cw, cxc + cw, top - ch, top, -up["half"][1] + 0.3, up["half"][1] - 0.3, "fur", s, r=0.8)
        ex, ey = sx + up["next"][0], sy - up["next"][1]
        bone(fa, arm, [s * ex, ey, 0], [0, 0, s * (fo["angle"] - up["angle"])])
        cube(fa, "elbow_joint", [ex - 1.1, ey - 0.8, -1.1], [ex + 1.1, ey + 0.8, 1.1], "endo", s, painter=p_endo)
        arm_segment(fa, s, (ex, ey), fo, name="forearm")
        # the wrist sits right under the middle of the forearm block, on its axis
        wx, wy = ex + fo["ox"], ey - fo["span"][1] - 0.5
        palm_centre = build_hand(name, side, s, fa, (wx, wy), fo["angle"])
    return palm_centre


# Hands, built to work rather than to copy the pictures' poses: the palm hangs straight under the
# wrist facing the leg, the fingers hang straight down in a row from its bottom edge and the thumb
# sits at its front.  They are laid out below with the back of the hand facing forward and the thumb
# on the inner edge, and the hand bone turns a quarter to face the leg.  Every finger and thumb
# segment is its own bone with no rest rotation, so a positive X rotation bends any joint straight
# into a fist.  Sizes in model px:
#   palm    width, height, depth
#   segs    finger segment lengths (knuckle, middle, tip); seg_w / seg_d their width and depth
#   thumb   thumb segment lengths; thumb_w its width
#   tilt    how far the hand continues the forearm's outward tilt (0: it hangs straight down)
HANDS = {
    "golden_freddy": dict(kind="endo", palm=(5.4, 3.0, 2.4), fingers=3, segs=(2.0, 1.8, 1.6), seg_w=1.45, seg_d=1.45,
                          ball=0.95, thumb=(1.9, 1.6), thumb_w=1.3, tilt=0.5),
    "crimson_freddy": dict(kind="mitt", palm=(4.6, 3.8, 2.8), fingers=4, segs=(1.6, 1.4, 1.2), seg_w=1.12, seg_d=1.5,
                           thumb=(2.0, 1.6), thumb_w=1.5, tilt=0.3),
    "violet_bunny": dict(kind="mitt", palm=(4.4, 3.8, 2.6), fingers=4, segs=(1.45, 1.3, 1.1), seg_w=1.06, seg_d=1.4,
                         thumb=(1.8, 1.5), thumb_w=1.4, tilt=0.3),
}
FINGER_SEGS = "abc"
THUMB_SPLAY = 18.0      # the thumb hangs angled in, away from the palm (degrees)


def tip_painter(ctx):
    """Finger tip: fur with a darker, worn end."""
    ctx.paint("fur")
    c = ctx.cube
    y0, y1 = c.frm[1], c.to[1]
    ctx.paint("fur_dark", mask=ctx.Y < y0 + (y1 - y0) * 0.4)


def finger_chain(side, s, parent, x, y, z, lengths, w, d, prefix, endo, ball, rot=None):
    """One finger (or thumb): a bone per segment, each pivoting at the top of its segment and hanging
    straight down from it.  rot is the first bone's rest rotation (the thumb's splay)."""
    for j, L in enumerate(lengths):
        b = f"{prefix}{FINGER_SEGS[j]}"
        bone(b, parent, [s * x, y, z], rot if j == 0 and rot else None)
        last = j == len(lengths) - 1
        if endo:
            cube(b, "joint", [x - ball / 2, y - ball / 2, z - ball / 2], [x + ball / 2, y + ball / 2, z + ball / 2], "endo", s,
                 painter=p_endo)
            y0, y1 = y - L + (0.0 if last else 0.3), y - 0.3
        else:
            y0, y1 = y - L + 0.04, y + 0.06
        rbox(b, "segment", x - w / 2, x + w / 2, y0, y1, z - d / 2, z + d / 2, "fur", s, r=0.28 if endo else 0.16,
             painter=tip_painter if last else None)
        parent, y = b, y - L


def build_hand(name, side, s, parent, wrist, parent_angle):
    """Palm under the wrist, a row of fingers along its bottom edge (outermost first, the index finger
    last, next to the thumb) and the thumb on its inner edge."""
    Hd = HANDS[name]
    hand = f"{side}Hand"
    wx, wy = wrist
    # turned a quarter about the vertical so the palm faces the leg and the thumb points forward
    bone(hand, parent, [s * wx, wy, 0], [0, -s * 90.0, -s * parent_angle * (1 - Hd["tilt"])])
    cube(hand, "wrist_joint", [wx - 0.9, wy - 0.7, -0.9], [wx + 0.9, wy + 0.6, 0.9], "endo", s, painter=p_endo)
    pw, ph, pd = Hd["palm"]
    top = wy - 0.45
    rbox(hand, "palm", wx - pw / 2, wx + pw / 2, top - ph, top, -pd / 2, pd / 2, "fur", s, r=0.45)
    endo = Hd["kind"] == "endo"
    if endo:
        # two tendon rods running from the wrist over the back of the hand
        for k, dx in enumerate((-0.4, 0.45)):
            cube(hand, f"rod{k + 1}", [wx + dx - 0.18, top - ph + 0.8, -pd / 2 - 0.4], [wx + dx + 0.18, wy + 0.3, -pd / 2],
                 "endo", s, painter=p_endo)
    else:
        # chrome pins at the wrist, beside the joint
        cube(hand, "wrist_pin", [wx + 1.0, wy - 1.0, -0.35], [wx + 1.45, wy + 0.2, 0.35], "chrome", s, painter=p_chrome)
    n, w, d = Hd["fingers"], Hd["seg_w"], Hd["seg_d"]
    ky = top - ph + (0.3 if not endo else 0.0)
    span = pw - w - (0.1 if not endo else 0.3)
    for i in range(n):
        x = wx + span / 2 - i * span / (n - 1)
        finger_chain(side, s, hand, x, ky, 0.0, Hd["segs"], w, d, f"{side}Finger{i + 1}", endo, Hd.get("ball", 0.9))
    tw = Hd["thumb_w"]
    tx = wx - pw / 2 - tw / 2 + 0.25
    finger_chain(side, s, hand, tx, top - ph * 0.35, 0.25, Hd["thumb"], tw, min(tw, d), f"{side}Thumb", endo,
                 Hd.get("ball", 0.9), rot=[0, 0, -s * THUMB_SPLAY])
    return (wx, top - ph / 2, 0.0)


def build_head(name):
    pic, H = P[name], HEADS[name]
    fz, back = H["front"], H["back"]
    hp = pic.y(H["pivot"])
    bone("head", "torso", [0, hp, 0])
    S = H["sockets"]
    e0, e1 = pic.y(S["rows"][0]), pic.y(S["rows"][1])
    sx0, sx1 = half_pair(pic, *S["inner"]), half_pair(pic, *S["outer"])
    deep = H["deep"]
    mask = H["mask"]
    mhw = half_pair(pic, *mask["half"]) if mask else 0.0
    for i, (r0, r1, hpx) in enumerate(H["slabs"]):
        y0, y1, w = pic.y(r0), pic.y(r1), pic.d(hpx)
        top = i == 0
        zf = fz + (0.7 if top else 0.0)
        # parts of the slab below, inside and above the eye band
        for (a, b_), part in (((y0, min(y1, e0)), "low"), ((max(y0, e0), min(y1, e1)), "eye"), ((max(y0, e1), y1), "high")):
            if b_ - a < 0.02:
                continue
            nm = f"head{i + 1}_{part}"
            if part != "eye":
                rbox("head", nm, -w, w, a, b_, zf, back - (0.4 if top else 0.0), "fur", r=0.9 if top else 0.75, axes="xyz" if top else "xz")
                continue
            cube("head", nm, [-w, a, fz + deep], [w, b_, back], "fur",
                 painter=socket_wall(name, [(half_pair(pic, *H["pupils"]["x"]), pic.y(H["pupils"]["row"]))]),
                 faces={"east": "fur", "west": "fur", "up": "fur", "down": "fur", "south": "fur"})
            pz = fz - 0.15 if mask else fz      # the face plate is one flat surface round the sockets
            cube("head", nm + "_bridge", [-sx0, a, pz], [sx0, b_, fz + deep], "mask" if mask else "fur")
            for s in (1, -1):
                if mask and mhw > sx1:
                    cube("head", nm + "_side", [sx1, a, pz], [mhw, b_, fz + deep], "mask", s)
                    cube("head", nm + "_outer", [mhw, a, fz], [w, b_, fz + deep], "fur", s)
                else:
                    cube("head", nm + "_side", [sx1, a, fz], [w, b_, fz + deep], "fur", s)
    # round off the socket corners in three small steps, so the sockets read as round holes
    for s in (1, -1):
        for (x, dx), (y, dy) in (((sx0, 1), (e0, 1)), ((sx1, -1), (e0, 1)), ((sx0, 1), (e1, -1)), ((sx1, -1), (e1, -1))):
            inside_mask = mask and x <= mhw
            pz = fz - 0.15 if inside_mask else fz
            for k, (cx_, cy_) in enumerate(((0.75, 0.25), (0.5, 0.5), (0.25, 0.75))):
                cube("head", f"socket_corner{k + 1}", [min(x, x + dx * cx_), min(y, y + dy * cy_), pz],
                     [max(x, x + dx * cx_), max(y, y + dy * cy_), fz + deep], "mask" if inside_mask else "fur", s)
    if mask:
        m0, m1 = pic.y(mask["rows"][0]), pic.y(mask["rows"][1])
        cube("head", "mask_top", [-mhw, e1, fz - 0.15], [mhw, m1, fz + 0.2], "mask")
        if e0 > m0:
            cube("head", "mask_low", [-mhw, m0, fz - 0.15], [mhw, e0, fz + 0.2], "mask")
    if H["brow"]:
        Bw = H["brow"]
        b0, b1 = pic.y(Bw["rows"][0]), pic.y(Bw["rows"][1])
        bi, bo = half_pair(pic, *Bw["inner"]), half_pair(pic, *Bw["outer"])
        for s in (1, -1):
            rbox("head", "brow", bi, bo, b0, b1, fz - 0.55, fz + 0.3, Bw["mat"], s, r=0.3)
    C = H["cheeks"]
    c0, c1 = pic.y(C["rows"][0]), pic.y(C["rows"][1])
    cw = half_pair(pic, *C["out"])
    w_at = max(pic.d(hpx) for r0, r1, hpx in H["slabs"] if pic.y(r0) <= (c0 + c1) / 2 <= pic.y(r1))
    for s in (1, -1):
        rbox("head", "cheek", w_at - 0.4, cw, c0, c1, fz + 0.4, fz + 4.6, "fur", s, r=0.7)
    # muzzle (split down the middle), nose, mouth, teeth, jaw
    M = H["muzzle"]
    sn0, sn1 = pic.y(M["rows"][0]), pic.y(M["rows"][1])
    mh = half_pair(pic, *M["half"])
    sz = fz - M["depth"]
    dots = [(pic.x(fx), pic.y(fy)) for fx, fy in M["freckles"]]
    for s in (1, -1):
        rbox("head", "muzzle", 0.07, mh, sn0, sn1, sz, fz + 0.3, "muzzle", s, r=0.6, painter=freckle_painter("muzzle", dots))
    N = H["nose"]
    n0, n1 = pic.y(N["rows"][0]), pic.y(N["rows"][1])
    nw = half_pair(pic, *N["half"])
    rbox("head", "nose", -nw, nw, n0, n1, sz - 0.45, sz + 1.3, "black", r=0.5)
    J = H["jaw"]
    j0, j1 = pic.y(J["rows"][0]), pic.y(J["rows"][1])
    jh = half_pair(pic, *J["half"])
    cube("head", "mouth", [-jh + 0.4, j1 - 0.1, sz + 0.5], [jh - 0.4, sn0, back - 1.0], "socket")
    bone("jaw", "head", [0, j1, 3.0])
    rbox("jaw", "jaw", -jh, jh, j0, j1, sz + 0.1, 4.2, J["mat"], r=0.65)
    cube("jaw", "mouth_floor", [-jh + 0.6, j1, sz + 0.6], [jh - 0.6, j1 + 0.08, 3.6], "socket")
    T = H["teeth"]
    t0, t1 = pic.y(T["rows"][0]), pic.y(T["rows"][1])
    span = half_pair(pic, *T["span"])
    tw = pic.d(T["w"])
    n = T["n"]
    for i in range(n):
        x = -span + tw / 2 + i * (2 * span - tw) / (n - 1)
        cube("jaw", f"tooth{i + 1}", [x - tw / 2, t0 - 0.05, sz + 0.25], [x + tw / 2, t1, sz + 1.0], "teeth")
    if H["tears"]:
        Tr = H["tears"]
        r0, r1 = pic.y(Tr["rows"][0]), pic.y(Tr["rows"][1])
        for pair in Tr["x"]:
            x = half_pair(pic, *pair)
            for s in (1, -1):
                on_muzzle = x < mh
                cube("head", "tear_wire", [x - 0.14, r0, (sz if on_muzzle else fz) - 0.08], [x + 0.14, min(r1, sn1), (sz if on_muzzle else fz) + 0.1],
                     "black", s)
                if on_muzzle:
                    cube("head", "tear_wire_top", [x - 0.14, sn1 - 0.1, fz - 0.08], [x + 0.14, r1, fz + 0.1], "black", s)
                    cube("head", "tear_wire_over", [x - 0.14, sn1 - 0.25, sz - 0.08], [x + 0.14, sn1 + 0.05, fz + 0.1], "black", s)
    # eyes
    py = pic.y(H["pupils"]["row"])
    bone("eyes", "head", [0, py, fz + deep])
    for s in (1, -1):
        # a glossy eyeball filling each socket, painted at 32 texels per pixel
        cube("eyes", "eyeball", [sx0 + 0.02, e0 + 0.02, fz + deep - 0.3], [sx1 - 0.02, e1 - 0.02, fz + deep - 0.05], "eyeball", s,
             painter=eyeball_painter(name, s), res=32)
    return fz, back, hp


def build_round_ears(name):
    pic, E = P[name], HEADS[name]["ears"]
    ex = half_pair(pic, *E["centre"][0])
    ey = pic.y(E["centre"][1])
    w, h = pic.d(E["size"][0]), pic.d(E["size"][1])
    outer, ring, inner = E["colours"]
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        bone(e, "head", [s * (ex - w * 0.35), ey - h * 0.3, 0.2])
        disc(e, "ear", ex, ey, w, h, -0.7, 0.7, outer, s,
             painter=ring_painter(outer, ring, inner, E["ring"], E["inner"]))
        if E.get("pin"):
            cube(e, "ear_pin", [ex - w / 2 - 1.0, ey - 0.35, -0.35], [ex - w / 2 + 0.4, ey + 0.35, 0.35], "chrome", s,
                 painter=p_chrome)


# Violet Bunny's ears in picture px: joints, tips, tilt angles (degrees) and half widths (model px)
BUNNY_EARS = dict(right_joint=(431.2, 221.9), right_len=195.6, right_angle=-18.2, right_half=2.7,
                      left_joint=(624.1, 233.5), left_base=103.1, left_angle=35.2, base_half=1.9, fold_angle=108.7,
                      left_len=178.8, top_half=1.7)


def build_bunny_ears(name):
    """Right ear stands up (tilted out); the left one bends at its chrome joint and folds down."""
    pic, E = P[name], BUNNY_EARS
    jx, jy = pic.x(E["right_joint"][0]), pic.y(E["right_joint"][1])
    bone("rightEar", "head", [jx, jy, 0.3], [0, 0, E["right_angle"]])
    cube("rightEar", "ear_joint", [jx - 0.6, jy - 0.4, -0.3], [jx + 0.6, jy + 1.0, 0.9], "chrome", painter=p_chrome)
    L, w = E["right_len"] / SCALE, E["right_half"]
    rbox("rightEar", "ear", jx - w, jx + w, jy + 0.8, jy + 0.8 + L, -0.55, 0.95, "fur", r=0.65,
         painter=panel_painter("ear_inner", "fur", 0.75))
    jx, jy = pic.x(E["left_joint"][0]), pic.y(E["left_joint"][1])
    bone("leftEar", "head", [jx, jy, 0.3], [0, 0, E["left_angle"]])
    cube("leftEar", "ear_joint", [jx - 0.6, jy - 0.4, -0.3], [jx + 0.6, jy + 1.0, 0.9], "chrome", painter=p_chrome)
    Lb, w = E["left_base"] / SCALE, E["base_half"]
    rbox("leftEar", "ear_base", jx - w, jx + w, jy + 0.4, jy + 0.4 + Lb, -0.55, 0.95, "fur", r=0.6,
         painter=panel_painter("ear_inner", "fur", 0.7))
    fy = jy + 0.4 + Lb
    bone("leftEarTop", "leftEar", [jx, fy - 0.3, 0.3], [0, 0, E["fold_angle"]])
    Lt, w = E["left_len"] / SCALE, E["top_half"]
    cube("leftEarTop", "ear_hinge", [jx - 0.55, fy - 0.7, -0.25], [jx + 0.55, fy + 0.1, 0.85], "chrome", painter=p_chrome)
    rbox("leftEarTop", "ear_top", jx - w, jx + w, fy - 0.2, fy - 0.2 + Lt, -0.55, 0.95, "fur", r=0.65,
         painter=panel_painter("ear_inner", "fur", 0.75, faces=("south",)))


def build_hat(name):
    pic, Hh = P[name], HEADS[name]["hat"]
    b0, b1, bx0, bx1 = Hh["brim"]
    c0, c1, cx0, cx1 = Hh["crown"]
    hx = pic.x((cx0 + cx1) / 2)
    yb0 = pic.y(b0)
    bone("hat", "head", [hx, yb0, 0.0])
    bw, cw = abs(bx1 - bx0) / 2 / SCALE, abs(cx1 - cx0) / 2 / SCALE
    bxc = pic.x((bx0 + bx1) / 2)
    rbox("hat", "brim", bxc - bw, bxc + bw, yb0 - 0.2, pic.y(b1), -bw * 0.95, bw * 0.95, "hat", r=0.3)
    rbox("hat", "crown", hx - cw, hx + cw, pic.y(b1) - 0.1, pic.y(c1), -cw * 0.95, cw * 0.95, "hat", r=0.3)


def build(name):
    bone("root", None, [0, 0, 0])
    build_legs(name)
    hd, hw, c1 = build_body(name)
    H = HEADS[name]
    hp = P[name].y(H["pivot"])
    cube("torso", "neck", [-1.3, c1 - 1.0, -1.2], [1.3, hp + 1.0, 1.4], "endo", painter=p_endo)
    PALM[name] = build_arms(name, hw)
    build_head(name)
    if H["ears"]["kind"] == "round":
        build_round_ears(name)
    else:
        build_bunny_ears(name)
    if H["hat"]:
        build_hat(name)


PALM = {}
BUILDERS = {n: (lambda n=n: build(n)) for n in P}


def dims(name):
    """Key measurements in model px, for the animations."""
    pic, B, H = P[name], BODY[name], HEADS[name]
    return dict(half_w=pic.d(B["chest_half"]), torso=(pic.y(B["chest"][0]), pic.y(B["chest"][1])),
                torso_d=B["depth"], head_pivot=pic.y(H["pivot"]), face_z=H["front"],
                mouth=(0.0, pic.y(H["muzzle"]["rows"][0]) - 0.2, H["front"] - H["muzzle"]["depth"] - 1.0),
                shoulder=(pic.x(ARMS[name]["shoulder"][0]), pic.y(ARMS[name]["shoulder"][1])))


def spec(name):
    from characters import fred3_anims

    # the palm centre comes from the geometry, so build it once up front
    from fnafkit import rig
    rig.reset(MATERIALS[name], tpu=4)
    build(name)
    palm = PALM[name]
    D = dims(name)
    return export.Character(
        model_id=name,
        entity_id=f"fnaf:{name}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", name),
        materials=MATERIALS[name],
        build_geometry=BUILDERS[name],
        build_anims=lambda: fred3_anims.CLIPS[name](name).build(name),
        sources=[os.path.abspath(__file__), os.path.join(HERE, "fred3_anims.py"), os.path.join(HERE, "night.py"),
                 os.path.join(HERE, "body.py"), name],
        spawn_egg=EGGS[name],
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=palm, chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                                       y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(6, 5, 2.5),
        atlas_width=1024,
        tpu=4,
        shading=SHADING,
    )
