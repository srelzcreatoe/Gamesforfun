"""Three animatronics from the "night stage" reference pictures:

  spiral_bear   red-brown bear with spiral ears, a scruffy tuft, red bow tie, two buttons
  party_cat     golden cat with dark patches, striped party hat with a pom-pom, red collar
                with a gold bell, thick striped tail
  rat           dark grey rat with a red fez, whiskers, pink tongue, red bow tie, two
                buttons, a long pink tail and a microphone

They share one body plan (the blocky Freddy-style frame with chrome pistons at every
joint and big three-toed feet on a light sole).  The textures use the "every pixel is
a little cube" style of the pictures (fnafkit.rig voxel cells).
"""
import math
import os

import numpy as np

from characters.night import NightClips, ease, flip, window
from fnafkit import export
from fnafkit.anim import S, TAU, cs, flat_foot, pos, setr, sn, torso_goal
from fnafkit.rig import bone, cube
from fnafkit.servo import add_rot, meta, stepper

HERE = os.path.dirname(os.path.abspath(__file__))


def vox(*tones, w=None, patches=(), spots=(), bevel=0.14, cell=1.0):
    return dict(tones=list(tones), w=w or [1] * len(tones), patches=list(patches), spots=list(spots),
                bevel=bevel, cell=cell)


COMMON = {
    "black": vox((14, 12, 12), (20, 17, 16), (26, 22, 20), bevel=0.25),
    "socket": vox((6, 5, 5), (10, 8, 8), (14, 11, 10), bevel=0.2),
    "chrome": dict(tones=[(120, 120, 124)], w=[1], spots=[]),          # painted by p_chrome
    "glow": dict(tones=[(255, 255, 255)], w=[1], spots=[]),
    "mic_grey": vox((118, 118, 122), (134, 134, 137), (150, 150, 152), cell=0.6, bevel=0.2),
    "mic_handle": vox((22, 22, 24), (30, 30, 32), (38, 38, 40), cell=0.6),
}

MATERIALS = {
    "spiral_bear": {
        **COMMON,
        "fur": vox((70, 28, 18), (88, 36, 23), (104, 44, 28), (120, 53, 34), (138, 63, 40), (156, 74, 48), (56, 22, 14),
                   w=[2, 3, 3, 3, 2, 1, 2], patches=[(2.2, 0.64, [(50, 19, 12), (60, 24, 15)])]),
        "fur_dark": vox((70, 28, 18), (80, 33, 21), (90, 38, 24)),
        "tan": vox((170, 120, 92), (182, 132, 102), (194, 142, 110), (206, 152, 118), (158, 110, 84),
                   patches=[(1.8, 0.76, [(136, 92, 70), (124, 84, 64)])]),
        "muzzle": vox((170, 122, 88), (182, 132, 96), (194, 142, 104), (158, 112, 80), spots=[((140, 98, 70), 0.06)]),
        "red": vox((104, 22, 22), (118, 28, 27), (132, 34, 32), (92, 18, 19)),
        "sole": vox((176, 160, 146), (188, 172, 158), (200, 184, 170)),
        "spiral_light": vox((176, 128, 90), (188, 138, 98), (198, 148, 106)),
        "spiral_dark": vox((82, 34, 22), (92, 39, 25), (102, 44, 28)),
    },
    "party_cat": {
        **COMMON,
        "fur": vox((158, 98, 36), (172, 110, 42), (184, 120, 48), (198, 132, 56), (144, 86, 30),
                   w=[2, 3, 3, 2, 2], patches=[(3.4, 0.67, [(98, 56, 22), (110, 64, 26), (90, 50, 18)])]),
        "fur_dark": vox((112, 66, 26), (124, 74, 30), (100, 58, 22)),
        "tan": vox((176, 140, 104), (188, 152, 114), (198, 162, 124), (166, 130, 96),
                   spots=[((140, 104, 74), 0.05)]),
        "muzzle": vox((186, 150, 112), (198, 162, 122), (208, 172, 132), spots=[((160, 124, 90), 0.05)]),
        "ear_dark": vox((66, 42, 27), (76, 49, 31), (58, 36, 23)),
        "hat_red": vox((150, 26, 30), (166, 32, 36), (178, 40, 42)),
        "hat_cream": vox((214, 198, 182), (224, 210, 194), (204, 188, 172)),
        "pompom": vox((140, 16, 22), (158, 22, 28), (124, 12, 18), (170, 30, 36), cell=0.5, bevel=0.3),
        "red": vox((130, 22, 24), (146, 28, 30), (118, 18, 20)),
        "gold": vox((176, 136, 52), (196, 156, 64), (212, 174, 82), (160, 120, 44), cell=0.5, bevel=0.22),
        "tail_light": vox((196, 108, 44), (210, 122, 52), (184, 98, 38)),
        "tail_dark": vox((96, 52, 22), (108, 60, 26), (86, 46, 18)),
        "sole": vox((186, 160, 132), (198, 172, 144), (176, 150, 122)),
    },
    "rat": {
        **COMMON,
        "fur": vox((52, 49, 52), (60, 57, 60), (70, 66, 69), (80, 76, 79), (44, 41, 44),
                   w=[2, 3, 3, 2, 2], patches=[(2.0, 0.7, [(38, 36, 39), (42, 40, 43)])]),
        "fur_dark": vox((50, 47, 50), (58, 54, 57), (66, 62, 64)),
        "tan": vox((128, 122, 121), (140, 134, 133), (152, 146, 145), (118, 112, 111),
                   patches=[(1.8, 0.8, [(106, 100, 99)])]),
        "muzzle": vox((158, 152, 150), (170, 164, 162), (182, 176, 174), spots=[((136, 130, 128), 0.05)]),
        "ear_dark": vox((54, 50, 53), (62, 58, 61), (70, 66, 68)),
        "ear_red": vox((108, 58, 62), (120, 66, 70), (132, 74, 78), (98, 52, 56)),
        "hat_red": vox((132, 26, 28), (148, 32, 34), (162, 40, 42), (120, 22, 24)),
        "red": vox((146, 30, 32), (162, 36, 38), (176, 44, 46)),
        "pink": vox((190, 104, 112), (204, 116, 124), (176, 94, 102), cell=0.5),
        "pink_dark": vox((150, 74, 82), (162, 82, 90), cell=0.5),
        "tongue": vox((176, 92, 96), (190, 104, 108), (164, 82, 86), cell=0.5),
        "whisker": vox((12, 12, 14), (18, 18, 20), cell=0.3, bevel=0.0),
        "sole": vox((170, 166, 166), (184, 180, 180), (160, 156, 156)),
    },
}

# --------------------------------------------------------------------------
# Per-character measurements (model pixels; one texture cell = one pixel), taken from
# each reference picture separately
# --------------------------------------------------------------------------

CH = {
    # lanky: long legs, big shoulder blocks, long-fingered claws, wide slit mouth
    "spiral_bear": dict(
        leg_c=3.5, foot_off=0.9, foot_hw=4.0, sole=0.9, toe_top=3.4, heel_top=4.8,
        ankle=(4.6, 6.1), shin=(5.9, 13.5), knee=(13.3, 15.1), thigh=(14.9, 22.5), shin_w=6.2, thigh_w=6.4,
        pelvis=(21.9, 24.3), pelvis_hw=5.2, torso=(24.3, 35.7), half_w=5.4, torso_d=4.2,
        head_pivot=36.4, head_half=6.0, face_z=-5.0, back=5.0, top=47.6,
        jaw=(34.9, 36.7), snout=(36.9, 39.9), snout_z=-7.4, muzzle_hw=5.0, seam=0.12, eyes=(40.1, 43.3),
        socket=(0.8, 4.8), brow=(0.9, 4.0, 0.95, 0), nose=(1.5, 1.4), teeth=(6, 0.8, 0.75), jaw_hw=5.0,
        freckles=((2.2, 2.3), (3.5, 2.0), (2.8, 1.1)),
        shoulder=(6.4, 34.6, 7), pad=(5.8, 11.6, 28.4, 35.8, 3.0), elbow_y=27.6, fore=(6.0, 11.2, 21.0, 27.0, 2.7),
        wrist_y=20.5, palm=(6.8, 10.6, 16.9, 20.2, 2.6), finger=(2.4, 1.9),
        belly=(4.2, 1.0, 2.4), buttons=(31.2, 28.4, 0.9)),
    # chunky: wide head and chest, belt-like pelvis band, short curled fingers, stepped toes
    "party_cat": dict(
        leg_c=3.8, foot_off=0.9, foot_hw=4.2, sole=0.9, toe_top=3.5, heel_top=4.9,
        ankle=(4.7, 6.0), shin=(5.8, 13.2), knee=(13.0, 14.7), thigh=(14.5, 23.0), shin_w=6.2, thigh_w=6.6,
        pelvis=(22.4, 24.8), pelvis_hw=6.3, torso=(24.6, 35.2), half_w=5.9, torso_d=4.5,
        head_pivot=36.0, head_half=6.5, face_z=-5.2, back=5.1, top=47.4,
        jaw=(34.6, 36.4), snout=(36.6, 39.8), snout_z=-7.8, muzzle_hw=4.9, seam=0.3, eyes=(40.0, 44.0),
        socket=(1.0, 5.0), brow=(1.4, 4.6, 0.85, 0), nose=(1.6, 1.3), teeth=(6, 0.8, 0.7), jaw_hw=5.2,
        freckles=((1.7, 2.3), (3.0, 2.1), (1.9, 1.3), (3.2, 1.0)),
        shoulder=(6.9, 34.0, 6), pad=(6.0, 11.9, 28.4, 35.5, 3.1), elbow_y=27.4, fore=(6.2, 11.6, 21.2, 27.0, 2.9),
        wrist_y=20.6, palm=(7.0, 10.9, 17.1, 20.3, 2.8), finger=(1.9, 1.5),
        belly=(4.9, 0.6, 1.6), buttons=None),
    # narrow, tall chest, long legs with long knee pistons, big head and huge ears
    "rat": dict(
        leg_c=3.2, foot_off=1.0, foot_hw=3.9, sole=0.9, toe_top=3.4, heel_top=4.8,
        ankle=(4.6, 6.1), shin=(5.9, 14.7), knee=(14.5, 16.5), thigh=(16.3, 23.9), shin_w=5.6, thigh_w=5.9,
        pelvis=(23.3, 25.5), pelvis_hw=5.0, torso=(25.5, 37.7), half_w=4.7, torso_d=4.0,
        head_pivot=38.5, head_half=6.0, face_z=-5.0, back=5.0, top=49.4,
        jaw=(37.0, 38.8), snout=(39.0, 41.9), snout_z=-7.6, muzzle_hw=4.1, seam=0.0, eyes=(42.1, 45.6),
        socket=(0.8, 4.7), brow=(0.9, 4.4, 0.45, 9), nose=(1.3, 2.0), teeth=(5, 0.75, 0.65), jaw_hw=4.3,
        freckles=((1.3, 2.0), (2.3, 2.3), (3.3, 1.9), (1.8, 1.1), (2.9, 1.0), (1.2, 0.5)),
        shoulder=(5.9, 36.6, 6), pad=(5.0, 10.4, 30.6, 37.7, 2.7), elbow_y=29.8, fore=(5.2, 10.2, 23.4, 29.4, 2.5),
        wrist_y=22.9, palm=(6.0, 9.6, 19.3, 22.5, 2.5), finger=(2.1, 1.7),
        belly=(3.8, 0.7, 2.2), buttons=(32.4, 29.8, 0.75)),
}



def lengthen(d, shin_add, thigh_add, head_half=None):
    """Make the shins / thighs longer, moving everything above them up."""
    d = dict(d)

    def up(v, a):
        return v + a

    a1, a2 = shin_add, shin_add + thigh_add
    d["shin"] = (d["shin"][0], d["shin"][1] + a1)
    d["knee"] = tuple(v + a1 for v in d["knee"])
    d["thigh"] = (d["thigh"][0] + a1, d["thigh"][1] + a2)
    for k in ("pelvis", "torso", "jaw", "snout", "eyes"):
        d[k] = tuple(up(v, a2) for v in d[k])
    for k in ("head_pivot", "top", "elbow_y", "wrist_y"):
        d[k] = d[k] + a2
    x, y, ang = d["shoulder"]
    d["shoulder"] = (x, y + a2, ang)
    for k in ("pad", "fore", "palm"):
        x0, x1, y0, y1, z = d[k]
        d[k] = (x0, x1, y0 + a2, y1 + a2, z)
    if d["buttons"]:
        b1, b2, bh = d["buttons"]
        d["buttons"] = (b1 + a2, b2 + a2, bh)
    if head_half:
        d["head_half"] = head_half
    return d


CH["spiral_bear"] = lengthen(CH["spiral_bear"], 1.0, 1.0, head_half=6.3)
CH["party_cat"] = lengthen(CH["party_cat"], 0.5, 0.5, head_half=7.0)
CH["rat"] = lengthen(CH["rat"], 0.8, 0.8, head_half=6.2)

# --------------------------------------------------------------------------
# Painters
# --------------------------------------------------------------------------


def p_chrome(ctx):
    """Polished piston: dark edges, mid grey, a bright vertical highlight and ring grooves."""
    H, W = ctx.X.shape
    u = (np.arange(W) + 0.5) / W
    prof = 60 + 120 * np.exp(-((u - 0.32) / 0.12) ** 2) + 50 * np.exp(-((u - 0.7) / 0.2) ** 2)
    if ctx.face in ("up", "down"):
        prof = np.full(W, 90.0)
    col = np.repeat(prof[None, :], H, axis=0)
    rows = (np.arange(H) % 4 == 0)[:, None] & np.ones((1, W), bool)
    col = np.where(rows, col * 0.55, col)
    ctx.rgb[...] = np.stack([col, col, col * 1.04], axis=-1)


def socket_painter(px, py):
    """Back wall of the eye sockets: black, with a faint pink glow right around each pupil."""

    def painter(ctx):
        ctx.paint("socket")
        if ctx.face != "north":
            return
        for sx in (px, -px):
            d = np.sqrt((ctx.X - sx) ** 2 + (ctx.Y - py) ** 2)
            ring = (d < 0.95) & (d >= 0.4)
            k = np.clip(1.0 - (d - 0.4) / 0.55, 0, 1)[..., None] ** 2
            g = np.array([210, 90, 150], np.float32)
            ctx.rgb[ring] = (ctx.rgb * (1 - k) + g * k * 0.5)[ring]
            ctx.emi[ring] = (g * k * 0.45)[ring]

    return painter


def p_pupil(ctx):
    """White ring with a dark centre, like the pictures."""
    c = ctx.cube
    cx, cy = (c.frm[0] + c.to[0]) / 2, (c.frm[1] + c.to[1]) / 2
    ctx.rgb[...] = np.array([255, 250, 252], np.float32)
    ctx.glow((170, 150, 162))
    if ctx.face == "north":
        dot = (np.abs(ctx.X - cx) < 0.16) & (np.abs(ctx.Y - cy) < 0.16)
        ctx.rgb[dot] = np.array([30, 10, 20], np.float32)
        ctx.emi[dot] = 0


def grid_painter(pattern, on_mat, off_mat, rim_mat, rim=0.7, faces=("north",)):
    """Paint `pattern` (rows of '1'/'0', top row first) inside a rim on the given faces."""
    P = np.array([[c == "1" for c in row] for row in pattern])
    n_r, n_c = P.shape

    def painter(ctx):
        ctx.paint(rim_mat)
        if ctx.face not in faces:
            return
        c = ctx.cube
        x0, x1 = c.frm[0] + rim, c.to[0] - rim
        y0, y1 = c.frm[1] + rim, c.to[1] - rim
        inside = (ctx.X > x0) & (ctx.X < x1) & (ctx.Y > y0) & (ctx.Y < y1)
        # column 0 is on the viewer's left when looking at the face from outside
        fx = (x1 - ctx.X) / (x1 - x0) if ctx.face == "north" else (ctx.X - x0) / (x1 - x0)
        fy = (y1 - ctx.Y) / (y1 - y0)
        ci = np.clip((fx * n_c).astype(int), 0, n_c - 1)
        ri = np.clip((fy * n_r).astype(int), 0, n_r - 1)
        on = inside & P[ri, ci]
        ctx.paint(off_mat, inside & ~on)
        ctx.paint(on_mat, on)

    return painter


SPIRAL = ["1111111", "0000001", "1111101", "1000101", "1011101", "1000001", "1111111"]
SPIRAL_MIRROR = [row[::-1] for row in SPIRAL]


def frame_painter(inner_mat, rim_mat, rim=0.9, faces=("north", "south")):
    def painter(ctx):
        ctx.paint(rim_mat)
        if ctx.face in faces:
            c = ctx.cube
            m = ((ctx.X > c.frm[0] + rim) & (ctx.X < c.to[0] - rim) & (ctx.Y > c.frm[1] + rim) & (ctx.Y < c.to[1] - rim))
            ctx.paint(inner_mat, m)

    return painter


def muzzle_painter(freckles, sn0):
    def painter(ctx):
        ctx.paint("muzzle")
        if ctx.face == "north":
            for fx, fy in freckles:
                for s in (1, -1):
                    dot = (np.abs(ctx.X - s * fx) < 0.3) & (np.abs(ctx.Y - (sn0 + fy)) < 0.3)
                    ctx.rgb[dot] = np.array([24, 18, 16], np.float32)

    return painter


def stripes_painter(a, b, width=1.1, slope=0.8):
    """Diagonal party-hat stripes."""

    def painter(ctx):
        ctx.paint(a)
        u = ctx.Y - slope * (ctx.X if ctx.face in ("north", "south", "up", "down") else ctx.Z)
        ctx.paint(b, (np.floor(u / width) % 2) == 0)

    return painter


def bands_painter(light, dark, z0, period, dark_frac):
    """Rings around a tail segment (measured along its length, model z)."""

    def painter(ctx):
        ctx.paint(light)
        ctx.paint(dark, ((ctx.Z - z0) % period) > period * (1 - dark_frac))

    return painter


def p_bell(ctx):
    ctx.paint("gold")
    if ctx.face == "north":
        c = ctx.cube
        cx = (c.frm[0] + c.to[0]) / 2
        slot = (np.abs(ctx.X - cx) < 0.2) & (ctx.Y < c.frm[1] + 1.0)
        hole = (np.abs(ctx.X - cx) < 0.4) & (np.abs(ctx.Y - (c.frm[1] + 1.0)) < 0.3)
        band = np.abs(ctx.Y - (c.frm[1] + 1.5)) < 0.12
        ctx.rgb[slot | hole] = np.array([30, 20, 8], np.float32)
        ctx.rgb[band] *= 0.6


def p_mic_head(ctx):
    ctx.paint("mic_grey")
    grid = (np.floor((ctx.X + ctx.Z) * 2.5) % 2 == 0) ^ (np.floor(ctx.Y * 2.5) % 2 == 0)
    ctx.rgb[grid] *= 0.8


def p_bowtie(ctx):
    ctx.paint("red")


# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------


def build_body(name):
    D = CH[name]
    bear, cat, rat = name == "spiral_bear", name == "party_cat", name == "rat"
    hd, hw = D["torso_d"], D["half_w"]
    bone("root", None, [0, 0, 0])

    # ---- legs -----------------------------------------------------------------------
    lc = D["leg_c"]
    for s, side in ((1, "right"), (-1, "left")):
        leg, shin, foot = f"{side}Leg", f"{side}Shin", f"{side}Foot"
        t0, t1 = D["thigh"]
        bone(leg, "root", [s * lc, t1 - 0.6, 0])
        cube(leg, "hip_piston", [lc - 1.4, t1 - 0.6, -1.4], [lc + 1.4, t1 + 0.8, 1.4], "chrome", s, painter=p_chrome)
        tw = D["thigh_w"] / 2
        cube(leg, "thigh", [lc - tw, t0, -tw], [lc + tw, t1, tw], "fur", s)
        k0, k1 = D["knee"]
        bone(shin, leg, [s * lc, (k0 + k1) / 2, 0])
        cube(shin, "knee_piston", [lc - 1.2, k0, -1.2], [lc + 1.2, k1, 1.2], "chrome", s, painter=p_chrome)
        cube(shin, "knee_collar", [lc - 1.5, k0, -1.5], [lc + 1.5, k0 + 0.45, 1.5], "black", s)
        s0, s1 = D["shin"]
        sw = D["shin_w"] / 2
        cube(shin, "shin", [lc - sw, s0, -sw], [lc + sw, s1, sw], "fur", s)
        a0, a1 = D["ankle"]
        bone(foot, shin, [s * lc, (a0 + a1) / 2, 0])
        cube(foot, "ankle_piston", [lc - 1.1, a0, -1.1], [lc + 1.1, a1, 1.1], "chrome", s, painter=p_chrome)
        fc, fh, so = lc + D["foot_off"], D["foot_hw"], D["sole"]
        cube(foot, "sole", [fc - fh - 0.1, 0, -7.8], [fc + fh + 0.1, so, 3.8], "sole", s)
        cube(foot, "heel", [fc - fh + 0.5, so, -3.9], [fc + fh - 0.5, D["heel_top"], 3.6], "fur", s)
        toe_w, gap = (2 * fh - 2 * 0.2) / 3, 0.2
        x = fc - fh
        for i in range(3):
            # each toe is two stacked blocks, the upper one set back
            cube(foot, f"toe{i + 1}", [x, so, -7.6], [x + toe_w, so + 1.7, -3.8], "fur", s)
            cube(foot, f"toe{i + 1}_top", [x + 0.15, so + 1.7, -6.9], [x + toe_w - 0.15, D["toe_top"], -3.8], "fur", s)
            x += toe_w + gap

    # ---- body -------------------------------------------------------------------------
    p0, p1 = D["pelvis"]
    bone("body", "root", [0, p0 + 0.8, 0])
    ph = D["pelvis_hw"]
    cube("body", "pelvis", [-ph, p0, -hd - (0.2 if cat else 0)], [ph, p1, hd + (0.2 if cat else 0)], "fur")
    c0, c1 = D["torso"]
    bone("torso", "body", [0, p1, 0])
    cube("torso", "waist_piston", [-hw + 1.0, p1 - 0.4, -hd + 1.2], [hw - 1.0, c0 + 0.3, hd - 1.2], "black")
    cube("torso", "chest", [-hw, c0, -hd], [hw, c1, hd], "fur")
    fz = -hd
    bx, b_bot, b_notch = D["belly"]
    cube("torso", "belly", [-bx, c0 + b_bot, fz - 0.25], [bx, c1 - b_notch, fz], "tan")
    cube("torso", "belly_top", [-bx + 1.0, c1 - b_notch, fz - 0.25], [bx - 1.0, c1 - b_notch + 0.9, fz], "tan")
    if D["buttons"]:
        y1, y2, bh = D["buttons"]
        for k, y in enumerate((y1, y2)):
            cube("torso", f"button{k + 1}", [-bh, y, fz - 0.6], [bh, y + 2 * bh, fz - 0.25], "black")
    if bear or rat:
        top_y = c1 - (0.6 if rat else 0.9)
        wing = 3.9 if rat else 3.6
        cube("torso", "bowtie_knot", [-0.8, top_y - 1.5, fz - 0.9], [0.8, top_y, fz], "red", painter=p_bowtie)
        for s in (1, -1):
            cube("torso", "bowtie_inner", [0.8, top_y - 1.7, fz - 0.7], [2.0, top_y + 0.2, fz], "red", s, painter=p_bowtie)
            cube("torso", "bowtie_wing", [2.0, top_y - 2.3, fz - 0.7], [wing, top_y + 0.7, fz], "red", s, painter=p_bowtie)
    if cat:
        cube("torso", "collar", [-4.4, c1 - 0.3, -4.6], [4.4, c1 + 0.9, 4.0], "red")
        bone("bell", "torso", [0, c1 - 0.2, fz - 1.0])
        cube("bell", "bell_loop", [-0.45, c1 - 0.9, fz - 1.5], [0.45, c1 - 0.1, fz - 0.7], "gold")
        cube("bell", "bell", [-1.25, c1 - 3.3, fz - 2.3], [1.25, c1 - 0.9, fz - 0.4], "gold", painter=p_bell)
        cube("bell", "bell_rim", [-1.45, c1 - 3.5, fz - 2.5], [1.45, c1 - 3.0, fz - 0.2], "gold")
    cube("torso", "neck_piston", [-1.8, c1, -1.8], [1.8, D["head_pivot"] + 0.6, 1.8], "chrome", painter=p_chrome)

    # ---- head -------------------------------------------------------------------------
    bone("head", "torso", [0, D["head_pivot"], 0])
    H, fz, back, top = D["head_half"], D["face_z"], D["back"], D["top"]
    e0, e1 = D["eyes"]
    sn0, sn1 = D["snout"]
    sx0, sx1 = D["socket"]
    px, py = (sx0 + sx1) / 2, (e0 + e1) / 2
    cube("head", "cranium", [-H, e1, fz], [H, top, back], "fur")
    cube("head", "eye_band", [-H, e0, fz + 0.6], [H, e1, back], "fur", painter=socket_painter(px, py))
    cube("head", "nose_bridge", [-sx0, e0, fz], [sx0, e1, fz + 0.6], "fur")
    for s in (1, -1):
        cube("head", "socket_side", [sx1, e0, fz], [H, e1, fz + 0.6], "fur", s)
        b0, b1, bt, slant = D["brow"]
        cube("head", "brow", [b0, e1 + 0.25, fz - 0.3], [b1, e1 + 0.25 + bt, fz], "black", s,
             rot=[0, 0, -slant] if slant else None, origin=[(b0 + b1) / 2, e1 + 0.5, fz] if slant else None)
    cube("head", "cheeks", [-H, D["jaw"][1], fz + 0.3], [H, e0, back - 0.2], "fur")
    sz, mh, seam = D["snout_z"], D["muzzle_hw"], D["seam"]
    if seam:
        for s in (1, -1):
            cube("head", "muzzle", [seam / 2, sn0, sz], [mh, sn1, fz + 0.3], "muzzle", s,
                 painter=muzzle_painter(D["freckles"], sn0))
    else:
        cube("head", "muzzle", [-mh, sn0, sz], [mh, sn1, fz + 0.3], "muzzle", painter=muzzle_painter(D["freckles"], sn0))
    nw, nh = D["nose"]
    cube("head", "nose", [-nw, sn1 - nh * 0.55, sz - 0.4], [nw, sn1 + nh * 0.45, sz + 1.2], "black")
    jh = D["jaw_hw"]
    j0, j1 = D["jaw"]
    cube("head", "mouth", [-jh + 0.4, j1 - 0.1, sz + 0.5], [jh - 0.4, sn0, back - 0.8], "socket")
    n_t, t_w, t_h = D["teeth"]
    step = 2 * (mh - 0.9) / (n_t - 1)
    for i in range(n_t):
        x = -(mh - 0.9) + i * step
        cube("head", f"tooth_upper{i + 1}", [x - t_w / 2, sn0 - t_h, sz + 0.3], [x + t_w / 2, sn0, sz + 1.0], "muzzle")
    bone("jaw", "head", [0, j1, 3.4], [-5, 0, 0])
    cube("jaw", "jaw", [-jh, j0, sz + 0.1], [jh, j1, 4.4], "muzzle",
         faces={"east": "fur", "west": "fur", "down": "fur", "south": "fur"})
    cube("jaw", "mouth_floor", [-jh + 0.6, j1, sz + 0.6], [jh - 0.6, j1 + 0.1, 3.8], "socket")
    for i in range(n_t - 1):
        x = -(mh - 0.9) + (i + 0.5) * step
        cube("jaw", f"tooth_lower{i + 1}", [x - t_w / 2, j1, sz + 0.3], [x + t_w / 2, j1 + t_h, sz + 1.0], "muzzle")
    if rat:
        # tongue hanging out of the left side of the mouth
        cube("jaw", "tongue", [-2.6, j1 - 0.1, sz - 1.4], [-0.7, j1 + 0.5, sz + 1.6], "tongue",
             rot=[-30, 0, 0], origin=[-1.6, j1, sz + 1.2])
    bone("eyes", "head", [0, py, fz + 0.6])
    for s in (1, -1):
        cube("eyes", "pupil", [px - 0.42, py - 0.42, fz + 0.48], [px + 0.42, py + 0.42, fz + 0.6], "glow", s, painter=p_pupil)

    # ears
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        if bear:
            bone(e, "head", [s * (H - 0.8), top - 0.6, 0.2], [0, 0, -s * 16])
            cube(e, "ear", [H - 2.6, top - 1.0, -0.8], [H + 3.6, top + 5.2, 1.2], "fur", s,
                 painter=grid_painter(SPIRAL if s > 0 else SPIRAL_MIRROR, "spiral_light", "spiral_dark", "fur",
                                      rim=0.8, faces=("north",)))
        elif cat:
            bone(e, "head", [s * (H - 1.4), top - 0.4, 0.2], [0, 0, -s * 8])
            cube(e, "ear", [H - 3.4, top - 0.8, -0.6], [H + 1.6, top + 4.2, 1.0], "fur", s,
                 painter=frame_painter("ear_dark", "fur", rim=1.0))
        else:
            bone(e, "head", [s * (H - 1.0), top - 0.2, 0.4], [0, 0, -s * 14])
            cube(e, "ear", [H - 2.6, top - 0.6, -0.4], [H + 4.6, top + 6.6, 1.2], "ear_dark", s,
                 painter=frame_painter("ear_red", "ear_dark", rim=0.9))

    if bear:
        # scruffy tuft of loose blocks on top, mostly on his right
        for k, (x0, z0, h, w) in enumerate(((1.0, -4.4, 1.8, 1.3), (2.5, -3.6, 3.0, 1.3), (4.0, -2.6, 2.2, 1.3),
                                           (-0.4, -3.0, 2.4, 1.3), (1.4, -1.8, 3.8, 1.3), (3.0, -0.6, 2.8, 1.3),
                                           (-2.0, -4.0, 1.4, 1.2), (4.6, -4.4, 1.4, 1.2), (2.0, 0.8, 1.8, 1.3),
                                           (0.2, -0.4, 1.6, 1.2), (-1.4, -1.6, 1.0, 1.1))):
            cube("head", f"tuft{k + 1}", [x0, top, z0], [x0 + w, top + h, z0 + w], "fur",
                 rot=[0, 0, -18 + 6 * (k % 3)], origin=[x0 + w / 2, top, z0 + w / 2])
        for k, (x0, y0, z0, rx, rz) in enumerate(((2.0, 3.6, -1.6, 10, -24), (3.6, 2.6, -3.0, -8, -30), (0.6, 3.0, -2.8, 6, -12))):
            cube("head", f"tuft_top{k + 1}", [x0, top + y0, z0], [x0 + 1.2, top + y0 + 1.2, z0 + 1.2], "fur",
                 rot=[rx, 0, rz], origin=[x0 + 0.6, top + y0, z0 + 0.6])
    if cat:
        bone("hat", "head", [2.8, top, -0.6], [-6, 0, -22])
        cube("hat", "hat_rim", [-0.4, top, -3.4], [6.0, top + 0.8, 2.2], "hat_red")
        for k in range(6):
            r = 2.7 - 0.4 * k
            y0 = top + 0.8 + 1.0 * k
            cube("hat", f"hat_tier{k + 1}", [2.8 - r, y0, -0.6 - r], [2.8 + r, y0 + 1.0, -0.6 + r], "hat_red",
                 painter=stripes_painter("hat_red", "hat_cream", 1.0, 0.9))
        py_ = top + 0.8 + 6.0
        cube("hat", "pompom", [1.8, py_ - 0.2, -1.6], [3.8, py_ + 1.8, 0.4], "pompom")
        for k, (dx, dy, dz) in enumerate(((-0.9, 0.6, 0), (0.9, 0.5, 0.2), (0, 0.6, -0.9), (0.1, 0.7, 0.9), (0, 1.5, 0))):
            cube("hat", f"pompom_puff{k + 1}", [2.8 + dx - 0.6, py_ + dy - 0.5, -0.6 + dz - 0.6],
                 [2.8 + dx + 0.6, py_ + dy + 0.7, -0.6 + dz + 0.6], "pompom")
    if rat:
        bone("hat", "head", [2.6, top, -0.4], [-4, 0, -20])
        cube("hat", "fez", [-1.1, top, -3.2], [5.1, top + 3.0, 2.4], "hat_red")
        cube("hat", "fez_lid", [-0.8, top + 3.0, -2.9], [4.8, top + 3.4, 2.1], "hat_red")
        cube("hat", "fez_band", [-1.2, top, -3.3], [5.2, top + 0.6, 2.5], "fur_dark")
        for s in (1, -1):
            for k, (y, ang) in enumerate(((sn0 + 2.2, 12), (sn0 + 1.4, 1), (sn0 + 0.6, -12))):
                cube("head", f"whisker{k + 1}", [mh - 0.2, y - 0.07, sz + 1.0], [mh + 7.0, y + 0.07, sz + 1.14], "whisker", s,
                     rot=[0, 8, ang], origin=[mh - 0.2, y, sz + 1.07])

    # ---- arms -----------------------------------------------------------------------
    shx, shy, sang = D["shoulder"]
    fl_base, fl_tip = D["finger"]
    for s, side in ((1, "right"), (-1, "left")):
        arm, fa, hand = f"{side}Arm", f"{side}Forearm", f"{side}Hand"
        bone(arm, "torso", [s * shx, shy, 0], [0, 0, s * sang])
        cube(arm, "shoulder_piston", [hw - 0.4, shy - 1.4, -1.3], [shx + 0.8, shy + 0.6, 1.3], "chrome", s, painter=p_chrome)
        x0, x1, y0, y1, z = D["pad"]
        cube(arm, "upper_arm", [x0, y0, -z], [x1, y1, z], "fur", s)
        ecx = (x0 + x1) / 2
        ey = D["elbow_y"]
        bone(fa, arm, [s * ecx, ey, 0])
        cube(fa, "elbow_piston", [ecx - 1.0, ey - 0.9, -1.0], [ecx + 1.0, ey + 0.9, 1.0], "chrome", s, painter=p_chrome)
        x0, x1, y0, y1, z = D["fore"]
        cube(fa, "forearm", [x0, y0, -z], [x1, y1, z], "fur", s)
        wy = D["wrist_y"]
        px0, px1, py0, py1, pz = D["palm"]
        hcx = (px0 + px1) / 2
        bone(hand, fa, [s * hcx, wy, 0])
        cube(hand, "wrist_piston", [hcx - 0.9, wy - 0.7, -0.9], [hcx + 0.9, wy + 0.6, 0.9], "chrome", s, painter=p_chrome)
        cube(hand, "palm", [px0, py0, -pz], [px1, py1, pz], "fur", s)
        fing = f"{side}Fingers"
        bone(fing, hand, [s * (hcx + 0.1), py0 + 0.2, 0])
        fw = (2 * pz - 3 * 0.2) / 4
        for i in range(4):
            z0 = -pz + i * (fw + 0.2)
            cube(fing, f"finger{i + 1}_base", [px0 + 0.3, py0 - fl_base, z0], [px1 - 0.4, py0 + 0.2, z0 + fw], "fur", s)
            cube(fing, f"finger{i + 1}_tip", [px0 - 0.4, py0 - fl_base - fl_tip + 0.6, z0], [px0 + 1.6, py0 - fl_base + 0.6, z0 + fw],
                 "fur", s)
        th = f"{side}Thumb"
        bone(th, hand, [s * (px0 + 0.7), py1 - 1.0, -pz])
        cube(th, "thumb_base", [px0 - 0.3, py0, -pz - 1.0], [px0 + 1.3, py1 - 1.0, -pz + 0.2], "fur", s)
        cube(th, "thumb_tip", [px0 - 0.6, py0 - 1.2, -pz - 0.9], [px0 + 1.0, py0 + 0.5, -pz + 0.1], "fur", s)

    if rat:
        m = mic_info(name)
        mx, my, mz = m["pivot"]
        bone("mic", "rightHand", m["pivot"], m["rot"])
        cube("mic", "mic_handle", [mx - 3.6, my - 0.5, mz - 0.5], [mx + 1.6, my + 0.5, mz + 0.5], "mic_handle")
        cube("mic", "mic_ring", [mx - 3.9, my - 0.7, mz - 0.7], [mx - 3.4, my + 0.7, mz + 0.7], "chrome", painter=p_chrome)
        cube("mic", "mic_head", [mx - 6.2, my - 1.2, mz - 1.2], [mx - 3.8, my + 1.2, mz + 1.2], "mic_grey", painter=p_mic_head)

    # ---- tails ------------------------------------------------------------------------
    if cat:
        seg = [(35, 55), (25, 25), (5, 15), (-30, 15), (-40, 10), (-35, 0)]
        build_tail("tail", (2.4, p0 + 1.0, hd), 3.0, 2.7, seg, bands=("tail_light", "tail_dark", 3.0, 0.42))
    if rat:
        # out past his left side, then arcing down toward the floor with a curl at the tip
        seg = [(-10, -75), (10, -10), (15, 0), (20, 0), (25, 0), (20, 5), (15, 5), (10, 10), (0, 15), (-25, 25)]
        build_tail("tail", (-2.0, p0 + 1.0, hd), 2.7, 1.1, seg, bands=("pink", "pink_dark", 0.9, 0.3), taper=0.05)


def build_tail(prefix, start, length, thick, rots, bands, taper=0.0):
    """Chain of segments pointing along +z from `start`, bent by per-segment (pitch, yaw)."""
    parent = "body"
    x, y, z = start
    for k, (rx, ry) in enumerate(rots):
        name = f"{prefix}{k}"
        bone(name, parent, [x, y, z], [rx, ry, 0])
        r = max(0.25, thick / 2 - taper * k * thick)
        light, dark, period, frac = bands
        cube(name, f"tail_seg{k + 1}", [x - r, y - r, z - 0.1], [x + r, y + r, z + length], light,
             painter=bands_painter(light, dark, z, period, frac))
        parent = name
        z += length


def mic_info(name="rat"):
    px0, px1, py0, py1, pz = CH[name]["palm"]
    grip = [(px0 + px1) / 2, py0 - 1.4, -0.4]
    pivot = [px0 + 0.9, grip[1], grip[2]]
    return dict(parent="rightHand", pivot=pivot, rot=[0, -55, 0], head=(pivot[0] - 5.0, pivot[1], pivot[2]), axis=(-1, 0, 0))


def tail_names(name):
    return [f"tail{k}" for k in range(6 if name == "party_cat" else 10)] if name in ("party_cat", "rat") else []


# --------------------------------------------------------------------------
# Animations
# --------------------------------------------------------------------------


class TrioNight(NightClips):
    def __init__(self, name):
        self.name = name
        self.D = D = CH[name]
        super().__init__(dict(
            mouth=(0.0, D["snout"][0] - 0.2, D["snout_z"] - 2.6), mouth_axis=(0, 0.45, 0.9),
            half_w=D["half_w"], torso=D["torso"], mic=mic_info(name) if name == "rat" else None,
            jaw_max=22.0, tail=tail_names(name)))

    def shared(self, *groups, step=0.5, move=0.2, phase=0.0):
        st = stepper(step, move, phase)
        return {g: st for g in groups}


class BearNight(TrioNight):
    IK_CLIPS = ("pose1", "performance2")

    def schedule(self, name, L):
        if name == "pose1":
            return {**self.shared("torso", "armR", step=0.5, move=0.2), "head": stepper(0.5, 0.15, 0.25),
                    "armL": stepper(1.0, 0.25, 0.5)}
        if name == "performance2":
            return {**self.shared("torso", "armR", "armL", step=0.5, move=0.18), "head": stepper(0.5, 0.15, 0.25)}
        return super().schedule(name, L)

    def pose1(self, t):
        """The picture: head tilted hard to his right, right arm out with the claw open."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 3.0, -8.0, 4.0)
        setr(p, "torso", 4.0 + 1.0 * sn(w), -6.0, 5.0)
        setr(p, "head", 6.0 + 1.5 * sn(w), 10.0, -22.0 + 2.0 * sn(w + 1.0))
        # upper arm angled down and out, forearm reaching outward at waist height, claw open
        goal = torso_goal((self.D["half_w"] + 10.0, 23.0 + 0.6 * sn(w), -5.0), fingers=(0.45, -0.55, -0.7),
                          elbow=(self.D["half_w"] + 5.5, 27.0, 1.0))
        self.arm_ik("pose1_right", p, "right", goal, [-20, 40, 30, -60, 0, 0, 0, 0, 0])
        setr(p, "leftArm", 6.0, 0, -4.0)
        setr(p, "leftForearm", -14.0, 0, 0)
        setr(p, "leftHand", 0, 0, -8.0)
        setr(p, "leftFingers", 0, 0, 22.0)
        self.fingers_open(p, 1.0, sides=("right",))
        setr(p, "rightLeg", -18.0, -6.0, 6.0)
        setr(p, "rightShin", 22.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 6.0, 4.0, -4.0)
        setr(p, "leftShin", 4.0, 0, 0)
        flat_foot(p, "left")
        setr(p, "jaw", 4.0, 0, 0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "head", 0, 0, -8.0 * window(t, 1.2, 1.45, 0.03))
        add_rot(p, "rightFingers", 0, 0, 10.0 * window(t, 0.5, 0.7, 0.03))

    def pose2(self, t):
        """Menacing: both claws up, head down, staring."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 8.0, 0, 0)
        setr(p, "torso", 6.0 + 1.5 * sn(w), 4.0 * sn(w), 0)
        setr(p, "head", 18.0, -6.0 * sn(w), 4.0 * sn(w * 2))
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -84.0 + 6.0 * sn(w + s), s * 18.0, s * 10.0)
            setr(p, f"{side}Forearm", -35.0, 0, 0)
            setr(p, f"{side}Hand", -20.0, 0, 0)
        self.fingers_open(p, 1.0)
        self.stance(p, 5.0, 8.0)
        setr(p, "jaw", 10.0, 0, 0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 14.0 * window(t, 0.8, 1.1, 0.04), 0, 0)

    def performance1(self, t):
        """Sings without a mic: slow sway, alternating open-palm gestures to the audience."""
        p = {}
        setr(p, "body", 1.0, 0, 2.5 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0, 4.0 * sn(TAU * t / 4.0), 1.5 * sn(TAU * t / 2.0))
        setr(p, "head", 3.0 + 2.0 * cs(TAU * t), 16.0 * sn(TAU * t / 4.0 + 0.5), -4.0 * sn(TAU * t / 2.0))
        for side, t0 in (("right", 0.2), ("left", 2.2)):
            s = S[side]
            g = ease((t - t0) / 0.4) * (1 - ease((t - t0 - 1.4) / 0.4))
            setr(p, f"{side}Arm", -40.0 * g - 2.0, 0, s * (4.0 + 26.0 * g))
            setr(p, f"{side}Forearm", -40.0 * g - 8.0, 0, 0)
            setr(p, f"{side}Hand", 0, s * 30.0 * g, 0)
            setr(p, f"{side}Fingers", 0, 0, s * 25.0 * g)
        self.stance(p, 4.0, 2.0 + 2.0 * (0.5 - 0.5 * cs(TAU * t)))
        self.ears(p, TAU * t / 2.0, 1.5)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG), 0, 0)

    def performance2(self, t):
        """Slow clap on every other beat, head bobbing."""
        p = {}
        setr(p, "body", 1.0, 0, 1.5 * sn(TAU * t / 2.0))
        setr(p, "torso", 3.0, 3.0 * sn(TAU * t / 4.0), 0)
        apart = 0.5 + 0.5 * cs(TAU * t)
        for side in ("right", "left"):
            s = S[side]
            goal = torso_goal((s * (1.1 + 3.4 * apart), 30.5, -10.0), normal=(s, 0, 0), fingers=(0, 0.75, -0.6),
                              elbow=(s * 11.5, 28.0, -4.0))
            self.arm_ik(f"perf2_{side}", p, side, goal, [-70, s * 20, 0, -60, 0, 0, 0, 0, 0])
        self.stance(p, 4.0, 2.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "head", 6.0 * window(t % 1.0, 0.0, 0.25, 0.04), 0, 0)
        add_rot(p, "jaw", 8.0 * window(t % 1.0, 0.05, 0.3, 0.04), 0, 0)


class CatNight(TrioNight):
    IK_CLIPS = ("pose1", "pose2", "performance1")

    def schedule(self, name, L):
        if name in ("pose1", "performance1"):
            return {**self.shared("torso", "armR", step=0.5, move=0.2), "head": stepper(0.5, 0.15, 0.25),
                    "armL": stepper(1.0, 0.25, 0.5), "tail": stepper(0.5, 0.15, 0.1)}
        if name == "pose2":
            return {**self.shared("torso", "armL", step=0.5, move=0.18), "head": stepper(1.0, 0.2, 0.25),
                    "armR": stepper(1.0, 0.2), "tail": stepper(0.5, 0.15)}
        return super().schedule(name, L)

    def bell_goal(self, ring=0.0):
        """Palm resting on the bell (just under the chin), fingers curled over it."""
        c1 = self.D["torso"][1]
        return torso_goal((0.8 + 0.4 * ring, c1 - 3.3, -self.D["torso_d"] - 2.4), normal=(0, 0, 1), fingers=(-0.7, -0.5, -0.5),
                          elbow=(11.0, 28.0, -3.0))

    def pose1(self, t):
        """The picture: head tilted to his right, right hand on the bell, tail curled out."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 1.0, -6.0, 2.0)
        setr(p, "torso", 2.0 + 1.0 * sn(w), -4.0, 3.0)
        setr(p, "head", -6.0, 8.0 + 3.0 * sn(w), -20.0 + 2.0 * sn(w))
        setr(p, "leftArm", -6.0, 0, -2.0)
        setr(p, "leftForearm", -18.0, 0, 0)
        setr(p, "leftFingers", 0, 0, 18.0)
        self.arm_ik("pose1_right", p, "right", self.bell_goal(), [-60, 30, 30, -90, 0, 0, 0, 0, 0])
        setr(p, "rightFingers", 0, 0, 12.0)
        self.stance(p, 4.0)
        self.tail(p, w, 6.0)
        setr(p, "hat", 0, 0, -3.0 * sn(w))
        setr(p, "jaw", 4.0, 0, 0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "bell", 0, 0, 12.0 * flip(t, 6) * window(t, 1.0, 1.4, 0.02))

    def pose2(self, t):
        """Waves hello with the left hand, head tilted the other way."""
        p = {}
        setr(p, "body", 0, 4.0, -2.0)
        setr(p, "torso", 1.0, 3.0, -3.0)
        setr(p, "head", 2.0, -8.0, 14.0)
        setr(p, "rightArm", -4.0, 0, 3.0)
        setr(p, "rightForearm", -12.0, 0, 0)
        sw = sn(TAU * t)
        goal = torso_goal((-(self.D["half_w"] + 6.5) - 1.6 * sw, self.D["head_pivot"] + 6.0, -4.0), normal=(0, 0, 1),
                          fingers=(math.sin(math.radians(16 * sw)), -math.cos(math.radians(16 * sw)), 0),
                          elbow=(-(self.D["half_w"] + 7.5), self.D["torso"][1] - 4.0, -1.0))
        self.arm_ik("pose2_left", p, "left", goal, [0, 0, -80, -10, 0, -70, 0, -80, 0])
        self.stance(p, 4.0)
        self.tail(p, TAU * t / 2.0, 12.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 6.0 * window(t, 0.2, 1.6, 0.06), 0, 0)

    def performance1(self, t):
        """Dances on the spot: hips swaying, ringing the bell, tail swishing, hat wobbling."""
        p = {}
        sway = sn(TAU * t / 2.0)
        setr(p, "body", 0, 6.0 * sway, 5.0 * sway)
        setr(p, "torso", 2.0, -4.0 * sway, -6.0 * sway)
        setr(p, "head", -4.0 + 3.0 * cs(TAU * t), 10.0 * sn(TAU * t / 4.0), 10.0 * sway - 6.0)
        setr(p, "hat", 0, 0, -6.0 * sway)
        self.arm_ik("perf1_right", p, "right", self.bell_goal(ring=sn(TAU * t)), [-60, 30, 30, -90, 0, 0, 0, 0, 0])
        g = ease((t - 1.0) / 0.4) * (1 - ease((t - 3.0) / 0.4))
        setr(p, "leftArm", -30.0 * g - 4.0, 0, -(6.0 + 50.0 * g))
        setr(p, "leftForearm", -30.0 * g - 10.0, 0, 0)
        setr(p, "leftHand", 0, -20.0 * g, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -4.0 - 6.0 * pos(s * sway), 0, s * 4.0)
            setr(p, f"{side}Shin", 8.0 + 12.0 * pos(s * sway), 0, 0)
            flat_foot(p, side)
        self.tail(p, TAU * t / 2.0 + 1.0, 16.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "bell", 0, 0, 14.0 * flip(t, 4))
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG) * 0.8, 0, 0)

    def performance2(self, t):
        """Party: both arms up waving side to side, head bobbing."""
        p = {}
        sw = sn(TAU * t / 1.0)
        setr(p, "body", 0, 0, 3.0 * sw)
        setr(p, "torso", -2.0, 4.0 * sw, 3.0 * sw)
        setr(p, "head", 2.0 + 4.0 * cs(TAU * t * 2), -8.0 * sw, 8.0 * sw)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -40.0, 0, s * (130.0 + 18.0 * sw * s))
            setr(p, f"{side}Forearm", -20.0, 0, 0)
            setr(p, f"{side}Hand", 0, 0, s * 10.0 * sw)
        self.fingers_open(p, 0.8)
        self.stance(p, 4.0, 2.0 + 3.0 * (0.5 - 0.5 * cs(TAU * t * 2)))
        self.tail(p, TAU * t, 18.0, lift=-10.0)
        setr(p, "hat", 0, 0, 8.0 * sw)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 10.0 * window(t % 0.5, 0.0, 0.2, 0.03), 0, 0)
        add_rot(p, "bell", 0, 0, 10.0 * flip(t, 4))


class RatNight(TrioNight):
    IK_CLIPS = ("pose1", "pose2", "performance1", "performance2")

    def schedule(self, name, L):
        if name in ("pose1", "performance1"):
            return {**self.shared("torso", "head", "armR", "armL", step=0.5, move=0.2), "tail": stepper(0.5, 0.15, 0.2)}
        if name in ("pose2", "performance2"):
            return {**self.shared("torso", "armR", "armL", step=0.5, move=0.2), "head": stepper(0.5, 0.15, 0.25),
                    "tail": stepper(0.5, 0.15, 0.2)}
        return super().schedule(name, L)

    def pose1(self, t):
        """The picture: mic at his mouth, other hand on the hip, head cocked."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 0, -6.0, 3.0)
        setr(p, "torso", 2.0 + 1.0 * sn(w), -4.0, 4.0)
        setr(p, "head", 4.0, 6.0 + 4.0 * sn(w), -16.0 + 2.0 * sn(w))
        self.arm_ik("pose1_right", p, "right", self.mouth_goal(), [-120, 20, 20, -70, 0, 0, 0, 0, 0],
                    effector=self.mic_effector())
        self.arm_ik("pose1_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        setr(p, "rightLeg", -6.0, -6.0, 8.0)
        setr(p, "rightShin", 6.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 4.0, 6.0, -6.0)
        setr(p, "leftShin", 4.0, 0, 0)
        flat_foot(p, "left")
        self.tail(p, w, 6.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "jaw", 6.0 * window(t, 0.6, 0.9, 0.04) + 4.0 * window(t, 1.3, 1.5, 0.04), 0, 0)

    def pose2(self, t):
        """Arms open to the audience, mic out to the side."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 0, 0, 0)
        setr(p, "torso", -2.0, 4.0 * sn(w), 0)
        setr(p, "head", -6.0, -8.0 * sn(w), 10.0)
        for side in ("right", "left"):
            s = S[side]
            goal = torso_goal((s * (self.D["half_w"] + 12.0), 31.0 + 1.0 * sn(w), -6.0), normal=(0, 1, 0) if s < 0 else None,
                              fingers=(s * 0.6, -0.3, -0.7), elbow=(s * (self.D["half_w"] + 6.0), 30.0, -2.0))
            self.arm_ik(f"pose2_{side}", p, side, goal, [-40, 0, s * 60, -20, 0, 0, 0, 0, 0],
                        effector=self.mic_effector() if s > 0 else None)
        self.stance(p, 5.0)
        self.tail(p, w, 12.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 10.0 * window(t, 0.3, 0.6, 0.04) + 8.0 * window(t, 0.75, 1.0, 0.04), 0, 0)

    def performance1(self, t):
        """Sings into the mic with his hand on his hip, swaying."""
        p = {}
        setr(p, "body", 0, -4.0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0, 5.0 * sn(TAU * t / 4.0), 2.0 * sn(TAU * t / 2.0))
        setr(p, "head", 3.0 + 3.0 * cs(TAU * t), 12.0 * sn(TAU * t / 4.0 + 0.5), -10.0 + 4.0 * sn(TAU * t / 2.0))
        self.arm_ik("perf1_right", p, "right", self.mouth_goal(), [-120, 20, 20, -70, 0, 0, 0, 0, 0],
                    effector=self.mic_effector())
        self.arm_ik("perf1_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        setr(p, "rightLeg", -4.0, 0, 4.0)
        setr(p, "rightShin", 6.0, 0, 0)
        flat_foot(p, "right", toe=-14.0 * pos(sn(TAU * t)))
        setr(p, "leftLeg", -2.0, 0, -4.0)
        setr(p, "leftShin", 4.0, 0, 0)
        flat_foot(p, "left")
        self.tail(p, TAU * t / 2.0, 10.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG), 0, 0)

    def performance2(self, t):
        """Holds the mic out to the crowd, then brings it back for the chorus."""
        p = {}
        m = ease((t - 0.3) / 0.4) * (1 - ease((t - 2.2) / 0.4))
        setr(p, "body", 0, -6.0 * m, 2.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0 - 4.0 * m, -6.0 * m, 0)
        setr(p, "head", 2.0 - 8.0 * m + 3.0 * cs(TAU * t), 8.0 * sn(TAU * t / 4.0), -8.0 + 10.0 * m)
        mouth = self.mouth_goal()
        crowd = torso_goal((5.0, 33.0, -18.0), axis=(0, 0.2, -1), elbow=(12.0, 29.0, -6.0))

        def goal(mats):
            a, b = mouth(mats), crowd(mats)
            ax = a["axis"] * (1 - m) + b["axis"] * m
            return {"point": a["point"] * (1 - m) + b["point"] * m, "axis": ax / np.linalg.norm(ax),
                    "elbow": a["elbow"] * (1 - m) + b["elbow"] * m}

        goal.bones = ("head",)
        self.arm_ik("perf2_right", p, "right", goal, [-120, 20, 20, -70, 0, 0, 0, 0, 0], effector=self.mic_effector())
        self.arm_ik("perf2_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        self.stance(p, 4.0, 2.0 + 2.0 * (0.5 - 0.5 * cs(TAU * t)))
        self.tail(p, TAU * t / 2.0, 12.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG if not 0.6 < t0 < 2.4), 0, 0)


# same lyric rhythm as Freddy's song (start, end, degrees)
FREDDY_SONG = [(0.0, 0.2, 10), (0.25, 0.45, 7), (0.5, 0.85, 12), (1.0, 1.2, 8), (1.25, 1.45, 10), (1.5, 1.95, 13),
               (2.5, 2.7, 9), (2.75, 2.95, 7), (3.0, 3.35, 12), (3.5, 3.9, 10)]

CLIPS = {"spiral_bear": BearNight, "party_cat": CatNight, "rat": RatNight}


def spec(name):
    D = CH[name]
    px0, px1, py0, py1, pz = D["palm"]
    return export.Character(
        model_id=name,
        entity_id=f"fnaf:{name}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", name),
        materials=MATERIALS[name],
        build_geometry=lambda: build_body(name),
        build_anims=lambda: CLIPS[name](name).build(name),
        sources=[os.path.abspath(__file__), os.path.join(HERE, "night.py"), name],
        spawn_egg={"spiral_bear": ("#7a3020", "#c08860"), "party_cat": ("#c07a2c", "#a01c22"),
                   "rat": ("#4e4a4c", "#a02024")}[name],
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=((px0 + px1) / 2, (py0 + py1) / 2, 0.0),
                 chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                            y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(5, 5, 2.5),
        atlas_width=1024,
        tpu=4,
    )
