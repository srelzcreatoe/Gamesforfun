"""Shared parts of the voxel-style "night stage" animatronics.

Every character in these pictures is built on the same kind of frame: blocky limbs on
chrome pistons, big three-toed feet on a light sole, a boxy head with dark eye sockets.
This module builds those parts from a per-character measurement dict (see trio.CH and
cast.CH), with options for the bits that differ (toes, hands, materials).  Heads, ears,
props and tails that make each character unique live in the character modules.
"""
import numpy as np

from fnafkit.rig import bone, cube


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


# --------------------------------------------------------------------------
# Measurements
# --------------------------------------------------------------------------


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
# Parts
# --------------------------------------------------------------------------


def build_legs(D, toes="stepped", n_toes=3, toe_mat="fur", tip_mat=None, sole_mat="sole", heel_mat="fur"):
    """Legs on pistons and big feet.  toes: "stepped" (two stacked blocks), "claws" (stepped
    toes with a `tip_mat` claw block in front) or "hooves" (front block in `tip_mat`)."""
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
        fl = D.get("foot_len", 0.0)           # extra toe length for long-footed characters
        cube(foot, "sole", [fc - fh - 0.1, 0, -7.8 - fl], [fc + fh + 0.1, so, 3.8], sole_mat, s)
        cube(foot, "heel", [fc - fh + 0.5, so, -3.9], [fc + fh - 0.5, D["heel_top"], 3.6], heel_mat, s)
        gap = 0.2
        toe_w = (2 * fh - (n_toes - 1) * gap) / n_toes
        x = fc - fh
        for i in range(n_toes):
            if toes == "hooves":
                cube(foot, f"hoof{i + 1}", [x, so, -7.6 - fl], [x + toe_w, so + 2.2, -3.8], tip_mat, s)
                cube(foot, f"hoof{i + 1}_top", [x + 0.15, so + 2.2, -6.4 - fl], [x + toe_w - 0.15, D["toe_top"], -3.8], toe_mat, s)
            else:
                # each toe is two stacked blocks, the upper one set back
                cube(foot, f"toe{i + 1}", [x, so, -7.6 - fl], [x + toe_w, so + 1.7, -3.8], toe_mat, s)
                cube(foot, f"toe{i + 1}_top", [x + 0.15, so + 1.7, -6.9 - fl], [x + toe_w - 0.15, D["toe_top"], -3.8], toe_mat, s)
                if toes == "claws":
                    cube(foot, f"claw{i + 1}", [x + 0.3, 0.0, -8.6 - fl], [x + toe_w - 0.3, so + 0.9, -7.5 - fl], tip_mat, s)
            x += toe_w + gap


def build_torso(D, pelvis_pad=0.0, chest_mat="fur", belly_mat="tan", buttons_mat="black"):
    """Pelvis band, waist piston, chest, belly panel and (if D["buttons"]) two buttons."""
    hd, hw = D["torso_d"], D["half_w"]
    p0, p1 = D["pelvis"]
    bone("body", "root", [0, p0 + 0.8, 0])
    ph = D["pelvis_hw"]
    cube("body", "pelvis", [-ph, p0, -hd - pelvis_pad], [ph, p1, hd + pelvis_pad], "fur")
    c0, c1 = D["torso"]
    bone("torso", "body", [0, p1, 0])
    cube("torso", "waist_piston", [-hw + 1.0, p1 - 0.4, -hd + 1.2], [hw - 1.0, c0 + 0.3, hd - 1.2], "black")
    cube("torso", "chest", [-hw, c0, -hd], [hw, c1, hd], chest_mat)
    fz = -hd
    bx, b_bot, b_notch = D["belly"]
    cube("torso", "belly", [-bx, c0 + b_bot, fz - 0.25], [bx, c1 - b_notch, fz], belly_mat)
    cube("torso", "belly_top", [-bx + 1.0, c1 - b_notch, fz - 0.25], [bx - 1.0, c1 - b_notch + 0.9, fz], belly_mat)
    if D["buttons"]:
        y1, y2, bh = D["buttons"]
        for k, y in enumerate((y1, y2)):
            cube("torso", f"button{k + 1}", [-bh, y, fz - 0.6], [bh, y + 2 * bh, fz - 0.25], buttons_mat)


def build_bowtie(D, top_y, wing, mat="red", painter=p_bowtie, z_extra=0.0):
    fz = -D["torso_d"] - z_extra
    cube("torso", "bowtie_knot", [-0.8, top_y - 1.5, fz - 0.9], [0.8, top_y, fz], mat, painter=painter)
    for s in (1, -1):
        cube("torso", "bowtie_inner", [0.8, top_y - 1.7, fz - 0.7], [2.0, top_y + 0.2, fz], mat, s, painter=painter)
        cube("torso", "bowtie_wing", [2.0, top_y - 2.3, fz - 0.7], [wing, top_y + 0.7, fz], mat, s, painter=painter)


def build_neck(D):
    c1 = D["torso"][1]
    cube("torso", "neck_piston", [-1.8, c1, -1.8], [1.8, D["head_pivot"] + 0.6, 1.8], "chrome", painter=p_chrome)


ENDO = vox((40, 40, 44), (50, 50, 55), (60, 60, 66), bevel=0.2)     # dark steel, for build_endo_neck


def raise_head(d, neck):
    """Copy of measurements `d` with the head lifted so a `neck`-high gap opens between the top
    of the chest and the bottom of the jaw (where build_endo_neck shows)."""
    d = dict(d)
    lift = d["torso"][1] + neck - d["jaw"][0]
    for k in ("jaw", "snout", "eyes"):
        d[k] = tuple(v + lift for v in d[k])
    d["head_pivot"] += lift
    d["top"] += lift
    return d


def build_endo_neck(D):
    """Exposed endoskeleton neck in the gap between chest and head: a dark steel column on a
    chrome collar, with two thin cables at the front.  Needs an "endo" material (ENDO)."""
    c1, hp = D["torso"][1], D["head_pivot"]
    cube("torso", "neck_column", [-1.2, c1 - 0.4, -1.0], [1.2, hp + 0.9, 1.4], "endo")
    cube("torso", "neck_collar", [-1.8, c1 - 0.1, -1.6], [1.8, c1 + 0.55, 2.0], "chrome", painter=p_chrome)
    for s in (1, -1):
        cube("torso", "neck_cable", [0.75, c1 + 0.5, -1.45], [1.2, hp + 0.6, -1.0], "black", s)


def build_head(D, after_jaw=None, pupils=(1, -1), muzzle_mat="muzzle", jaw_rest=-5, face_mat="fur",
               nose=True, upper_teeth=True, lower_teeth=True, crown="box", cheek_puff=0.0):
    """The boxy animatronic face: cranium, eye band with sockets, brows, cheeks, muzzle,
    nose, mouth with teeth, hinged jaw and glowing pupils.

    crown: "box" (flat-topped), "round" (top edges stepped in) or "taper" (narrower top)
    cheek_puff: how far chubby cheek blocks stick out past the sides of the head"""
    bone("head", "torso", [0, D["head_pivot"], 0])
    H, fz, back, top = D["head_half"], D["face_z"], D["back"], D["top"]
    e0, e1 = D["eyes"]
    sn0, sn1 = D["snout"]
    sx0, sx1 = D["socket"]
    px, py = (sx0 + sx1) / 2, (e0 + e1) / 2
    if crown == "box":
        cube("head", "cranium", [-H, e1, fz], [H, top, back], face_mat)
    else:
        inset, cap = {"round": (0.8, 0.8), "taper": (1.4, 1.1)}[crown]
        cube("head", "cranium", [-H, e1, fz], [H, top - cap, back], face_mat)
        cube("head", "crown", [-H + inset, top - cap, fz + 0.4], [H - inset, top, back - 0.5], face_mat)
    cube("head", "eye_band", [-H, e0, fz + 0.6], [H, e1, back], face_mat, painter=socket_painter(px, py))
    cube("head", "nose_bridge", [-sx0, e0, fz], [sx0, e1, fz + 0.6], face_mat)
    for s in (1, -1):
        cube("head", "socket_side", [sx1, e0, fz], [H, e1, fz + 0.6], face_mat, s)
        b0, b1, bt, slant = D["brow"]
        cube("head", "brow", [b0, e1 + 0.25, fz - 0.3], [b1, e1 + 0.25 + bt, fz], "black", s,
             rot=[0, 0, -slant] if slant else None, origin=[(b0 + b1) / 2, e1 + 0.5, fz] if slant else None)
    cube("head", "cheeks", [-H, D["jaw"][1], fz + 0.3], [H, e0, back - 0.2], face_mat)
    sz, mh, seam = D["snout_z"], D["muzzle_hw"], D["seam"]
    if cheek_puff:
        for s in (1, -1):
            cube("head", "cheek_puff", [H - 0.3, sn0 - 0.6, fz - 0.2], [H + cheek_puff, e0 - 0.1, fz + 3.6], face_mat, s)
    if seam:
        for s in (1, -1):
            cube("head", "muzzle", [seam / 2, sn0, sz], [mh, sn1, fz + 0.3], muzzle_mat, s,
                 painter=muzzle_painter(D["freckles"], sn0) if muzzle_mat == "muzzle" else None)
    else:
        cube("head", "muzzle", [-mh, sn0, sz], [mh, sn1, fz + 0.3], muzzle_mat,
             painter=muzzle_painter(D["freckles"], sn0) if muzzle_mat == "muzzle" else None)
    if nose:
        nw, nh = D["nose"]
        cube("head", "nose", [-nw, sn1 - nh * 0.55, sz - 0.4], [nw, sn1 + nh * 0.45, sz + 1.2], "black")
    jh = D["jaw_hw"]
    j0, j1 = D["jaw"]
    cube("head", "mouth", [-jh + 0.4, j1 - 0.1, sz + 0.5], [jh - 0.4, sn0, back - 0.8], "socket")
    n_t, t_w, t_h = D["teeth"]
    step = 2 * (mh - 0.9) / (n_t - 1)
    if upper_teeth:
        for i in range(n_t):
            x = -(mh - 0.9) + i * step
            cube("head", f"tooth_upper{i + 1}", [x - t_w / 2, sn0 - t_h, sz + 0.3], [x + t_w / 2, sn0, sz + 1.0], "muzzle")
    bone("jaw", "head", [0, j1, 3.4], [jaw_rest, 0, 0])
    cube("jaw", "jaw", [-jh, j0, sz + 0.1], [jh, j1, 4.4], muzzle_mat,
         faces={"east": "fur", "west": "fur", "down": "fur", "south": "fur"})
    cube("jaw", "mouth_floor", [-jh + 0.6, j1, sz + 0.6], [jh - 0.6, j1 + 0.1, 3.8], "socket")
    if lower_teeth:
        for i in range(n_t - 1):
            x = -(mh - 0.9) + (i + 0.5) * step
            cube("jaw", f"tooth_lower{i + 1}", [x - t_w / 2, j1, sz + 0.3], [x + t_w / 2, j1 + t_h, sz + 1.0], "muzzle")
    if after_jaw:
        after_jaw()
    bone("eyes", "head", [0, py, fz + 0.6])
    for s in pupils:
        cube("eyes", "pupil", [px - 0.42, py - 0.42, fz + 0.48], [px + 0.42, py + 0.42, fz + 0.6], "glow", s, painter=p_pupil)


def build_arms(D, hook_side=None, tip_mat="fur", hook=None):
    """Arms on pistons with four-fingered hands.  A `hook_side` gets `hook(hand_bone, D, s)`
    instead of a palm and fingers."""
    hw = D["half_w"]
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
        if side == hook_side:
            hook(hand, D, s)
            continue
        cube(hand, "wrist_piston", [hcx - 0.9, wy - 0.7, -0.9], [hcx + 0.9, wy + 0.6, 0.9], "chrome", s, painter=p_chrome)
        cube(hand, "palm", [px0, py0, -pz], [px1, py1, pz], "fur", s)
        fing = f"{side}Fingers"
        bone(fing, hand, [s * (hcx + 0.1), py0 + 0.2, 0])
        fw = (2 * pz - 3 * 0.2) / 4
        for i in range(4):
            z0 = -pz + i * (fw + 0.2)
            cube(fing, f"finger{i + 1}_base", [px0 + 0.3, py0 - fl_base, z0], [px1 - 0.4, py0 + 0.2, z0 + fw], "fur", s)
            cube(fing, f"finger{i + 1}_tip", [px0 - 0.4, py0 - fl_base - fl_tip + 0.6, z0], [px0 + 1.6, py0 - fl_base + 0.6, z0 + fw],
                 tip_mat, s)
        th = f"{side}Thumb"
        bone(th, hand, [s * (px0 + 0.7), py1 - 1.0, -pz])
        cube(th, "thumb_base", [px0 - 0.3, py0, -pz - 1.0], [px0 + 1.3, py1 - 1.0, -pz + 0.2], "fur", s)
        cube(th, "thumb_tip", [px0 - 0.6, py0 - 1.2, -pz - 0.9], [px0 + 1.0, py0 + 0.5, -pz + 0.1], tip_mat, s)


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
