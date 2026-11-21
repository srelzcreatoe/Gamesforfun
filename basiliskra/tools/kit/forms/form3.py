"""
Basiliskra III -- four footfalls.

Black, long-necked quadruped.  Jagged crimson dorsal plates in three rows, a tiny pale eye
under a heavy brow, a spiked tail club.  About 40 blocks from snout to club, back at
10 blocks, plate tips near 15.

Bone contract (the animations and the server rig rely on these names):
  root > body > chest > neck1..neck5 > head > jaw, eye_l, eye_r
                chest > leg_fl > leg_fl_lower > foot_fl      (and fr)
         body > hips  > leg_bl > leg_bl_lower > foot_bl      (and br)
                hips  > tail1..tail8 > club
  plate bones: plates_head, plates_neck1..5, plates_chest, plates_mid, plates_hips, plates_tail1..8
  gill flaps:  gill_l1..3, gill_r1..3 (on neck5)
Glow zones run tail to head: 0 club, 1 far tail, 2 near tail, 3 hips, 4 mid, 5 chest,
6 low neck, 7 high neck, 8 head.
"""
from __future__ import annotations

import math

from kit import Model, barrel, column
from parts import plate, tooth_row, claws, eye, gill_set, spike, rnd

SEED = 303

# shared with the animation generator and the server rig
NECK = [  # (length, half-width, half-height, rest pitch: - raises the front)
    (17, 38, 36, 4.0), (17, 34, 32.5, 3.0), (17, 30.5, 29, 2.0), (17, 27, 26, 0.0), (17, 24.5, 23.5, -2.0),
]
TAIL = [  # (length, half-width, half-height, rest pitch: + raises the tip)
    (31, 34, 32, -8.0), (31, 29.5, 28, -6.0), (30, 25, 24, -4.0), (30, 21, 20, -2.0),
    (30, 17.5, 17, 2.0), (29, 14.5, 14.5, 5.0), (29, 12, 12.5, 7.0), (28, 10, 11, 6.0),
]
HEAD_PITCH = -3.0
JAW_REST = 7.0
# legs: (upper length, upper rest pitch, lower length, lower rest pitch, foot rest pitch)
LEG_FRONT = (50.0, 20.0, 47.0, -35.0, 15.0)
LEG_REAR = (52.0, -22.0, 46.0, 40.0, -18.0)
SHOULDER_Y = 104.0


def flame(b, x, y, z, length, height, thick, tilt=0.0, tines=3, seed=0, mat="plate"):
    """A dorsal crest in the shape the paintings give him: a broad root that splits into
    back-raked tines like a tongue of flame.  Each tine is a stepped blade whose leading edge
    retreats while the trailing edge stays upright; tines sit on slightly different planes so
    their faces never coincide."""
    L, H = float(length), float(height)
    g = (y - 2, y + H * 1.05)
    piv = (x, y, z)
    # root slab
    b.cube((x - thick / 2, y - 3, z - L / 2), (thick, H * 0.20 + 3, L), mat, rot=(-10, 0, tilt), pivot=piv, g=g, axis=1)
    plan = {
        3: [(-0.27, 0.58, 6.0, 0.42), (0.03, 1.00, 16.0, 0.54), (0.33, 0.74, 30.0, 0.40)],
        2: [(-0.15, 0.70, 10.0, 0.52), (0.22, 1.00, 24.0, 0.54)],
    }[tines]
    for k, (zo, hf, sweep, wf) in enumerate(plan):
        jitter = rnd(seed, k, 1)
        h = H * hf * (0.9 + 0.2 * jitter)
        w = L * wf
        t = max(thick - (0 if k == 1 or tines == 2 and k == 1 else 1), 1)
        xo = x + (k - (tines - 1) / 2) * 0.55
        zc = z + zo * L
        tp = (xo, y + H * 0.08, zc)
        rot = (-(sweep + 8 * jitter), 0, tilt)
        y0 = y + H * 0.08
        for f0, f1, wfrac in ((0.0, 0.30, 1.0), (0.30, 0.54, 0.74), (0.54, 0.74, 0.50), (0.74, 0.89, 0.30), (0.89, 1.0, 0.15)):
            ww = max(w * wfrac, 1.0)
            # trailing (rear) edge fixed, leading edge retreats towards it
            z0 = zc + w / 2 - ww
            b.cube((xo - t / 2, y0 + f0 * h, z0), (t, (f1 - f0) * h, ww), mat, rot=rot, pivot=tp, g=g, axis=1)
        # a barb off the trailing edge of the main tine
        if k == len(plan) - 1 and H > 20:
            b.cube((xo - t / 2, y0 + 0.36 * h, zc + w / 2), (t, 0.12 * h, max(w * 0.22, 1.5)), mat, rot=rot, pivot=tp, g=g, axis=1)


def build() -> Model:
    m = Model("basiliskra_iii", "geometry.basiliskra.iii", seed=SEED)
    m.meta.update(glow_y0=64.0, glow_y1=156.0, wetness=0.15, bounds_margin=6.0, form=3)

    root = m.bone("root", None, (0, 0, 0))
    body = m.bone("body", root, (0, 112, 0), zone=4)

    def hide(cy, rh, **kw):
        d = dict(back_y=(cy - rh * 0.3, cy + rh), belly_y=cy - rh * 0.55, scale=(6, 5), belly_scale=(12, 7))
        d.update(kw)
        return d

    # ---------------------------------------------------------------- torso (long, arched, deep chest)
    barrel(body, -60, -26, 108, 46, 42, **hide(108, 42))
    barrel(body, -26, 6, 110, 45.5, 41.5, **hide(110, 41.5))
    barrel(body, 6, 36, 111, 45.5, 41.5, **hide(111, 41.5))
    mid_pl = m.bone("plates_mid", body, (0, 151, -12), zone=4)

    chest = m.bone("chest", body, (0, 108, -60), zone=5)
    barrel(chest, -90, -60, 106, 47, 43, **hide(106, 43))
    barrel(chest, -114, -90, 106, 46, 42, **hide(106, 42))
    barrel(chest, -130, -114, 108, 41, 38, **hide(108, 38))               # neck root collar
    for s in (1, -1):                                                     # shoulder blades
        chest.cube((s * 40 - 10, 100, -124), (20, 42, 50), "skin", scale=(7, 6), bias=-0.05)
        chest.cube((s * 45 - 7, 110, -116), (14, 26, 34), "skin", scale=(7, 6), bias=-0.08)
    chest_pl = m.bone("plates_chest", chest, (0, 148, -92), zone=5)

    hips = m.bone("hips", body, (0, 110, 36), zone=3)
    barrel(hips, 36, 70, 110, 46, 42, **hide(110, 42))
    barrel(hips, 70, 98, 110, 44, 40, **hide(110, 40))
    barrel(hips, 98, 114, 111, 38, 35, **hide(111, 35))                   # tail root
    for s in (1, -1):                                                     # haunches
        hips.cube((s * 39 - 10, 100, 58), (20, 44, 52), "skin", scale=(7, 6), bias=-0.05)
        hips.cube((s * 45 - 7, 110, 66), (14, 28, 36), "skin", scale=(7, 6), bias=-0.08)
    hips_pl = m.bone("plates_hips", hips, (0, 151, 70), zone=3)

    # ---------------------------------------------------------------- neck (thick, level, flows out of the chest)
    par = chest
    z = -126.0
    ny = 114.0
    neck = []
    for i, (ln, rw, rh, pitch) in enumerate(NECK):
        nb = m.bone(f"neck{i + 1}", par, (0, ny, z), rot=(pitch, 0, 0), zone=6 if i < 2 else 7)
        # overlap backwards into the previous segment so bending never opens a gap
        barrel(nb, z - ln, z + 9, ny, rw, rh, scale=(5, 4), belly_y=ny - rh * 0.5, back_y=(ny, ny + rh), belly_scale=(9, 5))
        pb = m.bone(f"plates_neck{i + 1}", nb, (0, ny + rh, z - ln / 2))
        h = 32 - i * 3.6
        flame(pb, 0, ny + rh - 3, z - ln * 0.5, 24 - i * 1.5, h, 3, seed=SEED + 50 + i)
        for s in (1, -1):
            flame(pb, s * rw * 0.56, ny + rh * 0.72, z - ln * 0.2, 13 - i, h * 0.45, 2, tilt=s * 28, tines=2, seed=SEED + 60 + i + s)
        neck.append(nb)
        par = nb
        z -= ln
    hz = z

    # ---------------------------------------------------------------- head
    head = m.bone("head", par, (0, ny, hz), rot=(HEAD_PITCH, 0, 0), zone=8)
    HS = dict(scale=(4, 3))
    K = 1.28

    def hc(x, y, zz, w, h, d, mat="skin", bone=None, **kw):
        """Head-space cube, scaled about the skull base."""
        kw = {**HS, **kw} if mat == "skin" else kw
        if "g" in kw:
            kw["g"] = tuple(ny + v * K for v in kw["g"]) if kw.get("axis", 1) == 1 else kw["g"]
        return (bone or head).cube((x * K, ny + y * K, hz + zz * K), (w * K, h * K, d * K), mat, **kw)

    hc(-18, -13, -28, 36, 31, 34, back_y=(ny, ny + 22))              # braincase: tall and blocky
    hc(-20.5, -14, -22, 41, 19, 25)                                   # cheeks / jaw muscle
    hc(-15.5, -10, -48, 31, 24, 22)                                   # snout
    hc(-13, -9, -63, 26, 20, 17)                                      # muzzle
    hc(-10.5, -8, -69, 21, 15, 7)                                     # nose
    hc(-4, 13.5, -60, 8, 2.5, 30, bias=-0.15)                         # nasal ridge
    for s in (1, -1):
        # the heavy brow: two ledges that overhang the eye and throw it into shadow
        hc(s * 20.0 - 4.5, 8.5, -34, 9, 8.5, 26, bias=-0.25)
        hc(s * 21.5 - 3.5, 15, -30, 7, 4.5, 17, bias=-0.25)
        hc(s * 21.0 - 2.5, -3.5, -35, 5, 5.5, 17, bias=-0.1)              # cheekbone under the eye
        hc(s * 16.5 - 2.5, 9, -47, 5, 5.5, 17, bias=-0.15)            # ridge running to the nostril
        hc(s * 6.5 - 1.5, 4, -69.6, 3, 2.4, 2, "pit")                 # nostril
        hc(s * 19.5 - 2, -5, -6, 4, 7, 10, bias=-0.2)                 # jaw-hinge boss
        eye(m, head, "eye_l" if s > 0 else "eye_r", s, s * 20.6 * K, ny + 3.6 * K, hz - 30.0 * K, size=4, depth=2)
        tooth_row(head, s * 12.6 * K, ny - 9.4 * K, hz - 61 * K, hz - 28 * K, 8, size=(2.6, 6.6, 3.4), jitter_seed=SEED + (1 if s > 0 else 2))
    for k in range(4):                                                # front teeth
        hc(-8.6 + k * 5.0, -13.6, -67.4, 2.2, 5.8, 2, "ivory", g=(-8, -13.6), axis=1, glow=0.3)
    hc(-12, -10.4, -62, 24, 1.4, 42, "mouth")                         # palate
    crest = m.bone("plates_head", head, (0, ny + 15 * K, hz - 10 * K))
    flame(crest, 0, ny + 16.5 * K, hz - 10 * K, 16, 15, 2, tines=2, seed=SEED + 90)
    for s in (1, -1):
        flame(crest, s * 12 * K, ny + 15 * K, hz - 5 * K, 11, 9, 2, tilt=s * 24, tines=2, seed=SEED + 91 + s)

    jaw = m.bone("jaw", head, (0, ny - 10 * K, hz - 10 * K), rot=(JAW_REST, 0, 0), zone=8)
    hc(-17, -22, -27, 34, 11, 25, bone=jaw, belly_y=ny - 16 * K)
    hc(-14, -20.5, -49, 28, 10, 24, bone=jaw, belly_y=ny - 15 * K)
    hc(-11.5, -19, -65, 23, 9, 18, bone=jaw, belly_y=ny - 14 * K)
    hc(-10.5, -11.2, -61, 21, 1.4, 46, "mouth", bone=jaw)
    hc(-6, -10.2, -55, 12, 2.6, 36, "tongue", bone=jaw)
    for s in (1, -1):
        tooth_row(jaw, s * 10.9 * K, ny - 10.2 * K, hz - 60 * K, hz - 28 * K, 7, up=True, size=(2.6, 5.8, 3.4), jitter_seed=SEED + (5 if s > 0 else 6))
    for k in range(3):
        hc(-6.2 + k * 5.2, -10.2, -64.6, 2.2, 5.2, 2, "ivory", bone=jaw, g=(-10.2, -5), axis=1, glow=0.3)
    jaw.locator("mouth", (0, ny - 6 * K, hz - 56 * K))
    head.locator("muzzle", (0, ny - 5 * K, hz - 72 * K))
    head.locator("throat", (0, ny - 5 * K, hz - 6 * K))
    head.locator("nose", (0, ny + 6 * K, hz - 70 * K))

    # old gill slits on the last neck segment: grown shut, they reopen to vent the beam
    n5 = neck[4]
    for s in (1, -1):
        gill_set(m, n5, s, s * 23.0 * 0.84, ny - 10, hz + 3, n=3, height=18, pitch=5.4, closed=True, depth=2.5, zone=7)
        n5.locator("gill_l" if s > 0 else "gill_r", (s * 21.0, ny - 1, hz + 9.5))

    # ---------------------------------------------------------------- legs (bent at elbow and hock, big splayed feet)
    def leg(tag: str, side: int, zc: float, parent, front: bool):
        L1, p1, L2, p2, p3 = LEG_FRONT if front else LEG_REAR
        x = side * 40.0
        top = SHOULDER_Y
        S = dict(scale=(6, 5))
        up = m.bone(f"leg_{tag}", parent, (x, top, zc), rot=(p1, 0, 0), zone=5 if front else 3)
        rx, rz = (25, 33) if front else (27, 37)
        column(up, x, zc, top - L1 - 4, top + 8, rx, rz, **S)                                  # upper leg
        up.cube((x + side * rx * 0.6 - 7, top - L1 * 0.72, zc - rz * 0.8), (14, L1 * 0.62, rz * 1.6), "skin", bias=-0.08, **S)   # outer muscle
        up.cube((x - 10, top - L1 * 0.6, zc + (-rz * 1.02 if front else rz * 0.62)), (20, L1 * 0.5, rz * 0.42), "skin", **S)   # bicep / thigh
        ky = top - L1
        lo = m.bone(f"leg_{tag}_lower", up, (x, ky, zc), rot=(p2, 0, 0))
        column(lo, x, zc, ky - L2 - 3, ky + 7, 19.5, 23, scale=(5, 4))
        column(lo, x, zc + (2 if front else -2), ky - 7, ky + 9, 22, 26, scale=(5, 4), bias=0.04)      # elbow / knee
        lo.cube((x - 10, ky - L2 * 0.62, zc + (15 if front else -24)), (20, L2 * 0.46, 9), "skin", scale=(5, 4), bias=-0.06)   # forearm / calf
        lo.cube((x - 4, ky - 3, zc + (22 if front else 20)), (8, 13, 8), "skin", scale=(4, 3), bias=-0.2)     # elbow spur / hock
        ay = ky - L2
        ft = m.bone(f"foot_{tag}", lo, (x, ay, zc), rot=(p3, 0, 0))
        column(ft, x, zc - 1, ay - 5, ay + 6, 21, 25, scale=(5, 4), bias=0.06)                             # wrist cuff
        ft.cube((x - 21, ay - 12, zc - 27), (42, 11, 46), "skin", scale=(5, 4), belly_y=ay - 9)           # pad
        ft.cube((x - 18, ay - 3, zc - 21), (36, 7, 36), "skin", scale=(5, 4))
        for k in range(4):                                                                               # toes
            tx = x + (k - 1.5) * 10.6
            yaw = -(k - 1.5) * 9.0
            ft.cube((tx - 4.6, ay - 12, zc - 40), (9.2, 9, 16), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=(tx, ay - 12, zc - 26))
            ft.cube((tx - 3.6, ay - 4.5, zc - 37), (7.2, 4, 13), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=(tx, ay - 12, zc - 26))
        claws(ft, x, ay - 12, zc - 39, 15.9, n=4, size=(6, 8, 15), forward=-1, splay=13.5)
        ft.cube((x - 4, ay - 12, zc + 17), (8, 7, 10), "ivory", g=(zc + 17, zc + 27), axis=2)                # dew claw
        ft.locator(f"foot_{tag}", (x, ay - 12, zc - 8))
        return up

    leg("fl", +1, -100, chest, True)
    leg("fr", -1, -100, chest, True)
    leg("bl", +1, 84, hips, False)
    leg("br", -1, 84, hips, False)

    # ---------------------------------------------------------------- tail
    par = hips
    z = 112.0
    ty = 112.0
    tails = []
    tail_z = []
    for i, (ln, rw, rh, pitch) in enumerate(TAIL):
        zone = 2 if i < 3 else 1
        tb = m.bone(f"tail{i + 1}", par, (0, ty, z), rot=(pitch, 0, 0), zone=zone)
        barrel(tb, z - 8, z + ln, ty, rw, rh, scale=(5, 4), belly_y=ty - rh * 0.5, back_y=(ty, ty + rh), belly_scale=(9, 5))
        pb = m.bone(f"plates_tail{i + 1}", tb, (0, ty + rh, z + ln / 2))
        h = max(52 - i * 5.0, 13)
        flame(pb, 0, ty + rh - 3, z + ln * 0.5, 33 - i * 2.0, h, 4 if i < 4 else 3 if i < 6 else 2, seed=SEED + 70 + i)
        if i < 7:
            for s in (1, -1):
                flame(pb, s * rw * 0.62, ty + rh * 0.6, z + ln * 0.2, 17 - i, h * 0.46, 2, tilt=s * 30, tines=2, seed=SEED + 80 + i + s)
        tails.append(tb)
        tail_z.append(z)
        par = tb
        z += ln
    # the pale notch: a bite out of the LEFT side of the tail just ahead of the club, where the
    # seam closed on him.  Carried through all three forms.
    t7, z7 = tails[6], tail_z[6]
    t7.cube((6.4, ty - 6, z7 + 7), (5.0, 10, 12), "scar")
    t7.cube((8.6, ty - 4, z7 + 9), (3.6, 6, 8), "scar")
    t7.locator("tail_notch", (11.5, ty, z7 + 13))

    # ---------------------------------------------------------------- club
    club = m.bone("club", par, (0, ty, z), zone=0)
    cz = z + 24.0
    R = dict(scale=(8, 7))
    club.cube((-10, ty - 10, z - 2), (20, 20, 8), "rock", **R)               # stalk: the tail thickens into the club
    club.cube((-15, ty - 15, z + 4), (30, 30, 8), "rock", **R)
    club.cube((-21, ty - 21, cz - 12), (42, 42, 26), "rock", **R)            # core
    club.cube((-26, ty - 15, cz - 9), (52, 30, 20), "rock", **R)
    club.cube((-15, ty - 26, cz - 9), (30, 52, 20), "rock", **R)
    club.cube((-15, ty - 15, cz - 16), (30, 30, 36), "rock", **R)
    club.locator("club_core", (0, ty, cz))
    # spikes: a ring round the equator, a ring raked back, and one out of the end
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
        base = (u[0] * 20, ty + u[1] * 20, cz + u[2] * 15)
        ln = 26 + 8 * rnd(SEED, k, 21) + (6 if k == 11 else 0)
        _, tip = spike(club, base, u, ln, 15 - (3 if k >= 6 else 0))
        club.locator(f"spike_tip_{k}", tip)

    # ---------------------------------------------------------------- body plates (three rows of flame crests)
    ridge = [  # (z, height, owner, base y)
        (-122, 36, chest_pl, 143), (-100, 50, chest_pl, 146), (-76, 62, chest_pl, 147),
        (-50, 74, mid_pl, 148), (-24, 84, mid_pl, 149), (2, 90, mid_pl, 150), (28, 90, mid_pl, 150),
        (54, 84, hips_pl, 150), (78, 74, hips_pl, 148), (100, 62, hips_pl, 146),
    ]
    for j, (zz, hh, pb, by) in enumerate(ridge):
        flame(pb, 0, by, zz, 46, hh, 5, seed=SEED + 100 + j)
        for s in (1, -1):
            flame(pb, s * 21, by - 6, zz + 13, 27, hh * 0.5, 3, tilt=s * 22, tines=2, seed=SEED + 120 + j * 2 + s)
            flame(pb, s * 36, by - 19, zz - 2, 17, hh * 0.27, 2, tilt=s * 40, tines=2, seed=SEED + 150 + j * 2 + s)
        pb.locator(f"plate_tip_{j}", (0, by + hh * 0.95, zz + 6 + hh * 0.3))
    body.locator("heart", (0, 112, -20))
    return m
