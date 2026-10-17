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
    "golden_freddy": {"fur": (0.82, 0.75, 0.22), "fur_dark": (0.82, 0.75, 0.22), "ear_ring": (0.82, 0.75, 0.22), "belly": (0.90, 0.84, 0.69), "muzzle": (0.99, 0.91, 0.46), "brow": (0.99, 0.91, 0.46), "hat": (0.48, 0.46, 0.44), "sole": (0.71, 0.68, 0.66)},
    "crimson_freddy": {"fur": (0.77, 0.67, 0.64), "fur_dark": (0.77, 0.67, 0.64), "belly": (0.83, 0.83, 0.81), "muzzle": (0.88, 0.87, 0.85), "mask": (0.78, 0.72, 0.69), "ear_inner": (0.79, 0.75, 0.71), "hat": (0.47, 0.40, 0.50), "sole": (0.64, 0.59, 0.59)},
    "violet_bunny": {"fur": (0.78, 0.83, 1.03), "fur_dark": (0.78, 0.83, 1.03), "belly": (0.89, 0.88, 0.85), "muzzle": (1.18, 1.30, 1.26), "mask": (1.17, 1.18, 1.16), "band": (0.52, 0.32, 0.37), "strap": (0.52, 0.32, 0.37), "sole": (0.71, 0.69, 0.69), "red": (0.62, 0.32, 0.32)},
}

for _n, _cal in CALIBRATION.items():
    for _mat, _k in _cal.items():
        _m = MATERIALS[_n][_mat]
        _m["tones"] = [tuple(int(round(min(255, c * k))) for c, k in zip(t, _k)) for t in _m["tones"]]
        if _m.get("patches"):
            _m["patches"] = [(a, b, [tuple(int(round(c * k)) for c, k in zip(t, _k)) for t in ts]) for a, b, ts in _m["patches"]]

# eye colours: iris, rim, glow (None: the eye doesn't glow)
EYES = {
    "golden_freddy": dict(iris=(92, 36, 28), rim=(152, 128, 122), glow=None, r=0.5),
    "crimson_freddy": dict(iris=(214, 24, 32), rim=(236, 214, 214), glow=(210, 24, 30), r=0.5),
    "violet_bunny": dict(iris=(204, 22, 26), rim=(236, 216, 220), glow=(200, 20, 24), r=0.5),
}

# --------------------------------------------------------------------------
# Painters
# --------------------------------------------------------------------------


def p_endo(ctx):
    """Dark glossy endoskeleton metal (finger joints, neck, wrist rods)."""
    p_chrome(ctx)
    ctx.rgb[...] = ctx.rgb * 0.3 + np.array([4, 4, 6], np.float32)


def eye_painter(name):
    e = EYES[name]

    def painter(ctx):
        c = ctx.cube
        cx, cy = (c.frm[0] + c.to[0]) / 2, (c.frm[1] + c.to[1]) / 2
        ctx.paint("socket")
        if ctx.face != "north":
            return
        d = np.sqrt((ctx.X - cx) ** 2 + (ctx.Y - cy) ** 2)
        r = e["r"]
        # the eye is 4x4 texels: dark 2x2 pupil, a ring of iris texels, rim in the corners
        rim = (d < r * 1.5) & (d >= 0.42)
        iris = (d < 0.42) & (d >= 0.2)
        pupil = d < 0.2
        ctx.rgb[rim] = np.array(e["rim"], np.float32)
        ctx.rgb[iris] = np.array(e["iris"], np.float32)
        ctx.rgb[pupil] = np.array([20, 6, 8], np.float32)
        if e["glow"]:
            ctx.glow(tuple(v * 0.55 for v in e["glow"]), iris)
            ctx.glow(tuple(v * 0.2 for v in e["rim"]), rim)

    return painter


def socket_wall(name, pupils):
    """Back wall of the eye band: black, faintly lit around the irises."""
    e = EYES[name]

    def painter(ctx):
        ctx.paint("socket")
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


def rbox(b, name, x0, x1, y0, y1, z0, z1, mat, s=1, r=0.5, painter=None, faces=None, axes="xyz"):
    """Box with its edges rounded off in two voxel steps (four overlapping cubes): the chunky,
    pillowy look of the pictures.  axes="xz" rounds only the vertical edges (for stacked slabs)."""
    lim = [(x1 - x0) / 2.2, (z1 - z0) / 2.2] + ([(y1 - y0) / 2.2] if "y" in axes else [])
    r = min([r] + lim)
    if r <= 0.05:
        return [cube(b, name, [x0, y0, z0], [x1, y1, z1], mat, s, painter=painter, faces=faces)]
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
    "golden_freddy": dict(chest=(800, 465), chest_half=175.4, depth=4.4, belly=(790, 530), belly_half=107, pelvis=(868, 800),
            pelvis_half=177.6, bow=(545, 490), bow_half=90, bow_mat="black", buttons=((575, 19), (625, 19)),
            button_round=True),
    "crimson_freddy": dict(chest=(850, 490), chest_half=189.3, depth=4.5, belly=(850, 570), belly_half=92, pelvis=(930, 845),
            pelvis_half=189.8, bow=(580, 535), bow_half=80, bow_mat="black", buttons=((600, 17.5), (655, 17.5)),
            button_round=False),
    "violet_bunny": dict(chest=(855, 545), chest_half=156.4, depth=3.9, belly=(845, 580), belly_half=80, pelvis=(915, 850),
            pelvis_half=167, pelvis_mat="band", bow=(610, 575), bow_half=66, bow_mat="red", buttons=(), straps=(420,
            560, 850)),
}

# legs: leg centre (pair), thigh/knee/shin/heel/toes/sole picture rows, widths and foot span
LEGS = {
    "golden_freddy": dict(leg_x=(442.3, 687.3), thigh=(1030, 850), thigh_half=103.2, knee=(1060, 1030), knee_half=30, shin=(1265,
            1060), shin_half=82.3, heel_top=1265, toe_top=1310, sole_top=1400, foot=(236.2, 516.9)),
    "crimson_freddy": dict(leg_x=(407.2, 685.1), thigh=(1065, 900), thigh_half=108.1, knee=(1100, 1065), knee_half=31, shin=(1290,
            1100), shin_half=83.8, heel_top=1290, toe_top=1330, sole_top=1395, foot=(193.1, 505.9)),
    "violet_bunny": dict(leg_x=(414.9, 649.7), thigh=(1080, 905), thigh_half=91.4, knee=(1110, 1080), knee_half=29, shin=(1290,
            1110), shin_half=79.4, heel_top=1290, toe_top=1330, sole_top=1400, foot=(202.8, 492.3)),
}

# arms: shoulder pivot (picture point), then each segment along its own axis in model px:
#   angle  absolute outward tilt of the segment in the picture (degrees)
#   span   (top, bottom) of the block measured down the axis from the segment's pivot
#   ox     sideways offset of the block centre from the axis (+ = outward)
#   half   half width / half depth of the block
#   next   (sideways offset, distance) of the next joint's pivot
ARMS = {
    "golden_freddy": dict(shoulder=(321.71, 449.96), upper=dict(angle=20.16, span=(-2.8, 7.72), ox=-1.29, half=(2.89, 2.7),
            next=(-0.19, 8.28)), fore=dict(angle=6.38, span=(0.25, 6.44), ox=-0.89, half=(3, 2.7), next=(1.08, 7.43)),
            hand=dict(angle=1.43, kind="endo"), cap=(-1.6, 1.4, 2.2, 2.6)),
    "crimson_freddy": dict(shoulder=(361.09, 480.69), upper=dict(angle=0.87, span=(-0.26, 7.56), ox=2.1, half=(2.62, 2.7),
            next=(3.28, 7.45)), fore=dict(angle=3.16, span=(0.31, 6.83), ox=0.43, half=(2.92, 2.6), next=(0.75, 7.04)),
            hand=dict(angle=3.02, kind="mitt", ox=-0.2, palm=(0.4, 4.63), half=(2.82, 2), fingers=4.13), cap=(-1.71,
            2.89, 2.49, 3.9)),
    "violet_bunny": dict(shoulder=(375.12, 529), upper=dict(angle=0.81, span=(-0.38, 6.62), ox=2.29, half=(2.6, 2.5), next=(3.31,
            7.39)), fore=dict(angle=1.91, span=(-0.27, 6.05), ox=0.39, half=(2.7, 2.5), next=(0.69, 6.48)),
            hand=dict(angle=0.13, kind="mitt", ox=0.07, palm=(0.45, 5.03), half=(2.65, 2), fingers=3.09), cap=(-0.55,
            3.29, 2.2, 5.79)),
}

# heads: slabs (bottom row, top row, half width) top-down silhouette; sockets, mask, muzzle, nose,
# jaw and teeth rows; ears; hat.  Everything in picture px except depths.
HEADS = {
    "golden_freddy": dict(pivot=460, front=-5.2, back=5, slabs=((160, 135, 127.5), (200, 160, 138.3), (275, 200, 142.5), (365, 275,
            134.7), (405, 365, 151.5)), sockets=dict(rows=(305, 225), inner=(535, 565), outer=(455, 645)),
            pupils=dict(x=(510, 606), row=265), deep=0.8, mask=None, brow=dict(rows=(225, 205), inner=(540, 560),
            outer=(455, 645), mat="brow"), cheeks=dict(rows=(360, 249.1), out=(391.8, 718.4)), muzzle=dict(rows=(405,
            315), half=(445, 650), depth=2.8, freckles=()), nose=dict(rows=(355, 315), half=(518, 585)),
            jaw=dict(rows=(460, 425), half=(440, 650), mat="fur"), teeth=dict(rows=(425, 406), span=(488, 622), n=4,
            w=25), tears=dict(x=((466, 648), (480, 632)), rows=(385, 305)), ears=dict(kind="round", centre=((346.4,
            700.2), 152.9), size=(116.6, 151.7), inner=0.8, ring=0.6, colours=("fur", "ear_ring", "brow")),
            hat=dict(brim=(125, 97.9, 443.5, 642.6), crown=(100, 6.3, 478.1, 607.5))),
    "crimson_freddy": dict(pivot=490, front=-5.3, back=5.1, slabs=((160, 145, 107.7), (230, 160, 152.7), (350, 230, 157.3), (445,
            350, 155.9)), sockets=dict(rows=(330, 255), inner=(545, 580), outer=(465, 655)), pupils=dict(x=(515, 595),
            row=292), deep=0.8, mask=dict(rows=(335, 220), half=(445, 650)), brow=None, cheeks=dict(rows=(355, 267),
            out=(357.6, 712.6)), muzzle=dict(rows=(445, 345), half=(448, 655), depth=2.9, freckles=((468, 405), (482,
            395), (474, 420))), nose=dict(rows=(380, 335), half=(520, 600)), jaw=dict(rows=(500, 475), half=(450, 650),
            mat="fur"), teeth=dict(rows=(475, 455), span=(485, 630), n=4, w=28), tears=None, ears=dict(kind="round",
            centre=((357.2, 753.6), 161.9), size=(139.4, 175.6), inner=1.4, ring=0, colours=("fur", "ear_inner",
            "ear_inner"), pin=True), hat=dict(brim=(118.4, 122.8, 456, 651.5), crown=(112, 18.2, 469.9, 616.3))),
    "violet_bunny": dict(pivot=545, front=-5, back=4.8, slabs=((212, 195, 55), (225, 212, 77), (300, 225, 110), (420, 300, 161.7),
            (500, 420, 87.8)), sockets=dict(rows=(410, 330), inner=(510, 535), outer=(430, 615)), pupils=dict(x=(465,
            570), row=352), deep=0.8, mask=dict(rows=(420, 300), half=(425, 620)), brow=None, cheeks=dict(rows=(480,
            403.5), out=(360.7, 656.5)), muzzle=dict(rows=(500, 430), half=(420, 630), depth=2.6, freckles=((438, 445),
            (452, 452), (444, 470))), nose=dict(rows=(445, 420), half=(495, 545)), jaw=dict(rows=(555, 540), half=(430,
            630), mat="fur"), teeth=dict(rows=(540, 510), span=(465, 595), n=5, w=25), tears=None,
            ears=dict(kind="bunny"), hat=None),
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
    for s, side in ((1, "right"), (-1, "left")):
        leg, shin, foot = f"{side}Leg", f"{side}Shin", f"{side}Foot"
        t0, t1 = pic.y(L["thigh"][0]), pic.y(L["thigh"][1])
        tw = pic.d(L["thigh_half"])
        bone(leg, "root", [s * lx, t1 - 0.6, 0])
        cube(leg, "hip_joint", [lx - 1.3, t1 - 1.2, -1.3], [lx + 1.3, t1 + 0.8, 1.3], "endo", s, painter=p_endo)
        rbox(leg, "thigh", lx - tw, lx + tw, t0, t1, -tw, tw, "fur", s, r=0.85)
        k0, k1 = pic.y(L["knee"][0]), pic.y(L["knee"][1])
        kw = pic.d(L["knee_half"])
        bone(shin, leg, [s * lx, (k0 + k1) / 2, 0])
        cube(shin, "knee_joint", [lx - kw, k0 - 0.2, -kw], [lx + kw, k1 + 0.2, kw], "endo", s, painter=p_endo)
        s0, s1 = pic.y(L["shin"][0]), pic.y(L["shin"][1])
        sw = pic.d(L["shin_half"])
        rbox(shin, "shin", lx - sw, lx + sw, s0, s1, -sw, sw, "fur", s, r=0.95)
        heel = pic.y(L["heel_top"])
        bone(foot, shin, [s * lx, heel + 0.4, 0])
        cube(foot, "ankle_joint", [lx - 1.1, heel - 0.4, -1.1], [lx + 1.1, heel + 0.9, 1.1], "endo", s, painter=p_endo)
        fo, fi = pic.x(L["foot"][0]), max(0.15, pic.x(L["foot"][1]))
        sole, toe = pic.y(L["sole_top"]), pic.y(L["toe_top"])
        fz0, fz1 = -8.8, 3.8
        cube(foot, "sole", [fi, 0.0, fz0], [fo, sole, fz1], "sole", s)
        rbox(foot, "heel", fi + 0.6, fo - 0.6, sole, heel, -3.6, fz1 - 0.2, "fur", s, r=0.8)
        gap = 0.18
        tw_ = (fo - fi - 2 * gap) / 3
        x = fi
        for i in range(3):
            rbox(foot, f"toe{i + 1}", x, x + tw_, sole, toe, fz0 + 0.1, -2.6, "fur", s, r=0.75)
            rbox(foot, f"toe{i + 1}_top", x + 0.25, x + tw_ - 0.25, toe - 0.3, toe + 0.9, fz0 + 1.3, -2.6, "fur", s, r=0.45)
            x += tw_ + gap


def build_body(name):
    pic, B = P[name], BODY[name]
    hd = B["depth"]
    p0, p1 = pic.y(B["pelvis"][0]), pic.y(B["pelvis"][1])
    ph = pic.d(B["pelvis_half"])
    bone("body", "root", [0, p0 + 0.8, 0])
    rbox("body", "pelvis", -ph, ph, p0, p1, -hd + 0.15, hd - 0.15, B.get("pelvis_mat", "fur"), r=0.8)
    c0, c1 = pic.y(B["chest"][0]), pic.y(B["chest"][1])
    hw = pic.d(B["chest_half"])
    bone("torso", "body", [0, p1, 0])
    cube("torso", "waist", [-hw + 1.0, p1 - 0.6, -hd + 1.0], [hw - 1.0, c0 + 0.4, hd - 1.0], "socket")
    rbox("torso", "chest", -hw, hw, c0, c1, -hd, hd, "fur", r=1.1)
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
    rbox(b, name, cx - hw, cx + hw, py - a1, py - a0, -hd, hd, mat, s, r=0.85)


def build_arms(name, hw):
    pic, A = P[name], ARMS[name]
    sx, sy = pic.x(A["shoulder"][0]), pic.y(A["shoulder"][1])
    up, fo, ha = A["upper"], A["fore"], A["hand"]
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
        wx, wy = ex + fo["next"][0], ey - fo["next"][1]
        bone(hand, fa, [s * wx, wy, 0], [0, 0, s * (ha["angle"] - fo["angle"])])
        cube(hand, "wrist_joint", [wx - 0.9, wy - 0.7, -0.9], [wx + 0.9, wy + 0.6, 0.9], "endo", s, painter=p_endo)
        if ha["kind"] == "endo":
            palm_centre = endo_hand(hand, side, s, wx, wy)
        else:
            palm_centre = mitt_hand(hand, side, s, wx, wy, ha)
    return palm_centre


def endo_hand(hand, side, s, wx, wy):
    """Golden Freddy's hand: furry back of the hand (facing forward) with two wire rods, and three
    bare endoskeleton fingers plus a thumb, each a chain of fur blocks on black ball joints."""
    hx = wx - 0.3
    rbox(hand, "palm", hx - 2.9, hx + 2.9, wy - 3.65, wy - 0.6, -1.25, 1.25, "fur", s, r=0.55)
    for k, dx in enumerate((0.35, -0.55)):
        cube(hand, f"wire{k + 1}", [hx + dx - 0.18, wy - 2.6, -1.6], [hx + dx + 0.18, wy - 0.1, -1.2], "endo", s, painter=p_endo)
    fing = f"{side}Fingers"
    ky = wy - 3.65
    bone(fing, hand, [s * hx, ky, 0])
    #                (offset, splay, length scale)
    for i, (fx, splay, ls) in enumerate(((1.95, 0.45, 1.0), (0.2, 0.1, 1.04), (-1.55, -0.25, 0.97))):
        segs = [(0.0, 0.9, "ball"), (0.8, 2.35, "seg"), (2.3, 3.15, "ball"), (3.1, 4.65, "seg"), (4.6, 5.25, "ball"),
                (5.2, 6.6, "seg")]
        for j, (a, b_, kind) in enumerate(segs):
            a, b_ = a * ls, b_ * ls
            x = hx + fx + splay * (a / 6.6)
            if kind == "ball":
                cube(fing, f"f{i + 1}_joint{j // 2 + 1}", [x - 0.52, ky - b_, -0.52], [x + 0.52, ky - a, 0.52], "endo", s,
                     painter=p_endo)
            else:
                rbox(fing, f"f{i + 1}_seg{j // 2 + 1}", x - 0.74, x + 0.74, ky - b_, ky - a, -0.74, 0.74,
                     "fur" if j < 5 else "fur_dark", s, r=0.28)
    th = f"{side}Thumb"
    tx, ty = hx - 3.85, wy - 1.1
    bone(th, hand, [s * tx, ty, -0.2])
    for j, (a, b_, kind) in enumerate(((0.0, 0.9, "ball"), (0.85, 2.4, "seg"), (2.35, 3.15, "ball"), (3.1, 4.6, "seg"))):
        if kind == "ball":
            cube(th, f"thumb_joint{j // 2 + 1}", [tx - 0.45, ty - b_, -0.65], [tx + 0.45, ty - a, 0.25], "endo", s, painter=p_endo)
        else:
            rbox(th, f"thumb_seg{j // 2 + 1}", tx - 0.6, tx + 0.6, ty - b_, ty - a, -0.8, 0.4, "fur", s, r=0.28)
    return (hx, wy - 2.1, 0.0)


def groove_painter(n, x0, x1, mat="fur"):
    """Fur with n-1 dark grooves between fingers (front, back and bottom faces)."""

    def painter(ctx):
        ctx.paint(mat)
        if ctx.face in ("north", "south", "down"):
            step = (x1 - x0) / n
            for k in range(1, n):
                ctx.rgb[np.abs(np.abs(ctx.X) - (x0 + k * step)) < 0.09] *= 0.45

    return painter


def mitt_hand(hand, side, s, wx, wy, ha):
    """Relaxed mitten hand: the back of the hand faces forward, the four fingers are one chunky block
    (grooved) curling back toward the palm and in toward the body, thumb on the inner side."""
    hx = wx + ha["ox"]
    p0, p1 = ha["palm"]
    hw, hd = ha["half"]
    rbox(hand, "palm", hx - hw, hx + hw, wy - p1, wy - p0, -hd, hd, "fur", s, r=0.85)
    fing = f"{side}Fingers"
    ky = wy - p1 + 0.4
    bone(fing, hand, [s * hx, ky, 0.4], [18, 0, -s * 12])
    fl = ha["fingers"]
    gp = groove_painter(4, hx - hw + 0.1, hx + hw - 0.1)
    rbox(fing, "fingers", hx - hw + 0.1, hx + hw - 0.1, ky - fl * 0.68, ky + 0.3, -hd + 0.05, hd - 0.05, "fur", s, r=0.9,
         painter=gp)
    rbox(fing, "finger_tips", hx - hw + 0.25, hx + hw - 0.25, ky - fl, ky - fl * 0.68 + 0.3, -hd + 0.5, hd, "fur", s, r=0.7,
         painter=gp)
    th = f"{side}Thumb"
    tx = hx - hw
    ty = wy - p0 - 1.4
    bone(th, hand, [s * tx, ty, -0.3], [0, 0, -s * 18])
    rbox(th, "thumb", tx - 1.3, tx + 0.4, ty - 2.8, ty + 0.4, -hd + 0.2, 0.8, "fur", s, r=0.65)
    return (hx, wy - (p0 + p1) / 2, 0.0)


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
            cube("head", nm + "_bridge", [-sx0, a, fz], [sx0, b_, fz + deep], "mask" if mask else "fur")
            for s in (1, -1):
                if mask and mhw > sx1:
                    cube("head", nm + "_side", [sx1, a, fz], [mhw, b_, fz + deep], "mask", s)
                    cube("head", nm + "_outer", [mhw, a, fz], [w, b_, fz + deep], "fur", s)
                else:
                    cube("head", nm + "_side", [sx1, a, fz], [w, b_, fz + deep], "fur", s)
    # round off the socket corners
    cr = 0.5
    for s in (1, -1):
        for (x, dx), (y, dy) in (((sx0, 1), (e0, 1)), ((sx1, -1), (e0, 1)), ((sx0, 1), (e1, -1)), ((sx1, -1), (e1, -1))):
            inside_mask = mask and x <= mhw
            cube("head", "socket_corner", [min(x, x + dx * cr), min(y, y + dy * cr), fz], [max(x, x + dx * cr), max(y, y + dy * cr), fz + deep],
                 "mask" if inside_mask else "fur", s)
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
            cube("head", "brow", [bi, b0, fz - 0.25], [bo, b1, fz + 0.3], Bw["mat"], s)
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
        rbox("head", "muzzle", 0.07, mh, sn0, sn1, sz, fz + 0.3, "muzzle", s, r=0.85, painter=freckle_painter("muzzle", dots))
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
                cube("head", "tear_wire", [x - 0.2, r0, (sz if on_muzzle else fz) - 0.08], [x + 0.2, min(r1, sn1), (sz if on_muzzle else fz) + 0.1],
                     "black", s)
                if on_muzzle:
                    cube("head", "tear_wire_top", [x - 0.2, sn1 - 0.1, fz - 0.08], [x + 0.2, r1, fz + 0.1], "black", s)
                    cube("head", "tear_wire_over", [x - 0.2, sn1 - 0.25, sz - 0.08], [x + 0.2, sn1 + 0.05, fz + 0.1], "black", s)
    # eyes
    pxm, py = half_pair(pic, *H["pupils"]["x"]), pic.y(H["pupils"]["row"])
    bone("eyes", "head", [0, py, fz + deep])
    r = EYES[name]["r"]
    for s in (1, -1):
        cube("eyes", "eye", [pxm - r, py - r, fz + deep - 0.1], [pxm + r, py + r, fz + deep], "glow", s, painter=eye_painter(name))
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
    rbox("hat", "brim", bxc - bw, bxc + bw, yb0 - 0.2, pic.y(b1), -bw * 0.95, bw * 0.95, "hat", r=0.55)
    rbox("hat", "crown", hx - cw, hx + cw, pic.y(b1) - 0.1, pic.y(c1), -cw * 0.95, cw * 0.95, "hat", r=0.75)


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
    )
