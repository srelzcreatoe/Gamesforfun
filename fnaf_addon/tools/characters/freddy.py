"""Freddy Fazbear in two versions: Withered Freddy and Classic Freddy.

Withered follows the first reference (rusty, torn holes showing the endoskeleton,
jaw hanging open, glowing blue eyes).  Classic follows the second reference
(clean fur, freckled muzzle, grey joints, microphone), except that its brows are
the withered model's flat, relaxed ones instead of the angry slanted pair.
"""
import math
import os

import numpy as np

from characters.night import NightClips, ease, lerp, window
from fnafkit import export
from fnafkit.anim import S, TAU, bone_goal, cs, flat_foot, pos, setp, setr, sn, torso_goal
from fnafkit.rig import bone, cube, hash01
from fnafkit.servo import add_rot, meta, stepper

# --------------------------------------------------------------------------
# Materials (sampled from the references)
# --------------------------------------------------------------------------

SHARED = {
    "hat": dict(tones=[(26, 26, 26), (32, 32, 32), (38, 38, 38), (45, 45, 45), (52, 52, 52)], w=[1, 2, 3, 2, 1], spots=[]),
    "black": dict(tones=[(24, 24, 24), (30, 30, 30), (36, 36, 36), (42, 42, 42)], w=[1, 2, 2, 1], spots=[]),
    "teeth": dict(tones=[(208, 208, 206), (222, 222, 220), (232, 232, 230), (242, 242, 240)], w=[1, 2, 2, 1], spots=[]),
    "mouth_dark": dict(tones=[(20, 18, 18), (27, 24, 23), (34, 30, 28)], w=[1, 2, 1], spots=[]),
    "endo_metal": dict(tones=[(84, 84, 88), (100, 100, 103), (116, 116, 119), (132, 132, 134)], w=[1, 2, 2, 1],
                       spots=[((70, 56, 46), 0.04)]),
    "mic_grey": dict(tones=[(118, 118, 122), (134, 134, 137), (150, 150, 152), (166, 166, 168)], w=[1, 2, 2, 1], spots=[]),
    "mic_handle": dict(tones=[(28, 28, 30), (36, 36, 38), (44, 44, 46)], w=[1, 2, 1], spots=[]),
}

WITHERED_MATS = {
    **SHARED,
    "fur": dict(
        tones=[(98, 50, 24), (112, 58, 28), (126, 66, 32), (138, 72, 36), (150, 80, 40), (165, 90, 46)],
        w=[1, 2, 3, 3, 2, 1],
        spots=[((58, 33, 18), 0.06), ((176, 98, 52), 0.04), ((80, 44, 22), 0.05)],
        grime=(1.1, 0.78, 0.62),
    ),
    "fur_dark": dict(tones=[(48, 26, 14), (58, 31, 16), (68, 36, 19)], w=[1, 2, 1], spots=[]),
    "tan": dict(
        tones=[(160, 108, 68), (175, 122, 80), (188, 134, 90), (199, 145, 100), (210, 158, 112)],
        w=[1, 2, 3, 2, 1],
        spots=[((128, 84, 50), 0.07), ((104, 68, 40), 0.04)],
        grime=(1.0, 0.8, 0.7),
    ),
    "joint": dict(tones=[(16, 12, 10), (22, 17, 14), (28, 22, 18), (36, 28, 23)], w=[1, 2, 2, 1], spots=[]),
}

CLASSIC_MATS = {
    **SHARED,
    "fur": dict(
        tones=[(110, 55, 30), (118, 60, 32), (125, 64, 34), (132, 68, 37), (140, 73, 40), (148, 78, 43)],
        w=[1, 2, 3, 3, 2, 1],
        spots=[((100, 50, 28), 0.03), ((156, 83, 46), 0.02)],
    ),
    "fur_dark": dict(tones=[(56, 28, 15), (64, 32, 17), (72, 37, 20)], w=[1, 2, 1], spots=[]),
    "tan": dict(
        tones=[(186, 132, 88), (194, 140, 94), (201, 147, 100), (208, 154, 106), (216, 162, 114)],
        w=[1, 2, 3, 2, 1],
        spots=[((176, 122, 80), 0.03)],
    ),
    "ear_dark": dict(tones=[(60, 31, 17), (68, 36, 20), (76, 41, 23)], w=[1, 2, 1], spots=[]),
    "sole": dict(tones=[(200, 152, 104), (210, 162, 112), (218, 170, 120)], w=[1, 2, 1], spots=[]),
    "joint": dict(tones=[(62, 62, 66), (72, 72, 76), (82, 82, 86), (94, 94, 98), (106, 106, 110)], w=[1, 2, 3, 2, 1],
                  spots=[]),
}

# --------------------------------------------------------------------------
# Dimensions (model pixels) measured from each reference
# --------------------------------------------------------------------------

DIMS = {
    "withered": dict(
        leg_c=3.4, foot_off=0.6, toe_top=3.0, heel_top=4.9, sole=0.0,
        ankle=(4.6, 5.7), shin=(5.4, 12.2), knee=(11.9, 13.3), thigh=(13.0, 20.3), limb_w=(5.9, 6.2),
        pelvis=(19.8, 22.8), torso=(22.9, 34.1), half_w=5.85, torso_d=4.25,
        belly=(4.3, 23.1, 30.5, 31.2), neck=(33.6, 35.4),
        head_pivot=34.6, jaw=(35.0, 36.9), snout=(37.6, 40.4), eyes=(40.6, 42.8), head_top=46.0,
        face_z=-4.5, snout_z=-7.0, head_half=5.0, cheek_half=5.2, snout_half=3.7,
        socket=(0.6, 3.4), brow=(43.15, 43.9),
        shoulder=(6.6, 32.4, 9), pad=(5.4, 10.2, 31.9, 34.6, 3.0), upper=(5.9, 10.8, 25.9, 32.4, 2.6),
        elbow_y=25.6, fore=(5.7, 11.1, 20.9, 25.3, 2.7), wrist_y=20.6, palm=(6.6, 10.2, 17.2, 20.4, 2.6),
        hat=(3.2, 46.0, 47.2, 2.3, 50.8), ear=(5.6, 47.6, 4.0, 3.0),
    ),
    "classic": dict(
        leg_c=3.3, foot_off=0.5, toe_top=3.3, heel_top=4.1, sole=0.8,
        ankle=(3.9, 5.0), shin=(4.7, 11.4), knee=(11.1, 12.9), thigh=(12.7, 18.8), limb_w=(6.0, 6.0),
        pelvis=(18.6, 21.6), torso=(21.8, 34.2), half_w=6.0, torso_d=4.5,
        belly=(4.1, 22.0, 30.0, 30.75), neck=(33.8, 35.6),
        head_pivot=35.2, jaw=(35.0, 36.8), snout=(36.9, 39.8), eyes=(39.8, 42.0), head_top=44.75,
        face_z=-4.6, snout_z=-7.0, head_half=5.0, cheek_half=5.5, snout_half=4.25,
        socket=(0.7, 3.1), brow=(42.35, 43.1),
        shoulder=(6.9, 32.8, 6), pad=(5.6, 9.8, 32.2, 34.6, 3.0), upper=(6.0, 11.4, 26.8, 32.8, 2.8),
        elbow_y=26.2, fore=(6.0, 11.4, 19.7, 25.7, 2.8), wrist_y=19.4, palm=(7.0, 10.4, 16.0, 19.0, 2.6),
        hat=(2.3, 44.75, 45.75, 1.5, 48.3), ear=(5.4, 44.7, 4.2, 4.2),
    ),
}

# torn holes in the withered suit: (centre, radii, seed); left-side ones are mirrored in x already
HOLES = {
    "rightArm": [((9.4, 29.6, -2.4), (2.4, 2.2, 2.4), 1)],
    "rightForearm": [((9.9, 23.1, -2.5), (2.1, 1.8, 2.1), 2)],
    "rightLeg": [((5.2, 18.1, -2.9), (2.2, 1.9, 2.2), 3), ((2.6, 14.6, -2.9), (1.6, 1.3, 1.6), 4)],
    "rightShin": [((4.5, 10.3, -2.75), (2.0, 1.8, 2.0), 5)],
    "leftArm": [((-9.0, 28.4, -2.4), (2.2, 2.3, 2.2), 6)],
    "leftForearm": [((-9.6, 23.0, -2.5), (2.1, 1.9, 2.1), 7)],
    "leftLeg": [((-2.7, 14.9, -2.9), (2.0, 1.7, 2.0), 8)],
    "leftShin": [((-3.5, 9.0, -2.75), (2.1, 2.3, 2.1), 9)],
}

# --------------------------------------------------------------------------
# Painters
# --------------------------------------------------------------------------


def holes_painter(holes):
    """Fur torn open: dark cavity, grey endoskeleton bars, red wires and a frayed light rim."""

    def painter(ctx):
        ctx.paint(ctx.cube.faces.get(ctx.face, ctx.cube.mat))
        X, Y, Z = ctx.X, ctx.Y, ctx.Z
        across_x = ctx.face in ("north", "south", "up", "down")
        u = X if across_x else Z
        for (cx, cy, cz), (rx, ry, rz), seed in holes:
            uc = cx if across_x else cz
            d = np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 + ((Z - cz) / rz) ** 2)
            jag = hash01(np.floor(X * 2 + 999), np.floor(Y * 2 + 999), np.floor(Z * 2 + 999), seed) * 0.5
            dd = d + jag - 0.25
            inside = dd < 1.0
            rim = (dd >= 1.0) & (dd < 1.4)
            if not inside.any() and not rim.any():
                continue
            cav = np.array([22, 18, 17], np.float32) * (0.85 + 0.3 * ctx.rng.random(X.shape + (1,)))
            ctx.rgb[inside] = cav[inside]
            gy, gu = np.floor((Y - cy) * 3 + 0.5) % 4, np.floor((u - uc) * 3 + 0.5) % 5
            bars = inside & ((gy == 0) | (gu == 0)) & (dd < 0.95)
            metal = np.array([136, 136, 138], np.float32) * (0.88 + 0.2 * ctx.rng.random(X.shape + (1,)))
            ctx.rgb[bars] = metal[bars]
            ctx.rgb[bars & ((gy == 0) & (gu != 0)) & (np.floor((u - uc) * 3) % 2 == 0)] *= 0.82
            wires = inside & ~bars & (gu == 2) & (ctx.rng.random(X.shape) < 0.6)
            ctx.rgb[wires] = np.array([138, 30, 24], np.float32)
            # shadow under the upper lip of the tear
            shade = inside & (Y > cy + ry * 0.35)
            ctx.rgb[shade] *= 0.55
            torn = rim & (ctx.rng.random(X.shape) < 0.75)
            fray = np.array([178, 162, 138], np.float32) * (0.7 + 0.4 * ctx.rng.random(X.shape + (1,)))
            ctx.rgb[torn] = fray[torn]
            ctx.rgb[rim & ~torn] *= 0.55

    return painter


def eyes_socket_painter(glow_rgb, sx, sy):
    """Back wall of the eye sockets (black), optionally with a glow around each iris."""

    def painter(ctx):
        if ctx.face != "north":
            ctx.paint(ctx.cube.mat)
            return
        ctx.paint("black")
        ctx.rgb *= 0.6
        if glow_rgb is None:
            return
        for x in (sx, -sx):
            dist = np.maximum(np.abs(ctx.X - x), np.abs(ctx.Y - sy))
            ring = (dist < 1.4) & (dist >= 0.6)
            k = np.clip(1.0 - (dist - 0.6) / 0.8, 0, 1)[..., None]
            g = np.array(glow_rgb, np.float32)
            ctx.rgb[ring] = (ctx.rgb * (1 - k) + g * k * 0.6)[ring]
            ctx.emi[ring] = (g * k * 0.7)[ring]

    return painter


def p_withered_iris(ctx):
    """3x3 glowing iris: light blue ring, darker blue centre."""
    c = ctx.cube
    cx, cy = (c.frm[0] + c.to[0]) / 2, (c.frm[1] + c.to[1]) / 2
    ring = np.array([140, 206, 242], np.float32)
    ctx.rgb[...] = ring
    ctx.glow((52, 112, 150))
    if ctx.face == "north":
        centre = (np.abs(ctx.X - cx) < 0.26) & (np.abs(ctx.Y - cy) < 0.26)
        ctx.rgb[centre] = np.array([30, 104, 196], np.float32)
        ctx.emi[centre] = np.array([12, 50, 120], np.float32)
        hi = (ctx.X < cx - 0.26) & (ctx.Y > cy + 0.26)
        ctx.rgb[hi] = np.array([232, 246, 255], np.float32)
        ctx.emi[hi] = np.array([110, 140, 160], np.float32)


def p_classic_eye(ctx):
    """White eye with a blue iris (2x2 texels) and a darker pupil texel."""
    c = ctx.cube
    ctx.rgb[...] = np.array([236, 236, 234], np.float32)
    if ctx.face != "north":
        return
    ix = (c.frm[0] + c.to[0]) / 2
    iy = (c.frm[1] + c.to[1]) / 2 - 0.1
    iris = (np.abs(ctx.X - ix) < 0.5) & (np.abs(ctx.Y - iy) < 0.5)
    ctx.rgb[iris] = np.array([38, 92, 204], np.float32)
    pupil = iris & (ctx.Y > iy) & (np.sign(ctx.X - ix) == -np.sign(ix))
    ctx.rgb[pupil] = np.array([16, 40, 112], np.float32)


def p_freckled_muzzle(ctx):
    ctx.paint("tan")
    if ctx.face == "north":
        seam = np.abs(ctx.X) < 0.25
        ctx.rgb[seam] *= 0.62
        for fx, fy in ((1.9, 38.9), (2.9, 38.9), (2.4, 38.0)):
            for s in (1, -1):
                dot = (np.abs(ctx.X - s * fx) < 0.26) & (np.abs(ctx.Y - fy) < 0.26)
                ctx.rgb[dot] = np.array([96, 54, 30], np.float32)
        low = ctx.Y < ctx.cube.frm[1] + 0.5
        ctx.rgb[low] *= 0.9


def p_snout(ctx):
    ctx.paint("tan")
    if ctx.face == "north":
        low = ctx.Y < ctx.cube.frm[1] + 0.5
        ctx.rgb[low] *= 0.85


def p_jaw_seam(ctx):
    ctx.paint("fur")
    if ctx.face == "north":
        ctx.rgb[np.abs(ctx.X) < 0.25] *= 0.55


def p_mouth_line(ctx):
    """Closed mouth: dark line with a row of small grey teeth."""
    ctx.paint("mouth_dark")
    if ctx.face == "north":
        teeth = (np.floor((ctx.X + 10) * 2) % 2 == 0) & (np.abs(ctx.X) > 0.4)
        ctx.rgb[teeth] = np.array([120, 118, 114], np.float32)


def ear_frame_painter(inner_mat, border):
    """Square ear with a recessed-looking inner patch on front and back."""

    def painter(ctx):
        ctx.paint("fur")
        if ctx.face in ("north", "south"):
            c = ctx.cube
            m = (
                (ctx.X > c.frm[0] + border) & (ctx.X < c.to[0] - border)
                & (ctx.Y > c.frm[1] + border) & (ctx.Y < c.to[1] - border)
            )
            ctx.paint(inner_mat, m)
            edge = m & ((ctx.Y > c.to[1] - border - 0.5) | (ctx.X < c.frm[0] + border + 0.5))
            ctx.rgb[edge] *= 0.75

    return painter


def p_bowtie(ctx):
    ctx.paint("black")
    if ctx.face == "north":
        c = ctx.cube
        fold = (np.abs(ctx.Y - (c.frm[1] + c.to[1]) / 2) < 0.25) & (ctx.rng.random(ctx.X.shape) < 0.6)
        ctx.rgb[fold] *= 0.7
        edge = (ctx.Y < c.frm[1] + 0.5) | (ctx.Y > c.to[1] - 0.5)
        ctx.rgb[edge] *= 1.25


def p_joint_ridges(ctx):
    ctx.paint("joint")
    ridge = (np.floor(ctx.Y * 2) % 2 == 0)
    if ctx.face in ("up", "down"):
        ridge = (np.floor((ctx.X + ctx.Z) * 2) % 3 == 0)
    ctx.rgb[ridge] *= 0.8


def p_neck_bars(ctx):
    ctx.paint("joint")
    u = ctx.X if ctx.face in ("north", "south") else ctx.Z
    ctx.rgb[np.floor(u * 2) % 2 == 0] *= 0.65


def p_mic_head(ctx):
    ctx.paint("mic_grey")
    grid = (np.floor((ctx.X + ctx.Z) * 2) % 2 == 0) ^ (np.floor(ctx.Y * 2) % 2 == 0)
    ctx.rgb[grid] *= 0.78


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------


def mic_info(variant):
    """Where the microphone lives, its head centre and its handle->head axis (mic-bone coordinates)."""
    D = DIMS[variant]
    px0, px1, py0, py1, pz = D["palm"]
    grip = [(px0 + px1) / 2, py0 - 1.4, -0.4]        # through the curled fingers
    if variant == "withered":
        x0, x1, y0, y1, z = D["fore"]
        pivot = [(x0 + x1) / 2, (y0 + y1) / 2, 0]
        # Stored lengthwise inside the forearm.  performance1 turns it like Classic's (35 deg about y)
        # and slides it so the middle of the handle (1.6 behind the pivot) sits in the fist.
        a = math.radians(35)
        handle = (1.6 * math.sin(a), 0.0, 1.6 * math.cos(a))
        d = [grip[i] - handle[i] - pivot[i] for i in range(3)]
        return dict(parent="rightForearm", pivot=pivot, rot=[0, 0, 0], head=(pivot[0], pivot[1], pivot[2] - 1.25),
                    axis=(0, 0, -1), grip_offset=[-d[0], d[1], d[2]], grip_rot=[0, -35, 0])
    pivot = [px0 + 0.9, grip[1], grip[2]]
    return dict(parent="rightHand", pivot=pivot, rot=[0, -55, 0], head=(pivot[0] - 4.7, pivot[1], pivot[2]), axis=(-1, 0, 0))


def build_geometry(variant):
    D = DIMS[variant]
    withered = variant == "withered"
    hd = D["torso_d"]

    def fur_painter(bone_name):
        return holes_painter(HOLES[bone_name]) if withered and bone_name in HOLES else None

    joint_p = None if withered else p_joint_ridges

    bone("root", None, [0, 0, 0])

    # ---- legs -----------------------------------------------------------------
    lc = D["leg_c"]
    lw, tw = D["limb_w"]
    for s, side in ((1, "right"), (-1, "left")):
        leg, shin, foot = f"{side}Leg", f"{side}Shin", f"{side}Foot"
        t0, t1 = D["thigh"]
        bone(leg, "root", [s * lc, t1, 0])
        cube(leg, "hip_joint", [lc - 1.5, t1 - 0.7, -1.5], [lc + 1.5, t1 + 0.7, 1.5], "joint", s, painter=joint_p)
        cube(leg, "thigh", [lc - tw / 2, t0, -tw / 2], [lc + tw / 2, t1, tw / 2], "fur", s, painter=fur_painter(leg))
        k0, k1 = D["knee"]
        s0, s1 = D["shin"]
        bone(shin, leg, [s * lc, (k0 + k1) / 2, 0])
        cube(shin, "knee_joint", [lc - 1.8, k0, -1.8], [lc + 1.8, k1, 1.8], "joint", s, painter=joint_p)
        cube(shin, "knee_hinge", [lc - 2.4 - (0.5 if not withered else 0), k0 + 0.25, -1.0],
             [lc + 2.4 + (0.5 if not withered else 0), k1 - 0.25, 1.0], "joint", s, painter=joint_p)
        cube(shin, "shin", [lc - lw / 2, s0, -lw / 2], [lc + lw / 2, s1, lw / 2], "fur", s, painter=fur_painter(shin))
        a0, a1 = D["ankle"]
        bone(foot, shin, [s * lc, (a0 + a1) / 2, 0])
        cube(foot, "ankle_joint", [lc - 1.5, a0, -1.5], [lc + 1.5, a1, 1.5], "joint", s, painter=joint_p)
        fc, sole = lc + D["foot_off"], D["sole"]
        if sole:
            cube(foot, "sole", [fc - 3.55, 0, -6.6], [fc + 3.55, sole, 3.6], "sole", s)
        hx = 3.5 if withered else 3.2
        cube(foot, "heel", [fc - hx, sole, -3.6], [fc + hx, D["heel_top"], 3.5], "fur", s)
        toe_w = 2.6 if withered else 2.25
        gap = 0.15
        x = fc - (3 * toe_w + 2 * gap) / 2
        for i in range(3):
            cube(foot, f"toe{i + 1}", [x, sole, -7.0 if withered else -6.6], [x + toe_w, D["toe_top"], -3.4], "fur", s)
            x += toe_w + gap

    # ---- body -----------------------------------------------------------------
    p0, p1 = D["pelvis"]
    hw = D["half_w"]
    bone("body", "root", [0, p0 + 0.7, 0])
    cube("body", "pelvis", [-hw, p0, -hd + 0.25], [hw, p1, hd - 0.25], "fur")

    c0, c1 = D["torso"]
    bone("torso", "body", [0, p1, 0])
    cube("torso", "waist_joint", [-4.1, p1 - 0.5, -3.1], [4.1, c0 + 0.3, 3.1], "joint", painter=joint_p)
    cube("torso", "chest", [-hw, c0, -hd], [hw, c1, hd], "fur")
    bx, b0, b1, b2 = D["belly"]
    fz = -hd
    cube("torso", "belly", [-bx, b0, fz - 0.25], [bx, b1, fz], "tan")
    cube("torso", "belly_top", [-(bx - 0.7), b1, fz - 0.25], [bx - 0.7, b2, fz], "tan")
    if withered:
        cube("torso", "button_top", [-0.6, 29.75, fz - 0.7], [0.6, 30.95, fz - 0.25], "black")
        cube("torso", "button_low", [-0.6, 27.9, fz - 0.7], [0.6, 29.1, fz - 0.25], "black")
        bt = dict(knot=(0.7, 31.4, 32.8, 0.75), inner=(0.7, 1.6, 31.55, 32.65), outer=(1.6, 3.0, 31.15, 33.05), z=0.5)
    else:
        bt = dict(knot=(0.85, 31.25, 32.85, 1.05), inner=(0.85, 1.9, 31.0, 33.1), outer=(1.9, 3.4, 30.45, 33.6), z=0.75)
    kx, ky0, ky1, kz = bt["knot"]
    cube("torso", "bowtie_knot", [-kx, ky0, fz - kz], [kx, ky1, fz], "black", painter=p_bowtie)
    for s in (1, -1):
        x0, x1, y0, y1 = bt["inner"]
        cube("torso", "bowtie_inner", [x0, y0, fz - bt["z"]], [x1, y1, fz], "black", s, painter=p_bowtie)
        x0, x1, y0, y1 = bt["outer"]
        cube("torso", "bowtie_wing", [x0, y0, fz - bt["z"]], [x1, y1, fz], "black", s, painter=p_bowtie)
    n0, n1 = D["neck"]
    cube("torso", "neck", [-1.9, n0, -1.9], [1.9, n1, 1.9], "joint", painter=joint_p if withered else p_neck_bars)

    # ---- head -----------------------------------------------------------------
    hp = D["head_pivot"]
    bone("head", "torso", [0, hp, 0])
    H = D["head_half"]
    j0, j1 = D["jaw"]
    sn0, sn1 = D["snout"]
    e0, e1 = D["eyes"]
    top = D["head_top"]
    fz = D["face_z"]
    back = 4.75 if withered else 4.6
    sx0, sx1 = D["socket"]
    eye_cx, eye_cy = (sx0 + sx1) / 2, (e0 + e1) / 2
    cube("head", "cranium", [-H, e1, fz], [H, top, back], "fur")
    glow = (90, 170, 230) if withered else None
    cube("head", "cranium_eyes", [-H, e0, fz + 0.5], [H, e1, back], "fur", painter=eyes_socket_painter(glow, eye_cx, eye_cy))
    cube("head", "nose_bridge", [-sx0, e0, fz], [sx0, e1, fz + 0.5], "fur", faces={"east": "fur_dark", "west": "fur_dark"})
    for s in (1, -1):
        cube("head", "socket_side", [sx1, e0, fz], [H, e1, fz + 0.5], "fur", s, faces={"west": "fur_dark"})
        b0, b1 = D["brow"]
        cube("head", "brow", [sx0 + 0.05, b0, fz - 0.35], [sx1 - 0.05, b1, fz], "black", s)
    ch = D["cheek_half"]
    cube("head", "cheeks", [-ch, sn0, fz - (0.25 if withered else 0)], [ch, e0, back], "fur")
    sh = D["snout_half"]
    sz = D["snout_z"]
    if withered:
        for s in (1, -1):
            cube("head", "snout", [0.12, sn0, sz], [sh, sn1, fz - 0.25], "tan", s, painter=p_snout)
        cube("head", "snout_groove", [-0.12, sn0, sz + 0.2], [0.12, sn1 - 0.2, fz - 0.25], "mouth_dark")
    else:
        cube("head", "muzzle", [-sh, sn0, sz], [sh, sn1, fz], "tan", painter=p_freckled_muzzle)
    cube("head", "nose", [-1.35 if withered else -1.3, sn1 - 0.95, sz - 0.4], [1.35 if withered else 1.3, sn1 + 0.3, sz + 0.45], "black")

    # mouth and jaw
    if withered:
        cube("head", "mouth_roof", [-4.4, 36.9, -6.0], [4.4, sn0, 4.0], "mouth_dark")
        cube("head", "endo_skull", [-3.2, 35.0, -3.5], [3.2, 37.0, 2.0], "endo_metal")
        for i in range(7):
            x = -3.45 + i * 1.15
            cube("head", f"tooth_upper{i + 1}", [x - 0.4, 36.65, sz + 0.3], [x + 0.4, sn0, sz + 1.05], "teeth")
        for s in (1, -1):
            for k, z in enumerate((-5.4, -4.3, -3.2)):
                cube("head", f"tooth_upper_side{k + 1}", [3.65, 36.7, z], [4.35, sn0, z + 0.7], "teeth", s)
        bone("jaw", "head", [0, 37.0, 3.6], [-24, 0, 0])
        cube("jaw", "jaw", [-4.7, j0 - 0.4, -7.0], [4.7, j1, 4.0], "fur")
        cube("jaw", "mouth_floor", [-4.1, j1, -6.4], [4.1, j1 + 0.2, 3.5], "mouth_dark")
        for i in range(7):
            x = -3.45 + i * 1.15
            cube("jaw", f"tooth_lower{i + 1}", [x - 0.4, j1, -6.8], [x + 0.4, j1 + 0.9, -6.05], "teeth")
        for s in (1, -1):
            for k, z in enumerate((-5.5, -4.4, -3.3)):
                cube("jaw", f"tooth_lower_side{k + 1}", [3.75, j1, z], [4.45, j1 + 0.85, z + 0.7], "teeth", s)
    else:
        cube("head", "mouth_line", [-4.25, j1 - 0.1, -6.25], [4.25, sn0 + 0.1, 3.5], "mouth_dark", painter=p_mouth_line)
        bone("jaw", "head", [0, j1, 3.6])
        cube("jaw", "jaw", [-4.4, j0, -6.3], [4.4, j1, 4.0], "fur", painter=p_jaw_seam)
        cube("jaw", "mouth_floor", [-3.9, j1, -5.6], [3.9, j1 + 0.15, 3.5], "mouth_dark")
        for i in range(8):
            x = -3.5 + i
            cube("jaw", f"tooth_lower{i + 1}", [x - 0.38, j1 - 0.6, -6.05], [x + 0.38, j1 + 0.05, -5.4], "teeth")

    # eyes
    bone("eyes", "head", [0, eye_cy, fz + 0.5])
    for s in (1, -1):
        if withered:
            cube("eyes", "iris", [eye_cx - 0.75, eye_cy - 0.75, fz + 0.38], [eye_cx + 0.75, eye_cy + 0.75, fz + 0.5],
                 "teeth", s, painter=p_withered_iris)
        else:
            cube("eyes", "eye", [sx0 + 0.2, e0 + 0.2, fz + 0.4], [sx1 - 0.2, e1 - 0.2, fz + 0.5], "teeth", s,
                 painter=p_classic_eye)

    # ears
    ex, ey, ew, eh = D["ear"]
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        bone(e, "head", [s * (H - 0.2), top - 0.6, 0.0])
        if withered:
            cube(e, "ear", [ex - ew / 2, ey - eh / 2, -0.6], [ex + ew / 2, ey + eh / 2, 1.2], "fur", s)
            cube(e, "ear_round", [ex - eh / 2, ey - ew / 2, -0.6], [ex + eh / 2, ey + ew / 2, 1.2], "fur", s)
            cube(e, "ear_inner", [ex - 1.15, ey - 1.15, -0.85], [ex + 1.15, ey + 1.15, -0.6], "tan", s)
        else:
            cube(e, "ear", [ex - ew / 2, ey - eh / 2 + 0.4, -0.6], [ex + ew / 2, ey + eh / 2 + 0.4, 1.15], "fur", s,
                 painter=ear_frame_painter("ear_dark", 0.9))

    # hat
    bx, by0, by1, cx, cy1 = D["hat"]
    bone("hat", "head", [0, top, 0.25])
    cube("hat", "brim", [-bx, by0, 0.25 - bx * 0.92], [bx, by1, 0.25 + bx], "hat")
    cube("hat", "crown", [-cx, by1, 0.25 - cx * 0.9], [cx, cy1, 0.25 + cx], "hat")

    # ---- arms -----------------------------------------------------------------
    shx, shy, sang = D["shoulder"]
    for s, side in ((1, "right"), (-1, "left")):
        arm, fa, hand = f"{side}Arm", f"{side}Forearm", f"{side}Hand"
        bone(arm, "torso", [s * shx, shy, 0], [0, 0, s * sang])
        cube(arm, "shoulder_joint", [hw - 0.35, shy - 1.2, -1.3], [shx + 0.8, shy + 0.8, 1.3], "joint", s, painter=joint_p)
        x0, x1, y0, y1, z = D["pad"]
        cube(arm, "shoulder_pad", [x0, y0, -z], [x1, y1, z], "fur", s)
        x0, x1, y0, y1, z = D["upper"]
        cube(arm, "upper_arm", [x0, y0, -z], [x1, y1, z], "fur", s, painter=fur_painter(arm))
        ecx = (x0 + x1) / 2
        ey_ = D["elbow_y"]
        bone(fa, arm, [s * ecx, ey_, 0])
        cube(fa, "elbow_joint", [ecx - 1.2, ey_ - 0.75, -1.4], [ecx + 1.2, ey_ + 0.75, 1.4], "joint", s, painter=joint_p)
        cube(fa, "elbow_hinge", [ecx - 1.6, ey_ - 0.45, -0.85], [ecx + 1.6, ey_ + 0.45, 0.85], "joint", s, painter=joint_p)
        x0, x1, y0, y1, z = D["fore"]
        cube(fa, "forearm", [x0, y0, -z], [x1, y1, z], "fur", s, painter=fur_painter(fa))
        wy = D["wrist_y"]
        px0, px1, py0, py1, pz = D["palm"]
        hcx = (px0 + px1) / 2
        bone(hand, fa, [s * hcx, wy, 0])
        cube(hand, "wrist_joint", [hcx - 0.9, wy - 0.55, -1.15], [hcx + 0.9, wy + 0.55, 1.15], "joint", s, painter=joint_p)
        cube(hand, "palm", [px0, py0, -pz], [px1, py1, pz], "fur", s)
        fing = f"{side}Fingers"
        bone(fing, hand, [s * (hcx + 0.1), py0 + 0.2, 0])
        fw = (2 * pz - 3 * 0.2) / 4
        for i in range(4):
            z0 = -pz + i * (fw + 0.2)
            cube(fing, f"finger{i + 1}_base", [px0 + 0.3, py0 - 2.0, z0], [px1 - 0.5, py0 + 0.2, z0 + fw], "fur", s)
            cube(fing, f"finger{i + 1}_tip", [px0 - 0.4, py0 - 3.0, z0], [px0 + 1.5, py0 - 1.4, z0 + fw], "fur", s)
        th = f"{side}Thumb"
        bone(th, hand, [s * (px0 + 0.7), py1 - 1.0, -pz])
        cube(th, "thumb_base", [px0 - 0.3, py0, -pz - 1.0], [px0 + 1.2, py1 - 1.0, -pz + 0.2], "fur", s)
        cube(th, "thumb_tip", [px0 - 0.6, py0 - 1.2, -pz - 0.9], [px0 + 0.9, py0 + 0.5, -pz + 0.1], "fur", s)

    # ---- microphone -------------------------------------------------------------
    # Classic: held in the right fist like the reference.  Withered: tucked inside the
    # right forearm (the reference has no mic); the performances slide it into the hand.
    m = mic_info(variant)
    pivot = m["pivot"]
    bone("mic", m["parent"], pivot, m["rot"])
    mx_, my_, mz_ = pivot
    if withered:
        # stored lengthwise (along z) inside the forearm
        cube("mic", "mic_handle", [mx_ - 0.5, my_ - 0.5, mz_ - 0.2], [mx_ + 0.5, my_ + 0.5, mz_ + 2.6], "mic_handle")
        cube("mic", "mic_head", [mx_ - 1.15, my_ - 1.15, mz_ - 2.4], [mx_ + 1.15, my_ + 1.15, mz_ - 0.1], "mic_grey", painter=p_mic_head)
    else:
        # along -x from the fist toward the body, head at the inner end
        cube("mic", "mic_handle", [mx_ - 3.6, my_ - 0.5, mz_ - 0.5], [mx_ + 1.6, my_ + 0.5, mz_ + 0.5], "mic_handle")
        cube("mic", "mic_head", [mx_ - 5.9, my_ - 1.1, mz_ - 1.1], [mx_ - 3.5, my_ + 1.1, mz_ + 1.1], "mic_grey", painter=p_mic_head)
        cube("mic", "mic_head_cap", [mx_ - 6.2, my_ - 0.7, mz_ - 0.7], [mx_ - 5.8, my_ + 0.7, mz_ + 0.7], "mic_grey", painter=p_mic_head)
        cube("mic", "mic_head_ring", [mx_ - 5.6, my_ - 1.3, mz_ - 0.7], [mx_ - 3.8, my_ + 1.3, mz_ + 0.7], "mic_grey", painter=p_mic_head)
        cube("mic", "mic_head_ring2", [mx_ - 5.6, my_ - 0.7, mz_ - 1.3], [mx_ - 3.8, my_ + 0.7, mz_ + 1.3], "mic_grey", painter=p_mic_head)


# --------------------------------------------------------------------------
# Animations
# --------------------------------------------------------------------------


class FreddyNight(NightClips):
    """Freddy's own clips on top of the shared night set.

    Classic is the calm lead singer from the show stage: he stands his ground, holds the
    mic steady, sways a little and turns his head across the audience in servo steps.
    Withered runs the same show, slower and broken: tilted head, hanging jaw, stalls.
    """

    def __init__(self, variant):
        D = DIMS[variant]
        withered = variant == "withered"
        super().__init__(dict(
            mouth=(0.0, D["snout"][0] - 0.2, D["snout_z"] - 2.4),
            mouth_axis=(0, 0.9, 0.45) if withered else (0, 0.45, 0.9),
            half_w=D["half_w"], torso=D["torso"], mic=mic_info(variant),
            jaw_max=26.0 if withered else 42.0, withered=withered))
        self.D = D
        self.IK_CLIPS = ("performance1", "performance2") if withered else ("pose1", "pose2", "performance1", "performance2")

    # lyric rhythm for the singing jaw: (start, end, degrees)
    SONG = [(0.0, 0.2, 10), (0.25, 0.45, 7), (0.5, 0.85, 12), (1.0, 1.2, 8), (1.25, 1.45, 10), (1.5, 1.95, 13),
            (2.5, 2.7, 9), (2.75, 2.95, 7), (3.0, 3.35, 12), (3.5, 3.9, 10)]

    def sing(self, p, t, scale=1.0):
        add_rot(p, "jaw", scale * sum(a * window(t, t0, t1, 0.04) for t0, t1, a in self.SONG), 0, 0)

    def schedule(self, name, L):
        if name == "pose1" and not self.w:
            up = stepper(0.5, 0.2)
            return {"torso": up, "head": up, "armL": up, "armR": stepper(1.0, 0.2, 0.5)}
        if name == "pose2" and not self.w:
            body = stepper(1.0, 0.25)
            return {"torso": body, "armR": body, "armL": body, "head": stepper(0.5, 0.15, 0.2)}
        if name == "performance1":
            body = stepper(0.5, 0.25 if self.w else 0.22)
            return {"torso": body, "head": body, "armR": body,
                    "armL": stepper(1.0, 0.3, 0.4) if self.w else stepper(0.5, 0.2, 0.25)}
        if name == "performance2":
            body = stepper(0.5, 0.25 if self.w else 0.2)
            return {"torso": body, "armR": body, "armL": body, "head": stepper(0.5, 0.18, 0.25)}
        return super().schedule(name, L)

    # ---- poses ---------------------------------------------------------------------------
    def pose1(self, t):
        w = TAU * t / 2.0
        p = {}
        if self.w:
            # powered-down slump, head lolling, jaw hanging wide
            setr(p, "body", 6.0, 6.0, -4.0)
            setr(p, "torso", 10.0 + 1.0 * sn(w), -4.0, -5.0)
            setr(p, "head", 26.0 + 2.0 * sn(w), 8.0, 14.0 + 1.5 * sn(w + 0.5))
            setr(p, "jaw", 16.0 + 2.0 * sn(w), 0, 0)
            setr(p, "rightArm", 14.0, 0, -6.0)
            setr(p, "rightForearm", -6.0, 0, 0)
            setr(p, "rightHand", 10.0, 0, 0)
            setr(p, "leftArm", 8.0, 0, 6.0)
            setr(p, "leftForearm", -10.0, 0, 0)
            setr(p, "leftHand", 6.0, 0, -6.0)
            for side in ("right", "left"):
                s = S[side]
                setr(p, f"{side}Leg", -10.0, s * 6.0, s * 3.0)
                setr(p, f"{side}Shin", 16.0, 0, 0)
                flat_foot(p, side)
            setr(p, "rightEar", 0, 0, -10.0)
            setr(p, "leftEar", 8.0, 0, 12.0)
            setr(p, "hat", 6.0, 0, 10.0)
        else:
            # tips his hat with a small bow, mic down at his side
            lift = 0.5 - 0.5 * cs(w)
            setr(p, "body", 2.0, 0, 0)
            setr(p, "torso", 4.0 + 8.0 * lift, 6.0, 2.0)
            setr(p, "head", 4.0 + 6.0 * lift, 12.0, 8.0 * lift)
            setr(p, "hat", 10.0 * lift, 0, -14.0 * lift)
            setp(p, "hat", 0.6 * lift, 1.4 * lift, 0)
            setr(p, "rightArm", -8.0, 0, 6.0)
            setr(p, "rightForearm", -24.0, 0, 0)
            self.stance(p, 2.0)
            hb = self.D["hat"]
            goal = bone_goal("hat", (-hb[0] + 0.2, hb[1] + 0.5, 1.2), normal=(1, 0, 0), fingers=(0, 1, 0.2),
                             elbow=(-15.0, 36.0, 1.5))
            self.arm_ik("pose1_left", p, "left", goal, [-120, 20, -30, -60, 0, 0, 0, 0, 0])
            setr(p, "leftFingers", 0, 0, -20.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        if self.w:
            g = window(t, 1.2, 1.4, 0.03)
            add_rot(p, "head", 0, 0, 10.0 * g)
            add_rot(p, "rightHand", 0, 0, 12.0 * window(t, 0.4, 0.6, 0.03))
        else:
            add_rot(p, "jaw", 5.0 * window(t, 0.6, 1.4, 0.06), 0, 0)

    def pose2(self, t):
        w = TAU * t / 2.0
        p = {}
        if self.w:
            # stalking: arms reaching forward, head cocked
            setr(p, "body", 10.0, -6.0, 0)
            setr(p, "torso", 6.0 + 1.5 * sn(w), -6.0 + 3.0 * sn(w), 3.0 * sn(w))
            setr(p, "head", -10.0 + 2.0 * sn(w), 8.0, -16.0 + 3.0 * sn(w * 2))
            setr(p, "jaw", 12.0 + 4.0 * pos(sn(w * 2)), 0, 0)
            for side in ("right", "left"):
                s = S[side]
                ph = 0 if s > 0 else 1.2
                setr(p, f"{side}Arm", -78.0 + 6.0 * sn(w + ph), s * 6.0, s * (8.0 + 3.0 * sn(w + ph)))
                setr(p, f"{side}Forearm", -18.0 + 6.0 * sn(w + ph + 0.5), 0, 0)
                setr(p, f"{side}Hand", 10.0, 0, 0)
            self.fingers_open(p, 0.9)
            setr(p, "rightLeg", -22.0, 6.0, 4.0)
            setr(p, "rightShin", 16.0, 0, 0)
            flat_foot(p, "right")
            setr(p, "leftLeg", 10.0, -4.0, -2.0)
            setr(p, "leftShin", 8.0, 0, 0)
            flat_foot(p, "left", toe=6.0)
            setr(p, "rightEar", 0, 0, -12.0)
            setr(p, "hat", 0, 0, -8.0)
        else:
            # points the mic at the crowd, other hand on the hip
            setr(p, "body", 0, 10.0, -5.0)
            setp(p, "body", -0.5, 0, 0)
            setr(p, "torso", -2.0 + 1.0 * sn(w), -8.0, 6.0)
            setr(p, "head", -4.0, -10.0 - 12.0 * (0.5 - 0.5 * cs(w)), -8.0)
            setr(p, "rightLeg", -12.0, -8.0, 14.0)
            setr(p, "rightShin", 4.0, 0, 0)
            flat_foot(p, "right", toe=-12.0)
            setr(p, "leftLeg", 3.0, 6.0, -2.0)
            setr(p, "leftShin", 2.0, 0, 0)
            flat_foot(p, "left")
            setr(p, "hat", -4.0, 0, 6.0)
            goal = torso_goal((5.0, 37.0 + 0.5 * sn(w), -17.0), axis=(0, 0.25, -1), elbow=(12.0, 30.0, -6.0))
            self.arm_ik("pose2_right", p, "right", goal, [-80, 10, 10, -20, 0, 0, 0, 0, 0], effector=self.mic_effector())
            self.arm_ik("pose2_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        self.ears(p, w * 2, 1.5)
        meta(p)
        return p

    def pose2_post(self, p, t):
        if self.w:
            add_rot(p, "head", 0, 0, 12.0 * window(t, 0.7, 0.85, 0.02))
        else:
            add_rot(p, "jaw", 9.0 * window(t, 0.5, 0.75, 0.04) + 7.0 * window(t, 1.5, 1.7, 0.04), 0, 0)

    # ---- performances: calm, the way he sings on the show stage ---------------------------------
    def performance1(self, t):
        """Sings into the mic: steady stance, gentle sway, head scanning the audience."""
        W = self.w
        k = 0.6 if W else 1.0
        p = {}
        setr(p, "body", 1.0, 0, k * 2.5 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0 + (3.0 if W else 0.0), k * 4.0 * sn(TAU * t / 4.0), k * 1.5 * sn(TAU * t / 2.0))
        setr(p, "head", 3.0 + 2.0 * cs(TAU * t) + (5.0 if W else 0.0), 16.0 * k * sn(TAU * t / 4.0 + 0.5),
             -3.0 * sn(TAU * t / 2.0) + (9.0 if W else 0.0))
        knee = 2.0 + 2.0 * (0.5 - 0.5 * cs(TAU * t))
        self.stance(p, 2.0, knee * (0.5 if W else 1.0))
        # free arm opens toward the audience on the second phrase, palm up
        g = ease((t - 1.5) / 0.5) * (1 - ease((t - 3.2) / 0.5))
        setr(p, "leftArm", -35.0 * g - 4.0, 0, -(8.0 + 22.0 * g))
        setr(p, "leftForearm", -40.0 + 18.0 * g, 0, 0)
        setr(p, "leftHand", 0, -30.0 * g, 0)
        setr(p, "leftFingers", 0, 0, -20.0 * g)
        if W:
            setp(p, "mic", *self.i["mic"]["grip_offset"])
            setr(p, "mic", *self.i["mic"]["grip_rot"])
            self.arm_ik("perf1_right", p, "right", self.mouth_goal(), [-120, 20, 20, -70, 0, 0],
                        effector=self.mic_effector(), lock_hand=(0, 0, 0))
        else:
            self.arm_ik("perf1_right", p, "right", self.mouth_goal(), [-120, 20, 20, -70, 0, 0, 0, 0, 0],
                        effector=self.mic_effector())
        self.ears(p, TAU * t / 2.0, 1.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        if self.w:
            add_rot(p, "jaw", 6.0, 0, 0)
            self.sing(p, t, 0.6)
            g = window(t, 2.7, 3.0, 0.03)                  # stalls and twitches mid-song
            add_rot(p, "head", 0, 8.0 * g, -14.0 * g)
            add_rot(p, "leftForearm", -10.0 * window(t, 0.9, 1.1, 0.03), 0, 0)
        else:
            self.sing(p, t)

    def performance2(self, t):
        """Waves hello to the crowd, then his "har har har" laugh."""
        W = self.w
        p = {}
        setr(p, "body", 1.0, 0, 1.5 * sn(TAU * t / 2.0))
        h = ease((t - 2.1) / 0.3) * (1 - ease((t - 3.6) / 0.3))          # laugh
        setr(p, "torso", 2.0 + (3.0 if W else 0.0) - 3.0 * h, 3.0 * sn(TAU * t / 4.0), 0)
        setr(p, "head", 3.0 + (5.0 if W else 0.0) - 9.0 * h, -10.0 * sn(TAU * t / 4.0), 6.0 * h + (9.0 if W else 0.0))
        self.stance(p, 2.0, 1.0)
        if W:
            self.arms_hang(p, fwd=0.0, out=-2.0, elbow=-8.0)              # mic stays stowed
        else:
            self.mic_hand_rest(p)
            setr(p, "leftArm", -2.0, 0, -2.0)
            setr(p, "leftForearm", -8.0, 0, 0)
        # wave with the free hand during the first two seconds
        g = ease((t - 0.2) / 0.3) * (1 - ease((t - 1.75) / 0.3))
        sw = sn(TAU * t * (0.75 if W else 1.0))
        goal = torso_goal((-(self.i["half_w"] + 6.5) - 1.4 * sw, self.D["head_pivot"] + 6.0, -4.0), normal=(0, 0, 1),
                          fingers=(math.sin(math.radians(14 * sw)), -math.cos(math.radians(14 * sw)), 0),
                          elbow=(-(self.i["half_w"] + 7.5), self.i["torso"][1] - 4.0, -1.0))
        rest = {b: list(p.get(b, {}).get("rotation", [0.0, 0.0, 0.0])) for b in ("leftArm", "leftForearm", "leftHand")}
        self.arm_ik("perf2_left", p, "left", goal, [0, 0, -80, -10, 0, -70, 0, -80, 0])
        for b, r in rest.items():
            setr(p, b, *[lerp(r[j], p[b]["rotation"][j], g) for j in range(3)])
        setr(p, "leftFingers", 0, 0, 10.0 * g)
        meta(p)
        return p

    def performance2_post(self, p, t):
        hars = sum(window(t, t0, t0 + 0.2, 0.04) for t0 in (2.4, 2.85, 3.3))
        add_rot(p, "jaw", 14.0 * hars * (0.7 if self.w else 1.0) + 4.0 * window(t, 0.3, 1.8, 0.1), 0, 0)
        add_rot(p, "torso", -2.0 * hars, 0, 0)
        if self.w:
            add_rot(p, "jaw", 6.0, 0, 0)
            g = window(t, 3.0, 3.2, 0.02)
            add_rot(p, "head", 6.0 * g, -10.0 * g, 10.0 * g)


def build_anims(variant):
    FreddyNight(variant).build("withered_freddy" if variant == "withered" else "freddy")


# --------------------------------------------------------------------------
# Specs
# --------------------------------------------------------------------------


def spec(variant):
    mid = "withered_freddy" if variant == "withered" else "freddy"
    D = DIMS[variant]
    px0, px1, py0, py1, pz = D["palm"]
    return export.Character(
        model_id=mid,
        entity_id=f"fnaf:{mid}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", mid),
        materials=WITHERED_MATS if variant == "withered" else CLASSIC_MATS,
        build_geometry=lambda: build_geometry(variant),
        build_anims=lambda: build_anims(variant),
        sources=[os.path.abspath(__file__), os.path.join(os.path.dirname(os.path.abspath(__file__)), "night.py"), variant],
        spawn_egg=("#6b3a1f", "#1d1d1d") if variant == "withered" else ("#7a3f22", "#d29a66"),
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=((px0 + px1) / 2, (py0 + py1) / 2, 0.0),
                 chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                            y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(4, 4.5, 2.25),
        tpu=3,
    )
