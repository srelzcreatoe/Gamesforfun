"""
Basiliskra IV -- the last form.

He stands up.  A heavy biped on thick, bent legs, about 27 blocks to the top of the skull at model
scale; long arms that reach his hips; two great wings whose membranes are webbed with bright veins;
the same flame-shaped crimson crests, now a crown round the skull and three rows down the neck, the
back and the tail; the same spiked club, bigger, at the end of a tail as long as he is tall.  What
he has carried through every form is still on him: the small pale eye under a heavy brow, the old
gill slits (grown shut on the neck), the pale notch in the left side of the tail.

Bone contract (animations and the server rig will be written against these names):
  root > body > hips  > leg_l > leg_l_lower > foot_l        (and _r)
                hips  > tail1..tail10 > club
         body > chest > arm_l > forearm_l > hand_l          (and _r)
                chest > wing_l > wing_l_arm > wing_l_f1..f4  (and _r); membranes ride the bone they hang from
                chest > neck1 > neck2 > head > jaw, eye_l, eye_r
  crest bones: plates_head, plates_neck1..2, plates_chest, plates_mid, plates_hips, plates_tail1..10,
               plate_break (the one that cracks off his back), ribs_l (the flank that glows when he swallows a charge)
  gill flaps:  gill_l1..3, gill_r1..3 (on neck2)
Glow zones run tail to head: 0 club, 1 far tail, 2 near tail, 3 hips and legs, 4 belly, 5 chest, arms and wings,
6 low neck, 7 high neck, 8 head.
"""
from __future__ import annotations

import math

import numpy as np

import kit
import paint
from kit import Model, affine, apply, column, hash01, rot_matrix, value_noise
from parts import claws, eye, gill_set, rnd, spike, tooth_row

SEED = 404

# ---- proportions shared with the animation generator and the server rig (model units, 16 = one block) ----------
HIP_Y = 170.0
# legs: (upper length, upper rest pitch, lower length, lower rest pitch, foot rest pitch); the pitches sum to zero
LEG = (84.0, -28.0, 74.0, 44.0, -16.0)
LEG_X = 68.0
# arms: (upper length, upper rest pitch, forearm length, forearm rest pitch)
ARM = (72.0, 14.0, 66.0, -52.0)
SHOULDER = (102.0, 302.0, -16.0)
NECK = [(34.0, 45.0, 43.0), (34.0, 41.0, 39.0)]            # (height, half-width, half-depth)
HEAD_PITCH = 8.0
JAW_REST = 13.0
TAIL = [  # (length, half-width, half-height, rest pitch: + raises the tip).  Down to the ground by the fifth joint,
    # along it, and up again at the end so that the club's lowest spike only just touches
    (50, 60, 55, -32.0), (50, 52, 48, -12.0), (48, 44, 41, 5.0), (48, 37, 34, 16.0), (46, 31, 28, 13.0),
    (46, 26, 24, 9.0), (44, 22, 21, 7.0), (44, 18.5, 18, 6.0), (42, 15.5, 15.5, 5.0), (40, 13, 13.5, 4.0),
]
# wings: root on the upper back, then the lengths of the two arm bones and the four fingers, and the angle each
# points at when the wing is spread (degrees above the horizontal, seen from in front; left wing, mirrored for the right)
# (spread, the wings span about twice his height: the wrist stands above his head, 15 blocks out)
WING_ROOT = (46.0, 322.0, 40.0)
WING_ARM = (120.0, 170.0)
WING_ARM_ANGLE = (62.0, 34.7)
WING_FINGERS = (283.0, 304.0, 314.0, 322.0)
WING_FINGER_ANGLE = (-47.9, -64.7, -81.2, -96.6)
WING_SWEEP = 32.0                                            # degrees the whole wing is swept back
WING_HEM = (58.0, 214.0, 58.0)                               # where the inner membrane meets his flank


# ---------------------------------------------------------------------------------------------------- painters
kit.PADDED_MATERIALS = tuple(dict.fromkeys(kit.PADDED_MATERIALS + ("wing",)))


def m_hide4(ctx):
    """His hide, standing up: the back (not the top) is the darkest mass, and the front of the trunk carries
    broad chevron plates, lighter than the hide, that point down the middle of his chest."""
    p = ctx.p
    bias = p.get("bias", 0.0)
    if "back_z" in p:
        z0, z1 = p["back_z"]
        bias = bias - 0.16 * np.clip((ctx.L[..., 2] - z0) / max(z1 - z0, 1e-6), 0, 1)
    rgb, gap, _ = paint._scales(ctx, bias=bias)
    if "front" in p and ctx.face != "south":
        zf, hw = p["front"]
        x, y = ctx.P[..., 0], ctx.P[..., 1]
        bh = p.get("chevron", 11.0)
        m = (ctx.L[..., 2] < zf) & (np.abs(x) < hw)
        if m.any():
            v = -y + 0.42 * np.abs(x)
            band = np.floor(v / bh).astype(np.int64)
            la = v - band * bh
            cgap = (la >= bh - 1.4) | (np.abs(x) < 1.2)
            top = la < 1.6
            r = hash01(band, (x > 0).astype(np.int64), seed=ctx.seed + 41)
            n = value_noise(ctx.P, 30.0, ctx.seed + 43)
            tone = 0.55 * n + 0.45 * r
            grp = np.where(tone < 0.40, 0, np.where(tone < 0.72, 1, 2))
            cols = np.stack([paint.PAL["belly_dark"], paint.PAL["belly_mid"], paint.PAL["belly_light"]])
            brgb = cols[grp]
            brgb = np.where((top & ~cgap)[..., None], paint.lerp(brgb, cols[np.clip(grp + 1, 0, 2)], 0.6), brgb)
            brgb = np.where(cgap[..., None], paint.PAL["crevice"] * 1.5, brgb)
            # a ragged edge of scales, not a ruled line
            edge = (np.abs(x) > hw - 3) & (hash01(np.floor(y).astype(np.int64), seed=ctx.seed + 31) > 0.5)
            m = m & ~edge
            rgb = np.where(m[..., None], brgb, rgb)
            gap = np.where(m, cgap, gap)
    glow = paint._veins(ctx, gap, strength=p.get("veins", 1.0))
    rough = np.where(gap, 0.9, p.get("rough", 0.68))
    return rgb, 1.0, glow, (0.0, rough, 0.0)


def _in_poly(x, y, poly):
    inside = np.zeros(x.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        cond = ((y0 > y) != (y1 > y))
        xi = x0 + (y - y0) * (x1 - x0) / np.where(abs(y1 - y0) < 1e-9, 1e-9, (y1 - y0))
        inside ^= cond & (x < xi)
    return inside


_VEINS: dict = {}


def _vein_net(cube, poly, origin, to_edges, seed):
    """A branching net of veins for one membrane: trunks run from `origin` (the wrist) to points spread along the
    free edge, wandering a little, and throw off side branches that throw off twigs.  Returns rows of
    (x0, y0, x1, y1, width, level).  Worked out once per slab, so both of its faces carry the same net."""
    if cube.idx in _VEINS:
        return _VEINS[cube.idx]
    rs = np.random.RandomState((seed * 7919 + cube.idx * 104729) % (2 ** 31))
    segs = []
    n = len(poly)
    targets = []
    for i in to_edges:
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        k = max(2, int(math.hypot(x1 - x0, y1 - y0) / 46))
        for j in range(k):
            t = (j + 0.5) / k + (rs.rand() - 0.5) * 0.3 / k
            targets.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))

    def grow(px, py, tx, ty, width, level):
        steps = max(3, int(math.hypot(tx - px, ty - py) / 15))
        for st in range(steps):
            rem = math.hypot(tx - px, ty - py)
            a = math.atan2(ty - py, tx - px) + (rs.rand() - 0.5) * 0.55
            step = rem / (steps - st)
            nx, ny = px + math.cos(a) * step, py + math.sin(a) * step
            w = width * (1 - 0.45 * st / steps)
            segs.append((px, py, nx, ny, w, level))
            if level < 2 and st > 0 and rs.rand() < (0.62 if level == 0 else 0.42):
                side = 1 if rs.rand() < 0.5 else -1
                ba = a + side * (0.45 + rs.rand() * 0.5)
                bl = rem * (0.30 + 0.3 * rs.rand()) * (0.85 if level == 0 else 0.6)
                grow(nx, ny, nx + math.cos(ba) * bl, ny + math.sin(ba) * bl, w * 0.6, level + 1)
            px, py = nx, ny

    for tx, ty in targets:
        grow(origin[0], origin[1], tx, ty, 3.0, 0)
    arr = np.array(segs, dtype=np.float64).reshape(-1, 6)
    _VEINS[cube.idx] = arr
    return arr


def m_wing(ctx):
    """A wing membrane: one thin slab whose outline is cut from it by alpha.  `poly` is the outline in the
    slab's own frame; edges listed in `hem` are the free trailing edge, hanging in a curve between the finger
    tips and frayed.  The membrane is a dark crimson; a net of bright veins branches across it from the wrist
    and carries the glow (it is along these that the recoil of a failed charge leaves him)."""
    p = ctx.p
    x, y = ctx.L[..., 0], ctx.L[..., 1]
    poly = p["poly"]
    inside = _in_poly(x, y, poly)
    edge_d = np.full(x.shape, 1e9)
    for (i, depth) in p.get("hem", ()):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = x1 - x0, y1 - y0
        ln = math.hypot(ex, ey) or 1.0
        t = np.clip(((x - x0) * ex + (y - y0) * ey) / (ln * ln), 0, 1)
        d = np.abs((x - x0) * ey - (y - y0) * ex) / ln
        fray = 6.0 * hash01(np.floor(t * ln / 6.0).astype(np.int64), seed=ctx.seed + 81 + ctx.cube.idx)
        sag = depth * np.sin(np.pi * t) ** 0.85 + fray * np.sin(np.pi * t)
        inside &= d > sag
        edge_d = np.minimum(edge_d, d - sag)
    n2 = value_noise(ctx.L, 11.0, ctx.seed + 143)
    n3 = value_noise(ctx.L, 64.0, ctx.seed + 145)
    # old tears: small holes near the hem
    inside &= ~((edge_d < 30) & (n2 > 0.82) & (n3 > 0.45))
    wx, wy = p["wrist"]
    far = np.clip(np.hypot(x - wx, y - wy) / p.get("reach", 300.0), 0, 1)
    base = paint.ramp([(0.0, paint.PAL["crim_deep"] * 0.8), (0.45, paint.PAL["crim_deep"] * 1.15), (1.0, paint.PAL["crim_dark"] * 1.1)],
                      np.clip(far * 0.85 + 0.35 * (n3 - 0.5), 0, 1))
    base = base * (0.84 + 0.32 * n2[..., None])
    # the veins: distance to the nearest branch of the net
    texel = 1.0 / p.get("tex_scale", 1.0)
    trunk = np.zeros(x.shape, dtype=bool)
    twig = np.zeros(x.shape, dtype=bool)
    halo = np.zeros(x.shape, dtype=bool)
    for (x0, y0, x1, y1, w, level) in _vein_net(ctx.cube, poly, p.get("vein_from", p["wrist"]), p.get("vein_to", [i for i, _ in p.get("hem", ())]), ctx.seed):
        ex, ey = x1 - x0, y1 - y0
        l2 = ex * ex + ey * ey or 1.0
        t = np.clip(((x - x0) * ex + (y - y0) * ey) / l2, 0, 1)
        d = np.hypot(x - (x0 + t * ex), y - (y0 + t * ey))
        hit = d < max(w * 0.5, texel * 0.55)
        if level == 0:
            trunk |= hit
            halo |= d < w * 0.5 + texel * 1.1
        else:
            twig |= hit
    rgb = np.where(halo[..., None], paint.lerp(base, paint.PAL["crim"], 0.55), base)
    rgb = np.where(twig[..., None], paint.PAL["crim_bright"] * 0.92, rgb)
    rgb = np.where(trunk[..., None], paint.PAL["crim_hot"], rgb)
    hem = (edge_d < 3.5) & inside
    rgb = np.where(hem[..., None], paint.lerp(rgb, paint.PAL["crim_bright"], 0.5), rgb)
    alpha = np.where(inside, 1.0, 0.0)
    g = np.where(trunk[..., None], paint.PAL["g_orange"], paint.PAL["g_red"])
    ga = np.where(trunk, 0.96, np.where(twig, 0.8, np.where(halo, 0.3, 0.08))) * alpha
    glow = np.concatenate([np.broadcast_to(g, rgb.shape), ga[..., None]], -1)
    return rgb, alpha, glow, (0.0, np.where(trunk | twig, 0.32, 0.5), 0.6)


def m_wingbone(ctx):
    """The long bones of the wing: dark, ringed like a tail, crimson showing between the rings."""
    ax = ctx.p.get("axis", 1)
    v = ctx.L[..., ax]
    ring = (np.floor(v / ctx.p.get("ring", 7.0)).astype(np.int64))
    lr = v - ring * ctx.p.get("ring", 7.0)
    seam = lr < 1.2
    r = hash01(ring, seed=ctx.seed + 151 + ctx.cube.idx % 5)
    rgb = paint.lerp(paint.PAL["rock_dark"], paint.PAL["rock"], 0.4 + 0.6 * r)
    rgb = paint.lerp(rgb, paint.PAL["crim_deep"], 0.35)
    rgb = np.where(seam[..., None], paint.PAL["crim_dark"], rgb)
    lip = (lr >= 1.2) & (lr < 2.4)
    rgb = np.where(lip[..., None], rgb * 1.25, rgb)
    ga = np.where(seam, 0.75, 0.04)
    glow = np.concatenate([np.broadcast_to(paint.PAL["g_red"], rgb.shape), ga[..., None]], -1)
    return rgb, 1.0, glow, (0.0, np.where(seam, 0.4, 0.6), 0.0)


paint.MATERIALS["hide4"] = m_hide4
paint.MATERIALS["wing"] = m_wing
paint.MATERIALS["wingbone"] = m_wingbone


# ------------------------------------------------------------------------------------------------------ crests
def crest(b, x, y, z, length, height, thick, lean=0.0, tilt=0.0, tines=3, seed=0, mat="plate"):
    """One of his crests: a broad root that splits into back-raked tines like a tongue of flame (the shape
    every form has carried).  `lean` tips the whole crest back from the vertical, for the ones that stand
    out of an upright back; `tilt` leans it outwards (+ = his left).  (x, y, z) is the middle of its root."""
    L, H = float(length), float(height)
    g = (y - 2, y + H * 1.05)
    piv = (x, y, z)
    b.cube((x - thick / 2, y - 3, z - L / 2), (thick, H * 0.20 + 3, L), mat, rot=(-(10 + lean), 0, tilt), pivot=piv, g=g, axis=1)
    plan = {
        3: [(-0.27, 0.58, 6.0, 0.42), (0.03, 1.00, 16.0, 0.54), (0.33, 0.74, 30.0, 0.40)],
        2: [(-0.15, 0.70, 10.0, 0.52), (0.22, 1.00, 24.0, 0.54)],
    }[tines]
    for k, (zo, hf, sweep, wf) in enumerate(plan):
        jitter = rnd(seed, k, 1)
        h = H * hf * (0.9 + 0.2 * jitter)
        w = L * wf
        t = max(thick - (0 if k == 1 else 1), 1)
        xo = x + (k - (tines - 1) / 2) * 0.55
        zc = z + zo * L
        rot = (-(lean + sweep + 8 * jitter), 0, tilt)
        y0 = y + H * 0.08
        for f0, f1, wfrac in ((0.0, 0.30, 1.0), (0.30, 0.54, 0.74), (0.54, 0.74, 0.50), (0.74, 0.89, 0.30), (0.89, 1.0, 0.15)):
            ww = max(w * wfrac, 1.0)
            z0 = zc + w / 2 - ww                       # trailing edge fixed, leading edge retreats towards it
            b.cube((xo - t / 2, y0 + f0 * h, z0), (t, (f1 - f0) * h, ww), mat, rot=rot, pivot=piv, g=g, axis=1)
        if k == len(plan) - 1 and H > 20:              # a barb off the trailing edge of the last tine
            b.cube((xo - t / 2, y0 + 0.36 * h, zc + w / 2), (t, 0.12 * h, max(w * 0.22, 1.5)), mat, rot=rot, pivot=piv, g=g, axis=1)


def slab_x(b, x0, x1, cy, cz, ry, rz, mat="skin", **p):
    """A rounded limb lying along X (three boxes, octagonal section), as `column` is one standing along Y."""
    xa, xb = min(x0, x1), max(x0, x1)
    for fy, fz, dx in ((1.0, 0.56, 0.0), (0.84, 0.84, 0.5), (0.54, 1.0, 1.0)):
        b.cube((xa - dx, cy - ry * fy, cz - rz * fz), ((xb - xa) + 2 * dx, 2 * ry * fy, 2 * rz * fz), mat, **p)


# -------------------------------------------------------------------------------------------------------- build
def build() -> Model:
    m = Model("basiliskra_iv", "geometry.basiliskra.iv", seed=SEED)
    m.meta.update(glow_y0=40.0, glow_y1=430.0, wetness=0.12, bounds_margin=8.0, form=4)
    S6 = dict(scale=(7, 6))

    root = m.bone("root", None, (0, 0, 0))
    body = m.bone("body", root, (0, HIP_Y, 6), zone=4)

    # ------------------------------------------------------------------ trunk: stacked, each stage a step further forward
    def trunk(b, y0, y1, zc, rx, rz, front=True, **kw):
        d = dict(S6, back_z=(zc, zc + rz), chevron=12.0)
        if front:
            d["front"] = (zc - rz * 0.30, rx * 0.62)
        d.update(kw)
        column(b, 0, zc, y0, y1, rx, rz, "hide4", **d)

    trunk(body, 196, 256, 2, 70, 64)                                          # belly
    trunk(body, 228, 262, -4, 78, 67, bias=0.02)                              # the swell under the ribs
    mid_pl = m.bone("plates_mid", body, (0, 226, 58), zone=4)

    hips = m.bone("hips", body, (0, HIP_Y - 4, 10), zone=3)
    trunk(hips, 138, 204, 10, 80, 66)                                         # pelvis
    trunk(hips, 128, 150, 16, 54, 52, front=False)                            # under the tail root
    for s in (1, -1):                                                         # haunches
        hips.cube((s * 72 - 20, 138, -28), (40, 66, 80), "hide4", bias=-0.05, **S6)
    hips_pl = m.bone("plates_hips", hips, (0, 176, 68), zone=3)

    chest = m.bone("chest", body, (0, 250, -6), zone=5)
    trunk(chest, 250, 316, -12, 88, 70)                                       # rib cage
    trunk(chest, 300, 336, -18, 82, 58)                                       # shoulders
    trunk(chest, 322, 344, -20, 52, 44, front=False)                          # neck root
    for s in (1, -1):
        chest.cube((s * 84 - 18, 284, -42), (36, 46, 58), "hide4", bias=-0.05, **S6)        # shoulder masses
        chest.cube((s * 44 - 20, 268, -80), (40, 42, 16), "hide4", front=(-66, 66), chevron=12.0, **S6)   # pectorals
        chest.cube((s * 34 - 16, 300, 26), (32, 36, 22), "hide4", bias=-0.1, **S6)         # the hump the wing springs from
    chest_pl = m.bone("plates_chest", chest, (0, 300, 50), zone=5)
    # the flank that shows the charge when he swallows it: ribs standing a little proud of the hide, left side only
    ribs = m.bone("ribs_l", chest, (82, 280, -10), zone=5)
    for k in range(4):
        ribs.cube((82.5, 258 + k * 13, -50 + k * 3), (7, 7, 68), "hide4", veins=3.2, bias=0.05, rot=(-12, 0, 0),
                  pivot=(86, 262 + k * 13, -14), scale=(5, 4))
    ribs.locator("ribs", (92, 280, -12))
    body.locator("heart", (0, 280, -30))

    # ------------------------------------------------------------------ neck and head
    ny0 = 336.0
    nb1 = m.bone("neck1", chest, (0, ny0, -22), zone=6)
    h1, rw1, rd1 = NECK[0]
    column(nb1, 0, -26, ny0 - 8, ny0 + h1, rw1, rd1, "hide4", back_z=(-26, -26 + rd1), front=(-26 - rd1 * 0.3, rw1 * 0.6), chevron=10.0, **S6)
    nb2 = m.bone("neck2", nb1, (0, ny0 + h1 - 4, -28), zone=7)
    h2, rw2, rd2 = NECK[1]
    y2 = ny0 + h1 - 8
    column(nb2, 0, -32, y2, y2 + h2 + 6, rw2, rd2, "hide4", back_z=(-32, -32 + rd2), front=(-32 - rd2 * 0.3, rw2 * 0.6), chevron=10.0, **S6)
    nk1 = m.bone("plates_neck1", nb1, (0, ny0 + 16, 12))
    nk2 = m.bone("plates_neck2", nb2, (0, y2 + 20, 2))

    ny, hz = y2 + h2 + 2, -28.0                                               # the base of the skull
    head = m.bone("head", nb2, (0, ny, hz), rot=(HEAD_PITCH, 0, 0), zone=8)
    HS = dict(scale=(5, 4))
    K = 1.6

    def hc(x, y, zz, w, h, d, mat="skin", bone=None, **kw):
        """Head-space cube, scaled about the base of the skull."""
        kw = {**HS, **kw} if mat == "skin" else kw
        if "g" in kw and kw.get("axis", 1) == 1:
            kw["g"] = tuple(ny + v * K for v in kw["g"])
        return (bone or head).cube((x * K, ny + y * K, hz + zz * K), (w * K, h * K, d * K), mat, **kw)

    hc(-18, -13, -28, 36, 31, 36, back_y=(ny, ny + 22))                       # braincase: tall and blocky
    hc(-21, -14, -22, 42, 19, 27)                                             # cheeks and jaw muscle
    hc(-15.5, -10, -48, 31, 23, 22)                                           # snout
    hc(-13, -9, -63, 26, 19, 17)                                              # muzzle
    hc(-10.5, -8, -69, 21, 14, 7)                                             # nose
    hc(-4, 12.5, -60, 8, 2.5, 30, bias=-0.15)                                 # nasal ridge
    for s in (1, -1):
        # the heavy brow: ledges that overhang the eye and throw it into shadow, raked up into a horn of hide
        hc(s * 20.0 - 4.5, 8.5, -36, 9, 9, 28, bias=-0.25)
        hc(s * 21.5 - 3.5, 15.5, -31, 7, 5, 19, bias=-0.25)
        hc(s * 22.0 - 2.5, 19, -24, 5, 4, 12, bias=-0.3)
        hc(s * 21.0 - 2.5, -3.5, -35, 5, 5.5, 17, bias=-0.1)                  # cheekbone under the eye
        hc(s * 16.5 - 2.5, 9, -47, 5, 5.5, 17, bias=-0.15)                    # ridge running to the nostril
        hc(s * 6.5 - 1.5, 4, -69.6, 3, 2.4, 2, "pit")                         # nostril
        hc(s * 20.0 - 2, -5, -6, 4, 8, 11, bias=-0.2)                         # jaw-hinge boss
        eye(m, head, "eye_l" if s > 0 else "eye_r", s, s * 20.6 * K, ny + 3.4 * K, hz - 31.0 * K, size=5, depth=2)
        tooth_row(head, s * 12.6 * K, ny - 9.4 * K, hz - 61 * K, hz - 26 * K, 8, size=(3.6, 10.5, 4.6), jitter_seed=SEED + (1 if s > 0 else 2))
        # two crimson spikes off each cheek, raked back
        for k in range(2):
            spike(head, (s * 20.5 * K, ny + (-9 + k * 7) * K, hz + (-8 + k * 4) * K), (s * 0.8, 0.15 + 0.2 * k, 0.6), 22 - k * 4, 7)
    for k in range(4):                                                        # front teeth
        hc(-8.6 + k * 5.0, -15.0, -67.4, 2.4, 7.2, 2.2, "ivory", g=(-8, -15.0), axis=1, glow=0.3)
    hc(-12, -10.4, -62, 24, 1.4, 42, "mouth")                                 # palate

    jaw = m.bone("jaw", head, (0, ny - 10 * K, hz - 8 * K), rot=(JAW_REST, 0, 0), zone=8)
    hc(-17.5, -23, -27, 35, 12, 27, bone=jaw, belly_y=ny - 17 * K)
    hc(-14, -21.5, -49, 28, 11, 24, bone=jaw, belly_y=ny - 16 * K)
    hc(-11.5, -20, -65, 23, 10, 18, bone=jaw, belly_y=ny - 15 * K)
    hc(-10.5, -11.2, -61, 21, 1.4, 46, "mouth", bone=jaw)
    hc(-6, -10.2, -55, 12, 2.6, 36, "tongue", bone=jaw)
    for s in (1, -1):
        tooth_row(jaw, s * 10.9 * K, ny - 10.2 * K, hz - 60 * K, hz - 26 * K, 7, up=True, size=(3.6, 9.0, 4.6), jitter_seed=SEED + (5 if s > 0 else 6))
    for k in range(3):
        hc(-6.2 + k * 5.2, -10.2, -64.6, 2.4, 6.4, 2.2, "ivory", bone=jaw, g=(-10.2, -4), axis=1, glow=0.3)
    jaw.locator("mouth", (0, ny - 6 * K, hz - 56 * K))
    head.locator("muzzle", (0, ny - 5 * K, hz - 72 * K))
    head.locator("throat", (0, ny - 5 * K, hz - 6 * K))
    head.locator("nose", (0, ny + 6 * K, hz - 70 * K))

    # the crown: crests round the back of the skull, standing up and raked back
    crown = m.bone("plates_head", head, (0, ny + 16 * K, hz - 6 * K))
    crest(crown, 0, ny + 17 * K, hz - 14 * K, 26, 52, 3, lean=8, seed=SEED + 90)
    crest(crown, 0, ny + 15 * K, hz + 4 * K, 26, 62, 4, lean=24, seed=SEED + 91)
    for s in (1, -1):
        crest(crown, s * 11 * K, ny + 16 * K, hz - 8 * K, 20, 42, 3, lean=14, tilt=s * 22, tines=2, seed=SEED + 92 + s)
        crest(crown, s * 16 * K, ny + 11 * K, hz + 2 * K, 19, 44, 3, lean=30, tilt=s * 42, tines=2, seed=SEED + 95 + s)
        crest(crown, s * 18 * K, ny + 1 * K, hz + 5 * K, 17, 34, 2, lean=46, tilt=s * 64, tines=2, seed=SEED + 98 + s)

    # old gill slits on the neck: grown shut, they reopen to vent the beam
    for s in (1, -1):
        gill_set(m, nb2, s, s * rw2 * 0.86, y2 + 6, -44, n=3, height=20, pitch=7.0, closed=True, depth=2.5, zone=7)
        nb2.locator("gill_l" if s > 0 else "gill_r", (s * (rw2 - 1), y2 + 16, -36))

    # ------------------------------------------------------------------ legs
    def leg(tag: str, side: int):
        L1, p1, L2, p2, p3 = LEG
        x, z = side * LEG_X, 6.0
        top = HIP_Y
        up = m.bone(f"leg_{tag}", hips, (x, top, z), rot=(p1, 0, 0), zone=3)
        column(up, x, z, top - L1 - 6, top + 16, 43, 54, "hide4", **S6)                                   # thigh
        up.cube((x + side * 27 - 13, top - L1 * 0.80, z - 44), (26, L1 * 0.78, 88), "hide4", bias=-0.08, **S6)   # outer muscle
        up.cube((x - 19, top - L1 * 0.68, z - 60), (38, L1 * 0.52, 26), "hide4", **S6)                    # quadriceps
        ky = top - L1
        lo = m.bone(f"leg_{tag}_lower", up, (x, ky, z), rot=(p2, 0, 0))
        column(lo, x, z, ky - L2 - 4, ky + 9, 32, 37, "hide4", scale=(6, 5))                              # shin
        column(lo, x, z - 2, ky - 11, ky + 13, 36, 42, "hide4", scale=(6, 5), bias=0.04)                  # knee
        lo.cube((x - 17, ky - L2 * 0.68, z + 24), (34, L2 * 0.52, 17), "hide4", scale=(6, 5), bias=-0.06)   # calf
        lo.cube((x - 6, ky - 2, z - 49), (12, 16, 12), "hide4", scale=(5, 4), bias=-0.2)                  # knee spur
        ay = ky - L2
        ft = m.bone(f"foot_{tag}", lo, (x, ay, z), rot=(p3, 0, 0))
        column(ft, x, z - 2, ay - 8, ay + 9, 35, 40, "hide4", scale=(6, 5), bias=0.06)                    # ankle cuff
        ft.cube((x - 40, ay - 24, z - 58), (80, 17, 98), "hide4", scale=(6, 5))                            # pad
        ft.cube((x - 34, ay - 9, z - 46), (68, 11, 74), "hide4", scale=(6, 5))
        for k in range(4):                                                                                # toes
            tx = x + (k - 1.5) * 20.0
            yaw = -(k - 1.5) * 8.0
            ft.cube((tx - 9, ay - 24, z - 88), (18, 16, 34), "hide4", scale=(5, 4), rot=(0, yaw, 0), pivot=(tx, ay - 24, z - 56))
            ft.cube((tx - 7, ay - 10, z - 80), (14, 7, 26), "hide4", scale=(5, 4), rot=(0, yaw, 0), pivot=(tx, ay - 24, z - 56))
        claws(ft, x, ay - 24, z - 87, 30.0, n=4, size=(13, 16, 32), forward=-1, splay=12.0)
        ft.cube((x - 7, ay - 24, z + 38), (14, 13, 20), "ivory", g=(z + 38, z + 58), axis=2)                 # heel spur
        ft.locator(f"foot_{tag}", (x, ay - 24, z - 14))
        ft.locator(f"heel_{tag}", (x, ay - 24, z + 40))
        return up

    leg("l", +1)
    leg("r", -1)

    # ------------------------------------------------------------------ arms (long: the hands hang at his hips)
    def arm(tag: str, side: int):
        L1, p1, L2, p2 = ARM
        sx, sy, sz = side * SHOULDER[0], SHOULDER[1], SHOULDER[2]
        up = m.bone(f"arm_{tag}", chest, (sx, sy, sz), rot=(p1, 0, -side * 15), zone=5)
        column(up, sx, sz, sy - L1 - 4, sy + 12, 26, 31, "hide4", scale=(6, 5))                            # upper arm
        up.cube((sx + side * 15 - 11, sy - L1 * 0.72, sz - 25), (22, L1 * 0.62, 50), "hide4", scale=(6, 5), bias=-0.08)   # deltoid
        column(up, sx, sz, sy - 6, sy + 22, 31, 36, "hide4", scale=(6, 5), bias=-0.04)                     # shoulder cap
        ey = sy - L1
        lo = m.bone(f"forearm_{tag}", up, (sx, ey, sz), rot=(p2, 0, 0))
        column(lo, sx, sz, ey - L2 - 2, ey + 7, 21, 25, "hide4", scale=(5, 4))                             # forearm
        column(lo, sx, sz + 2, ey - 9, ey + 10, 25, 29, "hide4", scale=(5, 4), bias=0.04)                  # elbow
        lo.cube((sx - 5, ey - 4, sz + 23), (10, 18, 12), "hide4", scale=(4, 3), bias=-0.2)                 # elbow spur
        for k in range(2):                                                                                # two spines down the forearm
            spike(lo, (sx + side * 16, ey - 16 - k * 22, sz + 6), (side * 0.7, 0.5, 0.5), 18 - k * 3, 7)
        wy = ey - L2
        hd = m.bone(f"hand_{tag}", lo, (sx, wy, sz), rot=(34, 0, 0))
        hd.cube((sx - 22, wy - 24, sz - 16), (44, 30, 30), "hide4", scale=(5, 4))                          # palm
        for k in range(4):                                                                                # fingers, splayed
            fx = sx + (k - 1.5) * 12.0
            roll = (k - 1.5) * 7.0
            hd.cube((fx - 5.4, wy - 47, sz - 15), (10.8, 26, 13), "hide4", scale=(4, 3), rot=(-14, 0, roll), pivot=(fx, wy - 24, sz - 9))
            hd.cube((fx - 4.2, wy - 80, sz - 14), (8.4, 36, 9), "ivory", rot=(-30, 0, roll), pivot=(fx, wy - 46, sz - 10),
                    g=(wy - 46, wy - 80), axis=1)                                                          # talon
            hd.cube((fx - 2.8, wy - 92, sz - 13), (5.6, 14, 6), "ivory", rot=(-46, 0, roll), pivot=(fx, wy - 46, sz - 10),
                    g=(wy - 46, wy - 92), axis=1)
        hd.cube((sx - side * 19 - 5, wy - 32, sz - 13), (10, 20, 11), "hide4", scale=(4, 3), rot=(-10, 0, -side * 28), pivot=(sx - side * 19, wy - 15, sz - 8))   # thumb
        hd.cube((sx - side * 25 - 3.5, wy - 56, sz - 11), (7, 26, 7), "ivory", rot=(-18, 0, -side * 34), pivot=(sx - side * 19, wy - 15, sz - 8),
                g=(wy - 30, wy - 56), axis=1)
        hd.locator(f"hand_{tag}", (sx, wy - 38, sz - 10))
        return up

    arm("l", +1)
    arm("r", -1)

    # ------------------------------------------------------------------ wings
    def wing(tag: str, side: int):
        """Laid out flat and straight (arm bones along X, fingers hanging down from the wrist) and brought
        to the spread pose by the bones' rest rotations, so each part can be folded later."""
        Rx, Ry, Rz = WING_ROOT
        zp = Rz
        la, lf = WING_ARM
        a_h, a_f = WING_ARM_ANGLE
        Sx = side * Rx
        Ex = Sx + side * la
        Wx = Ex + side * lf
        # rest rotations: a bone lying along +X turns to angle `a` with rz = -a (mirrored on the right)
        rz_h = -side * a_h
        rz_f = -side * (a_f - a_h)                                       # relative to the humerus
        hum = m.bone(f"wing_{tag}", chest, (Sx, Ry, zp), rot=(0, -side * WING_SWEEP, rz_h), zone=5)
        fore = m.bone(f"wing_{tag}_arm", hum, (Ex, Ry, zp), rot=(0, 0, rz_f))
        slab_x(hum, Sx - side * 8, Ex + side * 4, Ry, zp, 15, 16, "wingbone", axis=0, ring=9.0)
        slab_x(hum, Sx + side * 16, Sx + side * 80, Ry + 2, zp + 1, 19, 19, "hide4", scale=(5, 4), bias=-0.05)      # wing muscle
        for k in range(6):                                                # the ringed collar the wing springs from
            cx = Sx + side * (2 + k * 10.5)
            r = 27 - k * 1.5
            hum.cube((min(cx, cx + side * 7), Ry - r, zp - r), (7, 2 * r, 2 * r), "horn", g=(Ry - r, Ry + r), axis=1)
        slab_x(fore, Ex - side * 4, Wx + side * 3, Ry, zp, 12, 13, "wingbone", axis=0, ring=9.0)
        fore.cube((min(Ex - side * 11, Ex + side * 11), Ry - 17, zp - 17), (22, 34, 34), "wingbone", axis=0, ring=7.0)   # elbow
        # the wrist: a knuckle, and the hooked claw that stands up from it
        fore.cube((min(Wx - side * 12, Wx + side * 12), Ry - 16, zp - 15), (24, 32, 30), "wingbone", axis=0, ring=7.0)
        fore.cube((Wx - 7, Ry + 10, zp - 7), (14, 26, 14), "ivory", g=(Ry + 10, Ry + 70), axis=1, rot=(0, 0, side * 20), pivot=(Wx, Ry + 10, zp))
        fore.cube((Wx - 5, Ry + 33, zp - 5), (10, 22, 10), "ivory", g=(Ry + 10, Ry + 70), axis=1, rot=(0, 0, side * 44), pivot=(Wx, Ry + 16, zp))
        fore.cube((Wx - 3, Ry + 50, zp - 3), (6, 16, 6), "ivory", g=(Ry + 10, Ry + 70), axis=1, rot=(0, 0, side * 64), pivot=(Wx, Ry + 20, zp))
        fore.locator(f"wing_tip_{tag}", (Wx, Ry + 40, zp))

        # fingers: each hangs straight down from the wrist in its own frame; rz swings it out to its place in the fan
        # (a bone hanging along -Y points at angle -90; it turns to `a` with rz = -(a + 90); the forearm already holds a_f)
        rzs = [-side * (a + 90.0 - a_f) for a in WING_FINGER_ANGLE]
        tips = []
        for i, (ln, rz) in enumerate(zip(WING_FINGERS, rzs)):
            fb = m.bone(f"wing_{tag}_f{i + 1}", fore, (Wx, Ry, zp), rot=(0, 0, rz))
            w0 = 11.0 - i * 0.8
            for f0, f1, wf in ((0.0, 0.38, 1.0), (0.38, 0.72, 0.74), (0.72, 1.0, 0.5)):
                w = w0 * wf
                fb.cube((Wx - w / 2, Ry - f1 * ln, zp - w / 2), (w, (f1 - f0) * ln + 1.5, w), "wingbone", axis=1, ring=9.0)
            fb.cube((Wx - 3, Ry - ln - 20, zp - 3), (6, 21, 6), "ivory", g=(Ry - ln, Ry - ln - 20), axis=1)             # the claw each finger ends in
            fb.locator(f"wing_vein_{tag}{i}", (Wx, Ry - ln * 0.96, zp))
            tips.append((fb, ln, rz))

        def panel(b, poly, hem, wrist, reach, dz, **kw):
            xs, ys = [q[0] for q in poly], [q[1] for q in poly]
            x0, x1, y0, y1 = min(xs) - 1, max(xs) + 1, min(ys) - 1, max(ys) + 1
            b.cube((x0, y0, zp - 0.8 + dz), (x1 - x0, y1 - y0, 1.6), "wing", skip=("up", "down", "east", "west"),
                   poly=[tuple(q) for q in poly], hem=hem, wrist=wrist, reach=reach, tex_scale=0.6, **kw)

        # between each finger and the next: a triangle from the wrist, its free edge hanging in a curve
        Wp = np.array([Wx, Ry, zp])
        for i in range(len(tips) - 1):
            fb, ln, rz = tips[i]
            _, ln2, rz2 = tips[i + 1]
            R = rot_matrix(0, 0, rz2 - rz)                                 # the next finger, seen from this one's frame
            t2 = Wp + R @ np.array([0.0, -ln2, 0.0])
            poly = [(Wx, Ry), (Wx, Ry - ln), (float(t2[0]), float(t2[1]))]
            panel(fb, poly, [(1, 20.0 + 3 * i)], (Wx, Ry), max(ln, ln2), 0.35 * i)

        # from the last finger in to his flank, hung from the forearm; and the web inside the elbow, hung from the upper arm
        m.solve_rest()
        hem_model = np.array([side * WING_HEM[0], WING_HEM[1], WING_HEM[2]])
        fb4, ln4, rz4 = tips[-1]
        inv_f = np.linalg.inv(fore.world)
        hem_f = apply(inv_f, hem_model[None, :])[0]
        tip4_f = Wp + rot_matrix(0, 0, rz4) @ np.array([0.0, -ln4, 0.0])
        poly = [(Ex, Ry), (Wx, Ry), (float(tip4_f[0]), float(tip4_f[1])), (float(hem_f[0]), float(hem_f[1]))]
        panel(fore, poly, [(2, 26.0)], (Wx, Ry), 340.0, -0.4)
        inv_h = np.linalg.inv(hum.world)
        hem_h = apply(inv_h, hem_model[None, :])[0]
        poly = [(Sx, Ry), (Ex, Ry), (float(hem_h[0]), float(hem_h[1]))]
        panel(hum, poly, [], (Ex, Ry), 240.0, -0.8, vein_from=(Ex, Ry), vein_to=[2])

    wing("l", +1)
    wing("r", -1)

    # ------------------------------------------------------------------ tail: as long as he is tall, down to the ground and out
    par = hips
    z = 62.0
    ty = 152.0
    tails, tail_z = [], []
    for i, (ln, rw, rh, pitch) in enumerate(TAIL):
        zone = 2 if i < 4 else 1
        tb = m.bone(f"tail{i + 1}", par, (0, ty, z), rot=(pitch, 0, 0), zone=zone)
        kit.barrel(tb, z - 10, z + ln, ty, rw, rh, "hide4", scale=(6, 5), back_y=(ty, ty + rh))
        pb = m.bone(f"plates_tail{i + 1}", tb, (0, ty + rh, z + ln / 2))
        h = max(62 - i * 5.2, 14)
        crest(pb, 0, ty + rh - 3, z + ln * 0.5, 38 - i * 2.0, h, 4 if i < 5 else 3 if i < 8 else 2, seed=SEED + 70 + i)
        if i < 8:
            for s in (1, -1):
                crest(pb, s * rw * 0.62, ty + rh * 0.6, z + ln * 0.2, 20 - i, h * 0.46, 2, tilt=s * 30, tines=2, seed=SEED + 80 + i + s)
        tails.append(tb)
        tail_z.append(z)
        par = tb
        z += ln
    # the pale notch: a bite out of the LEFT side of the tail just ahead of the club, where the seam closed on him
    t9, z9 = tails[8], tail_z[8]
    t9.cube((8.5, ty - 7, z9 + 9), (6.0, 12, 15), "scar")
    t9.cube((11.5, ty - 5, z9 + 12), (4.4, 8, 10), "scar")
    t9.locator("tail_notch", (15.5, ty, z9 + 16))

    # ------------------------------------------------------------------ club
    club = m.bone("club", par, (0, ty, z), zone=0)
    C = 1.32
    cz = z + 24.0 * C
    R = dict(scale=(8, 7))

    def cc(x, y, zz, w, h, d):
        club.cube((x * C, ty + y * C, z + zz * C), (w * C, h * C, d * C), "rock", **R)

    cc(-10, -10, -2, 20, 20, 8)                                               # stalk: the tail thickens into the club
    cc(-15, -15, 4, 30, 30, 8)
    cc(-21, -21, 12, 42, 42, 26)                                              # core
    cc(-26, -15, 15, 52, 30, 20)
    cc(-15, -26, 15, 30, 52, 20)
    cc(-15, -15, 8, 30, 30, 36)
    club.locator("club_core", (0, ty, cz))
    dirs = []
    for k in range(6):
        a = math.radians(k * 60 + 30)
        dirs.append((math.cos(a), math.sin(a), -0.10))
    for k in range(5):
        a = math.radians(k * 72 + 54)
        dirs.append((math.cos(a) * 0.74, math.sin(a) * 0.74, 0.68))
    dirs.append((0.0, 0.05, 1.0))
    for k, d in enumerate(dirs):
        n = math.sqrt(sum(v * v for v in d))
        u = [v / n for v in d]
        base = (u[0] * 20 * C, ty + u[1] * 20 * C, cz + u[2] * 15 * C)
        ln = (26 + 8 * rnd(SEED, k, 21) + (6 if k == 11 else 0)) * C
        _, tip = spike(club, base, u, ln, (15 - (3 if k >= 6 else 0)) * C)
        club.locator(f"spike_tip_{k}", tip)

    # ------------------------------------------------------------------ crests down the neck and the back, three rows
    crest(nk2, 0, y2 + 22, 0, 26, 44, 4, lean=38, seed=SEED + 50)
    crest(nk1, 0, ny0 + 14, 12, 30, 54, 4, lean=42, seed=SEED + 51)
    for s in (1, -1):
        crest(nk2, s * 19, y2 + 20, -2, 20, 40, 3, lean=36, tilt=s * 36, tines=2, seed=SEED + 60 + s)
        crest(nk1, s * 22, ny0 + 12, 10, 24, 50, 3, lean=40, tilt=s * 36, tines=2, seed=SEED + 62 + s)
        crest(nk1, s * 38, ny0 + 2, 2, 20, 38, 3, lean=42, tilt=s * 58, tines=2, seed=SEED + 64 + s)
        # across the top of each shoulder, fanning out towards the wing
        crest(chest_pl, s * 60, 330, 14, 22, 44, 3, lean=40, tilt=s * 50, tines=2, seed=SEED + 66 + s)
    ridge = [  # (y on his back, the back's surface z there, height, owner)
        (318, 38, 62, chest_pl), (292, 54, 74, chest_pl), (266, 56, 84, chest_pl),
        (240, 64, 90, mid_pl), (214, 66, 90, mid_pl),
        (188, 74, 82, hips_pl), (164, 76, 70, hips_pl),
    ]
    for j, (yy, zs, hh, pb) in enumerate(ridge):
        owner = pb
        if j == 3:
            # the plate that cracks off his back in a fight: its own bone, so it can be taken away and leave the gap
            owner = m.bone("plate_break", mid_pl, (0, yy, zs))
            owner.locator("plate_break", (0, yy, zs + 8))
        crest(owner, 0, yy, zs - 3, 44, hh, 5, lean=44, seed=SEED + 100 + j)
        for s in (1, -1):
            crest(pb, s * 26, yy + 10, zs - 8, 30, hh * 0.70, 3, lean=44, tilt=s * 30, tines=2, seed=SEED + 120 + j * 2 + s)
            if j < 6:
                crest(pb, s * 48, yy + 2, zs - 24, 21, hh * 0.44, 3, lean=44, tilt=s * 52, tines=2, seed=SEED + 150 + j * 2 + s)
        t = math.radians(44 + 16)
        pb.locator(f"plate_tip_{j}", (0, yy + hh * 0.9 * math.cos(t), zs + hh * 0.9 * math.sin(t)))
    return m
