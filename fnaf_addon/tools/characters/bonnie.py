"""Bonnie: geometry, texture painting and animations.

Built from the "BONNIE - Minecraft-style FNAF character model" reference sheet.
"""
import math
import os

import numpy as np

from fnafkit import export
from fnafkit.anim import (TAU, S, bone_goal, cs, flat_foot, ground, make_clip, pos, setp, setr, sets, sn,
                          solve_arm, torso_goal)
from fnafkit.rig import bone, cube

# --------------------------------------------------------------------------
# Materials (albedo tones sampled from the reference palette)
# --------------------------------------------------------------------------

MATERIALS = {
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


def build_geometry():
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
# Animations
# --------------------------------------------------------------------------


def hide_banjo(p):
    sets(p, "banjo", 0)


def performance_eyes(p):
    sets(p, "eyesNormal", 0)
    setp(p, "eyesPerformance", 0, 0, -0.4)



# --------------------------------------------------------------------------
# clips
# --------------------------------------------------------------------------


def idle(t):
    L = 4.0
    w = TAU * t / L
    p = {}
    hide_banjo(p)
    setr(p, "body", 0, 0, 0)
    setr(p, "torso", 1.2 * sn(w), 0, 0)
    setp(p, "torso", 0, 0.12 * sn(w), 0)
    setr(p, "head", 2.0 * sn(w + 0.6), 7.0 * sn(w * 0.5 + 0.4) , 1.5 * sn(w * 0.5))
    setr(p, "jaw", 1.5 + 1.5 * sn(w * 2), 0, 0)
    for side in ("right", "left"):
        s = S[side]
        ph = 0 if s > 0 else 0.7
        setr(p, f"{side}Arm", 2.0 * sn(w + ph), 0, s * (1.0 + 1.2 * sn(w + ph)))
        setr(p, f"{side}Forearm", -5.0 - 2.0 * sn(w + ph), 0, 0)
        setr(p, f"{side}Hand", 0, 0, s * 2.0 * sn(w + ph + 0.5))
        setr(p, f"{side}Fingers", 4.0 * sn(w * 0.5 + ph), 0, 0)
        setr(p, f"{side}Leg", 0, 0, s * 1.0)
        setr(p, f"{side}Shin", 0, 0, 0)
        flat_foot(p, side)
        setr(p, f"{side}Ear", -2.0 * sn(w + ph), 0, s * 1.5 * sn(w * 2 + ph))
        setr(p, f"{side}EarTip", -3.0 * sn(w * 2 + ph + 1.0), 0, 0)
    ground(p)
    return p


def walk(t):
    L = 1.25
    f = TAU * t / L
    p = {}
    hide_banjo(p)
    for side in ("right", "left"):
        s = S[side]
        ph = f if s > 0 else f + math.pi
        th = -24.0 * sn(ph)
        bend = 6.0 + 34.0 * pos(cs(ph + 0.35)) ** 1.4
        setr(p, f"{side}Leg", th, 0, s * 1.0)
        setr(p, f"{side}Shin", bend, 0, 0)
        flat_foot(p, side, toe=-10.0 * sn(ph))
        setr(p, f"{side}Arm", 18.0 * sn(ph), 0, s * (1.5 + 1.5 * pos(-sn(ph))))
        setr(p, f"{side}Forearm", -10.0 - 10.0 * pos(-sn(ph)), 0, 0)
        setr(p, f"{side}Hand", 4.0 * sn(ph - 0.6), 0, 0)
        setr(p, f"{side}Ear", 3.0 * sn(2 * f - 1.0), 0, s * 2.0 * cs(f))
        setr(p, f"{side}EarUpper", 2.0 * sn(2 * f - 1.4), 0, 0)
        setr(p, f"{side}EarTip", 5.0 * sn(2 * f - 1.8), 0, 0)
    setr(p, "body", 0, -5.0 * sn(f), 3.0 * cs(f))
    setp(p, "body", 0.4 * cs(f), 0, 0)
    setr(p, "torso", 2.0, 10.0 * sn(f), -1.5 * cs(f))
    setr(p, "head", 2.0 + 2.0 * cs(2 * f), -6.0 * sn(f), -2.0 * cs(f))
    setr(p, "jaw", 2.0, 0, 0)
    ground(p)
    return p


def run(t):
    L = 0.75
    f = TAU * t / L
    p = {}
    hide_banjo(p)
    for side in ("right", "left"):
        s = S[side]
        ph = f if s > 0 else f + math.pi
        th = -12.0 - 42.0 * sn(ph)
        bend = 16.0 + 84.0 * pos(cs(ph + 0.45)) ** 1.2
        setr(p, f"{side}Leg", th, 0, s * 2.0)
        setr(p, f"{side}Shin", bend, 0, 0)
        flat_foot(p, side, toe=-14.0 * sn(ph) + 6.0)
        setr(p, f"{side}Arm", 50.0 * sn(ph) - 8.0, 0, s * 6.0)
        setr(p, f"{side}Forearm", -78.0 + 14.0 * sn(ph), 0, 0)
        setr(p, f"{side}Hand", 6.0 * sn(ph), 0, 0)
        setr(p, f"{side}Fingers", 15.0, 0, 0)
        setr(p, f"{side}Ear", 14.0 + 6.0 * sn(2 * f - 1.2), 0, s * 3.0 * cs(f))
        setr(p, f"{side}EarUpper", 6.0 + 4.0 * sn(2 * f - 1.6), 0, 0)
        setr(p, f"{side}EarTip", 8.0 + 8.0 * sn(2 * f - 2.0), 0, 0)
    setr(p, "body", 12.0, -6.0 * sn(f), 2.0 * cs(f))
    setr(p, "torso", 4.0, 12.0 * sn(f), 0)
    setr(p, "head", -14.0 + 3.0 * cs(2 * f), -8.0 * sn(f), 0)
    setr(p, "jaw", 6.0, 0, 0)
    ground(p, extra=1.2 * pos(sn(2 * f + 0.9)))
    return p


def wave_pose(t):
    L = 2.0
    w = TAU * t / L
    p = {}
    hide_banjo(p)
    setr(p, "torso", 0, -4.0, -2.0)
    setr(p, "head", 3.0 * sn(w * 2), 8.0, -6.0 + 2.0 * sn(w))
    setr(p, "jaw", 4.0 + 4.0 * pos(sn(w * 2)), 0, 0)
    # left arm relaxed
    setr(p, "leftArm", -4.0, 0, -2.0)
    setr(p, "leftForearm", -14.0, 0, 0)
    setr(p, "leftHand", 0, 0, -4.0)
    for side in ("right", "left"):
        s = S[side]
        setr(p, f"{side}Leg", 0, 0, s * 1.5)
        flat_foot(p, side)
    setr(p, "rightEar", 0, 0, -6.0 + 4.0 * sn(w * 2))
    setr(p, "rightEarTip", 6.0 * sn(w * 2 + 1.0), 0, 0)
    setr(p, "leftEar", 0, 0, 3.0 * sn(w * 2 + 0.5))
    # right hand waves beside the head, palm toward the viewer
    swing = sn(w * 2)
    ang = math.radians(16.0 * swing)
    goal = torso_goal((12.5 + 1.6 * swing, 41.0, -4.0), normal=(0, 0, 1),
                      fingers=(-math.sin(ang), -math.cos(ang), 0), elbow=(13.5, 30.0, -1.0))
    x0 = wave_pose.last or [0, 0, 80, -10, 0, 70, 0, 80, 0]
    wave_pose.last, _ = solve_arm(p, "right", goal, x0, restarts=1 if wave_pose.last else 6)
    setr(p, "rightFingers", -10.0, 0, 0)
    setr(p, "rightThumb", 0, 0, 20.0)
    ground(p)
    return p


wave_pose.last = None


def cool_pose(t):
    L = 2.0
    w = TAU * t / L
    p = {}
    hide_banjo(p)
    setr(p, "body", 0, 8.0, -6.0)
    setp(p, "body", -0.6, 0, 0)
    setr(p, "torso", -2.0 + 1.0 * sn(w), -6.0, 9.0)
    setr(p, "head", -4.0 + 1.5 * sn(w + 0.5), 10.0, -14.0)
    setr(p, "jaw", 3.0, 0, 0)
    # right leg kicked out to the side, heel down
    setr(p, "rightLeg", -14.0, -10.0, 18.0)
    setr(p, "rightShin", 4.0, 0, 0)
    flat_foot(p, "right", toe=-14.0)
    setr(p, "leftLeg", 3.0, 6.0, -2.0)
    setr(p, "leftShin", 2.0, 0, 0)
    flat_foot(p, "left")
    # loose right arm
    setr(p, "rightArm", -12.0 + 1.5 * sn(w), 0, 4.0)
    setr(p, "rightForearm", -28.0, 0, 6.0)
    setr(p, "rightHand", 0, 0, 8.0)
    setr(p, "rightFingers", 10.0, 0, 0)
    # floppy ear like the sheet
    setr(p, "rightEar", 0, 0, -22.0)
    setr(p, "rightEarUpper", 0, 0, -38.0)
    setr(p, "rightEarTip", -10.0 + 4.0 * sn(w), 0, -28.0)
    setr(p, "leftEar", 0, 0, -18.0)
    setr(p, "leftEarUpper", 0, 0, -10.0)
    setr(p, "leftEarTip", 10.0, 0, -30.0)
    # left hand on the hip, elbow out
    goal = torso_goal((-6.6, 21.5, -0.5), normal=(1, 0, 0), fingers=(0, -0.35, -1), elbow=(-13.0, 26.5, 1.5))
    x0 = cool_pose.last or [10, 0, -40, -70, 0, 0, 0, 0, 0]
    cool_pose.last, _ = solve_arm(p, "left", goal, x0, restarts=1 if cool_pose.last else 6)
    ground(p)
    return p


cool_pose.last = None


def performance(t, energetic=False):
    """Bonnie plays the banjo.  4 beats per 2 s loop (120 BPM), strumming in eighths."""
    L = 2.0
    beat = TAU * t / 0.5
    w = TAU * t / L
    p = {}
    performance_eyes(p)
    st = performance.state.setdefault(energetic, {})
    if not energetic:
        dip = 0.5 - 0.5 * cs(beat)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -8.0 - 6.0 * dip, s * 6.0, s * 9.0)
            setr(p, f"{side}Shin", 14.0 + 12.0 * dip, 0, 0)
            flat_foot(p, side)
        setr(p, "body", 2.0, 0, 2.5 * sn(beat / 2))
        setr(p, "torso", 2.0, 5.0 * sn(w), 2.0 * sn(beat / 2))
        setr(p, "head", 4.0 + 7.0 * dip, 8.0 * sn(w + 0.4), -5.0 * sn(beat / 2))
        setr(p, "jaw", 9.0 * pos(sn(beat - 0.6)), 0, 0)
        setr(p, "banjo", 0, 0, 0)
        strum = cs(beat * 2)
        chord = -12.0 if (t % 2.0) < 1.0 else -10.0
        ears = 1.0
    else:
        dip = 0.5 - 0.5 * cs(beat)
        setr(p, "rightLeg", 2.0, 10.0, 16.0)
        setr(p, "rightShin", 4.0, 0, 0)
        flat_foot(p, "right", toe=-16.0 * pos(sn(beat)))
        setr(p, "leftLeg", -22.0 - 5.0 * dip, -10.0, -8.0)
        setr(p, "leftShin", 30.0 + 10.0 * dip, 0, 0)
        flat_foot(p, "left")
        setr(p, "body", -5.0, -6.0, 4.0 + 2.0 * sn(beat / 2))
        setr(p, "torso", -5.0 + 2.0 * dip, -4.0 + 5.0 * sn(w), 3.0 * sn(beat / 2))
        setr(p, "head", 2.0 + 12.0 * dip, -6.0 + 6.0 * sn(w), 10.0 + 3.0 * sn(beat / 2))
        setr(p, "jaw", 12.0 * pos(sn(beat - 0.5)), 0, 0)
        setr(p, "banjo", 4.0 * sn(beat / 2), 0, -10.0 - 4.0 * sn(w))
        strum = cs(beat * 2)
        chord = (-12.5, -10.0, -11.0, -9.0)[int((t % 2.0) // 0.5)]
        ears = 1.8
    for side in ("right", "left"):
        s = S[side]
        ph = 0.0 if s > 0 else 0.5
        setr(p, f"{side}Ear", 4.0 * ears * cs(beat + 1.0 + ph), 0, s * 2.0 * ears * sn(beat / 2))
        setr(p, f"{side}EarUpper", 3.0 * ears * cs(beat + 0.6 + ph), 0, 0)
        setr(p, f"{side}EarTip", 6.0 * ears * cs(beat + 0.2 + ph), 0, 0)
    # strumming hand over the strings near the neck joint
    swing = 1.3 if energetic else 1.0
    g_r = banjo_goal((0.5 + 0.3 * strum, 0.3 * swing * strum, -2.05),
                     local_normal=(0, 0, 1), local_fingers=(0.35, -1.0, 0.0), elbow=(10.5, 26.0, -1.0))
    x0 = st.get("right") or [-35, 25, 15, -55, 10, 0, 20, -20, 10]
    st["right"], _ = solve_arm(p, "right", g_r, x0, restarts=1 if st.get("right") else 8)
    setr(p, "rightFingers", 18.0 + 6.0 * strum, 0, 0)
    # fretting hand under the neck, palm up toward the fingerboard
    slide = st.get("chord", chord)
    slide += (chord - slide) * 0.55
    st["chord"] = slide
    g_l = banjo_goal((slide, -2.15, -0.1), local_normal=(0, 1, 0), local_fingers=(0.25, 0.1, -1.0),
                     elbow=(-11.0, 24.0, -3.0))
    x0 = st.get("left") or [-60, -30, -20, -60, 0, 0, 30, 40, 0]
    st["left"], _ = solve_arm(p, "left", g_l, x0, restarts=1 if st.get("left") else 8)
    setr(p, "leftFingers", 25.0 + 8.0 * sn(beat), 0, 0)
    setr(p, "leftThumb", 0, 0, -15.0)
    ground(p)
    return p


performance.state = {}


def build_anims():
    wave_pose.last = None
    cool_pose.last = None
    performance.state = {}
    # key times all land on Blockbench's 24 fps snapping grid
    make_clip("animation.bonnie.idle", 4.0, idle, 16)
    make_clip("animation.bonnie.walk", 1.25, walk, 15)
    make_clip("animation.bonnie.run", 0.75, run, 18)
    make_clip("animation.bonnie.pose1", 2.0, wave_pose, 16)
    make_clip("animation.bonnie.pose2", 2.0, cool_pose, 8)
    make_clip("animation.bonnie.performance1", 2.0, lambda t: performance(t, False), 48)
    make_clip("animation.bonnie.performance2", 2.0, lambda t: performance(t, True), 48)


def banjo_goal(local_point, local_normal=None, local_fingers=None, elbow=None):
    """IK goal on the banjo, in the banjo's local frame (drum centre = origin)."""
    P = BANJO_PIVOT
    return bone_goal("banjo", (local_point[0] + P[0], local_point[1] + P[1], local_point[2] + P[2]),
                     normal=local_normal, fingers=local_fingers, elbow=elbow)


SPEC = export.Character(
    model_id="bonnie",
    entity_id="fnaf:bonnie",
    out_dir=os.path.join(export.TOOLS_DIR, "..", "bonnie"),
    materials=MATERIALS,
    build_geometry=build_geometry,
    build_anims=build_anims,
    sources=[os.path.abspath(__file__)],
    spawn_egg=("#3a3d6b", "#8e2a2c"),
    arm=dict(palm=(7.875, 17.0, 0.0), chest=dict(half_x=7.0, z=(-5.5, 5.0), y=(19.0, 34.0))),
)
