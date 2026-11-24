"""
Vathrok -- the other kaiju (2.0).

Not Basiliskra and nothing to do with his story: a second animal for the same worlds, asked for by the owner as
"a mobzilla like kaiju" (a giant four-legged reptile of the kind) and made in this pack's own style.  It walks on
four legs, but not as Basiliskra III does: its fore limbs are long, heavy arms and it walks on their knuckles, so
its shoulders stand high and its back slopes down to small hips and a long tail.  A short thick neck carries a long,
low, flat head with an underbite, two tusks, two pairs of small acid-green eyes and two back-swept horns.  One row
of tall spines runs from the nape to the tail, each a cluster of straight crystal blades that glow acid green; bony
scutes run in rows along its flanks; the tail ends in a flat bony blade with two prongs.  Slate-green hide.

Bone contract: Basiliskra III's (so the walk, the hit volumes and the server rig work unchanged):
  root > body > chest > neck1..neck5 > head > jaw, eye_l, eye_r
                chest > leg_fl > leg_fl_lower > foot_fl      (and fr: the arms; foot_* is the hand)
         body > hips  > leg_bl > leg_bl_lower > foot_bl      (and br)
                hips  > tail1..tail8 > club                  (the tail blade)
  spine bones: plates_head, plates_neck1..5, plates_chest, plates_mid, plates_hips, plates_tail1..8
  vents: gill_l1..3, gill_r1..3 (on neck5)
Glow zones run tail to head as his do: 0 blade, 1 far tail, 2 near tail, 3 hips, 4 mid, 5 chest, 6 low neck,
7 high neck, 8 head.
"""
from __future__ import annotations

import math

from kit import Model, barrel, column
from parts import tooth_row, eye, gill_set, spike, rnd

SEED = 505

NECK = [  # (length, half-width, half-height, rest pitch: + lowers the front)
    (11, 42, 38, 3.0), (11, 39, 35, 2.0), (11, 36, 32, 1.0), (11, 33, 29, 0.0), (10, 30, 27, 0.0),
]
TAIL = [  # (length, half-width, half-height, rest pitch: + raises the tip)
    (30, 32, 28, -6.0), (30, 28, 25, -4.0), (29, 24.5, 22, -3.0), (29, 21, 19, -1.0),
    (28, 18, 16, 1.0), (27, 15, 13.5, 2.0), (26, 12.5, 11, 3.0), (25, 10, 9, 3.0),
]
HEAD_PITCH = 2.0
JAW_REST = 6.0
# legs: (upper length, upper rest pitch, lower length, lower rest pitch, foot rest pitch).  The arms are long.
LEG_FRONT = (84.0, 8.0, 78.0, -22.0, 14.0)
LEG_REAR = (50.0, -24.0, 46.0, 42.0, -18.0)
SHOULDER_Y = 172.0
HIP_Y = 102.0
SLOPE = -16.0          # the torso slices are tipped this much (- raises the front): high shoulders, low hips


def back_cy(z: float) -> float:
    """Height of the middle of the torso along its length (model units, z: - is the front)."""
    return 140.0 - 0.29 * z


def torso_rh(z: float) -> float:
    """Half the torso's depth along its length: deep at the chest, slimmer at the hips."""
    return 46.0 - 9.0 * min(max((z + 110.0) / 210.0, 0.0), 1.0)


def shard(b, x, y, z, length, height, thick, lean=14.0, tilt=0.0, blades=3, seed=0, mat="plate"):
    """A spine: a cluster of straight crystal blades out of one root of bone, leaning back (`lean`, degrees towards
    the tail) and out (`tilt`).  Each blade tapers evenly to a point over its middle, and the blades fan a little
    apart (not his flame plates, which hook back)."""
    piv = (x, y, z)
    g = (y - 2, y + height * 1.05)
    b.cube((x - thick / 2 - 1.5, y - 5, z - length * 0.45), (thick + 3, height * 0.10 + 5, length * 0.9), "rock",
           rot=(-lean * 0.5, 0, tilt), pivot=piv, scale=(5, 4))
    plan = {
        3: [(-0.24, 0.62, -7.0, 0.44), (0.04, 1.00, 0.0, 0.56), (0.30, 0.72, 9.0, 0.42)],
        2: [(-0.14, 0.74, -5.0, 0.50), (0.18, 1.00, 6.0, 0.56)],
        1: [(0.0, 1.00, 0.0, 0.62)],
    }[blades]
    for k, (zo, hf, extra, wf) in enumerate(plan):
        j = rnd(seed, k, 1)
        h = height * hf * (0.9 + 0.2 * j)
        w = max(length * wf, 2.0)
        t = max(thick - (0 if k == len(plan) // 2 else 1), 1)
        xo = x + (k - (len(plan) - 1) / 2) * 0.6
        zc = z + zo * length
        tp = (xo, y, zc)
        rot = (-(lean + extra + 6 * (j - 0.5)), 0, tilt + (k - (len(plan) - 1) / 2) * 5)
        for f0, f1, wfrac in ((0.0, 0.34, 1.0), (0.34, 0.58, 0.72), (0.58, 0.78, 0.48), (0.78, 0.92, 0.26), (0.92, 1.0, 0.11)):
            ww = max(w * wfrac, 1.0)
            b.cube((xo - t / 2, y + f0 * h, zc - ww / 2), (t, (f1 - f0) * h, ww), mat, rot=rot, pivot=tp, g=g, axis=1)


def scute(b, x, y, z, side, size=1.0, seed=0):
    """One bony knob on the flank (two stepped boxes), leaned out."""
    w, h, d = 5 * size, 6 * size, 10 * size
    x0 = x if side > 0 else x - w
    b.cube((x0, y - h / 2, z - d / 2), (w, h, d), "rock", rot=(0, 0, side * (10 + 8 * rnd(seed, 1))), pivot=(x, y, z), scale=(5, 4))
    x1 = x + side * (w - 1) if side > 0 else x - w - 2
    b.cube((x1 if side > 0 else x1, y - h * 0.3, z - d * 0.3), (3, h * 0.6, d * 0.6), "rock",
           rot=(0, 0, side * 14), pivot=(x, y, z), scale=(5, 4))


def build() -> Model:
    m = Model("basiliskra_v", "geometry.basiliskra.v", seed=SEED)
    m.meta.update(glow_y0=130.0, glow_y1=300.0, wetness=0.1, bounds_margin=6.0, form=5, palette="vathrok", veins=0.3)

    root = m.bone("root", None, (0, 0, 0))
    body = m.bone("body", root, (0, 124, 0), zone=4)

    def hide(cy, rh, **kw):
        d = dict(back_y=(cy - rh * 0.3, cy + rh), belly_y=cy - rh * 0.55, scale=(6, 5), belly_scale=(12, 7))
        d.update(kw)
        return d

    def slice_(bone, z0, z1, widen=1.0, rh_add=0.0):
        zc = (z0 + z1) / 2
        cy, rh = back_cy(zc), torso_rh(zc) + rh_add
        rw = (rh + 6) * widen
        barrel(bone, z0, z1, cy, rw, rh, rot=(SLOPE, 0, 0), pivot=(0, cy, zc), **hide(cy, rh))
        return cy, rh, rw

    # ---------------------------------------------------------------- torso: deep, broad at the shoulders, tipped down to the hips
    chest = m.bone("chest", body, (0, back_cy(-60), -60), zone=5)
    for z0, z1, wd in ((-140, -116, 0.94), (-116, -88, 1.04), (-88, -60, 1.02)):
        slice_(chest, z0, z1, wd)
    for s in (1, -1):
        # the great shoulder humps over the arms, and the muscle down the outside of each
        chest.cube((s * 42 - 15, 170, -124), (30, 44, 52), "skin", scale=(7, 6), bias=-0.05, rot=(SLOPE, 0, s * 8), pivot=(s * 42, 190, -98))
        chest.cube((s * 50 - 9, 146, -116), (18, 38, 38), "skin", scale=(7, 6), bias=-0.08)
    chest_pl = m.bone("plates_chest", chest, (0, 214, -100), zone=5)

    for z0, z1 in ((-60, -32), (-32, -4), (-4, 24)):
        slice_(body, z0, z1)
    mid_pl = m.bone("plates_mid", body, (0, 186, -10), zone=4)

    hips = m.bone("hips", body, (0, back_cy(40), 40), zone=3)
    for z0, z1, wd in ((24, 52, 1.0), (52, 80, 0.98), (80, 106, 0.9)):
        slice_(hips, z0, z1, wd)
    for s in (1, -1):                                                     # haunches
        hips.cube((s * 38 - 10, 96, 54), (20, 40, 44), "skin", scale=(7, 6), bias=-0.05)
    hips_pl = m.bone("plates_hips", hips, (0, 156, 66), zone=3)

    # scutes: two rows of bony knobs down each flank
    for s in (1, -1):
        for i, z in enumerate(range(-124, 100, 15)):
            cy, rh = back_cy(z), torso_rh(z)
            rw = rh + 6
            owner = chest if z < -60 else body if z < 24 else hips
            scute(owner, s * (rw * 0.84 - 1.5), cy + rh * 0.48 - 0.21 * 0, z, s, 1.0 if z < 40 else 0.8, seed=SEED + i * 3 + s)
            if i % 2 == 0:
                scute(owner, s * (rw * 0.98 - 2), cy + rh * 0.05, z + 7, s, 0.7, seed=SEED + 40 + i * 3 + s)

    # ---------------------------------------------------------------- neck: short and thick, out of the top of the shoulders
    par = chest
    z = -138.0
    ny = 172.0
    neck = []
    for i, (ln, rw, rh, pitch) in enumerate(NECK):
        nb = m.bone(f"neck{i + 1}", par, (0, ny, z), rot=(pitch, 0, 0), zone=6 if i < 2 else 7)
        barrel(nb, z - ln, z + 10, ny, rw, rh, scale=(5, 4), belly_y=ny - rh * 0.5, back_y=(ny, ny + rh), belly_scale=(9, 5))
        pb = m.bone(f"plates_neck{i + 1}", nb, (0, ny + rh, z - ln / 2))
        shard(pb, 0, ny + rh - 4, z - ln * 0.5, 16, 20 + i * 3, 4, lean=20, blades=1, seed=SEED + 50 + i)
        neck.append(nb)
        par = nb
        z -= ln
    hz = z

    # ---------------------------------------------------------------- head: long, low and flat; an underbite and tusks
    head = m.bone("head", par, (0, ny, hz), rot=(HEAD_PITCH, 0, 0), zone=8)
    HS = dict(scale=(4, 3))
    K = 1.25

    def hc(x, y, zz, w, h, d, mat="skin", bone=None, **kw):
        """Head-space cube, scaled about the skull base."""
        kw = {**HS, **kw} if mat == "skin" else kw
        if "g" in kw:
            kw["g"] = tuple(ny + v * K for v in kw["g"]) if kw.get("axis", 1) == 1 else kw["g"]
        return (bone or head).cube((x * K, ny + y * K, hz + zz * K), (w * K, h * K, d * K), mat, **kw)

    hc(-20, -12, -28, 40, 27, 36, back_y=(ny, ny + 20))                # braincase
    hc(-23.5, -13, -22, 47, 17, 24)                                    # cheeks: the jaw muscles stand out wide
    hc(-16.5, -10, -54, 33, 19, 28)                                    # snout root
    hc(-14.5, -9, -76, 29, 15, 24)                                     # snout: long and flat
    hc(-12.5, -8, -90, 25, 12.5, 16)                                   # muzzle
    hc(-10, -7, -95, 20, 9.5, 6)                                       # nose
    hc(-3, 9.5, -84, 6, 2.5, 56, bias=-0.15)                           # nasal ridge
    hc(-8, 14, -30, 16, 3, 22, "rock", scale=(5, 4))                   # a bony plate over the braincase
    for s in (1, -1):
        hc(s * 19.0 - 5, 7.5, -40, 10, 7, 24, bias=-0.25)              # brow ledge over both eyes
        hc(s * 22.5 - 3, -5, -18, 6, 8, 12, "rock", scale=(5, 4))      # cheek knob
        hc(s * 17.0 - 2.5, 8, -60, 5, 4.5, 22, bias=-0.15)             # ridge to the nostril
        hc(s * 6.0 - 1.5, 2.6, -95.6, 3, 2.4, 2, "pit")                # nostril
        # four eyes: a pair under the brow, and a smaller pair behind and above them
        eye(m, head, "eye_l" if s > 0 else "eye_r", s, s * 20.6 * K, ny + 2.6 * K, hz - 38.0 * K, size=4, depth=2)
        e2x = s * 20.0 * K - (2 if s > 0 else 0)
        head.cube((e2x, ny + 7.6 * K, hz - 29 * K), (2, 3, 3), "eye", look="west" if s > 0 else "east",
                  glint=(1, 1) if s > 0 else (4, 1), pupil=0.44, tex_scale=2)
        # horns: back over the neck from the top of the skull
        _, tip = spike(head, (s * 13 * K, ny + 12 * K, hz - 10 * K), (s * 0.42, 0.46, 1.0), 40, 9, mat="horn")
        head.locator("horn_l" if s > 0 else "horn_r", tip)
        tooth_row(head, s * 12.0 * K, ny - 8.8 * K, hz - 90 * K, hz - 30 * K, 9, size=(2.6, 6.2, 3.2), jitter_seed=SEED + (1 if s > 0 else 2))
    crest = m.bone("plates_head", head, (0, ny + 16 * K, hz - 14 * K))
    shard(crest, 0, ny + 14.5 * K, hz - 16 * K, 12, 16, 2, lean=24, blades=2, seed=SEED + 90)

    jaw = m.bone("jaw", head, (0, ny - 10 * K, hz - 14 * K), rot=(JAW_REST, 0, 0), zone=8)
    hc(-19, -22, -32, 38, 12, 26, bone=jaw, belly_y=ny - 16 * K)
    hc(-16, -20.5, -58, 32, 11, 28, bone=jaw, belly_y=ny - 15 * K)
    hc(-14, -19.5, -84, 28, 10, 28, bone=jaw, belly_y=ny - 14 * K)
    hc(-13, -18.5, -99, 26, 9.5, 16, bone=jaw, belly_y=ny - 14 * K)  # the chin juts past the snout: an underbite
    hc(-11, -11.2, -94, 22, 1.4, 62, "mouth", bone=jaw)
    hc(-6, -10.2, -86, 12, 2.6, 52, "tongue", bone=jaw)
    for s in (1, -1):
        tooth_row(jaw, s * 11.0 * K, ny - 10.2 * K, hz - 88 * K, hz - 32 * K, 8, up=True, size=(2.6, 5.6, 3.2), jitter_seed=SEED + (5 if s > 0 else 6))
        # tusks up outside the upper lip
        hc(s * 11.2 - 1.8, -11, -97, 3.6, 13, 3.6, "ivory", bone=jaw, g=(-11, 2), axis=1, glow=0.2)
    jaw.locator("mouth", (0, ny - 6 * K, hz - 82 * K))
    head.locator("muzzle", (0, ny - 5 * K, hz - 98 * K))
    head.locator("throat", (0, ny - 5 * K, hz - 8 * K))
    head.locator("nose", (0, ny + 4 * K, hz - 94 * K))

    # vents: three glowing slits each side of the last neck segment (they steam when it has breathed)
    n5 = neck[4]
    for s in (1, -1):
        gill_set(m, n5, s, s * 30.0 * 0.84, ny - 12, hz + 3, n=3, height=20, pitch=5.6, closed=False, depth=2.5, zone=7)
        n5.locator("gill_l" if s > 0 else "gill_r", (s * 27.0, ny - 2, hz + 9.5))

    # ---------------------------------------------------------------- legs: long arms on their knuckles, short hind legs
    def leg(tag: str, side: int, zc: float, parent, front: bool):
        L1, p1, L2, p2, p3 = LEG_FRONT if front else LEG_REAR
        x = side * (46.0 if front else 40.0)
        top = SHOULDER_Y if front else HIP_Y
        S = dict(scale=(6, 5))
        up = m.bone(f"leg_{tag}", parent, (x, top, zc), rot=(p1, 0, 0), zone=5 if front else 3)
        rx, rz = (24, 30) if front else (25, 34)
        column(up, x, zc, top - L1 - 4, top + 10, rx, rz, **S)
        up.cube((x + side * rx * 0.6 - 8, top - L1 * 0.7, zc - rz * 0.8), (16, L1 * 0.6, rz * 1.6), "skin", bias=-0.08, **S)
        up.cube((x - 11, top - L1 * 0.62, zc + (-rz * 1.02 if front else rz * 0.62)), (22, L1 * 0.5, rz * 0.42), "skin", **S)
        ky = top - L1
        lo = m.bone(f"leg_{tag}_lower", up, (x, ky, zc), rot=(p2, 0, 0))
        column(lo, x, zc, ky - L2 - 3, ky + 7, 20.5 if front else 18.5, 24 if front else 22, scale=(5, 4))
        column(lo, x, zc + (2 if front else -2), ky - 7, ky + 9, 23, 27, scale=(5, 4), bias=0.04)
        if front:
            # a heavy forearm, scutes down its back
            lo.cube((x - 12, ky - L2 * 0.66, zc + 14), (24, L2 * 0.52, 12), "skin", scale=(5, 4), bias=-0.06)
            for k in range(3):
                lo.cube((x - 3, ky - 14 - k * 16, zc + 24), (6, 9, 6), "rock", scale=(5, 4))
        else:
            lo.cube((x - 9, ky - L2 * 0.62, zc - 22), (18, L2 * 0.46, 8), "skin", scale=(5, 4), bias=-0.06)
            lo.cube((x - 4, ky - 3, zc + 20), (8, 12, 8), "rock", scale=(4, 3))
        ay = ky - L2
        ft = m.bone(f"foot_{tag}", lo, (x, ay, zc), rot=(p3, 0, 0))
        column(ft, x, zc - 1, ay - 5, ay + 6, 22, 25, scale=(5, 4), bias=0.06)
        if front:
            # the hand: it walks on a pad of knuckles, three long claws curled forward and down, a thumb claw inside
            ft.cube((x - 24, ay - 12, zc - 26), (48, 12, 40), "skin", scale=(5, 4), belly_y=ay - 9)
            ft.cube((x - 21, ay - 3, zc - 20), (42, 8, 32), "skin", scale=(5, 4))
            for k in range(3):
                tx = x + (k - 1) * 14.0
                yaw = -(k - 1) * 8.0
                ft.cube((tx - 5.5, ay - 12, zc - 40), (11, 10, 16), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=(tx, ay - 12, zc - 26))
                ft.cube((tx - 3.5, ay - 12, zc - 58), (7, 8, 20), "ivory", g=(zc - 40, zc - 58), axis=2, rot=(-8, yaw, 0), pivot=(tx, ay - 12, zc - 40))
                ft.cube((tx - 2.5, ay - 12, zc - 63), (5, 5, 6), "ivory", g=(zc - 40, zc - 63), axis=2, rot=(-20, yaw, 0), pivot=(tx, ay - 12, zc - 40))
            ft.cube((x - side * 22 - 3, ay - 11, zc - 30), (6, 7, 14), "ivory", g=(zc - 16, zc - 30), axis=2, rot=(0, side * 30, 0), pivot=(x - side * 22, ay - 11, zc - 16))
            ft.locator(f"claw_{tag[1]}", (x, ay - 8, zc - 60))
        else:
            ft.cube((x - 20, ay - 12, zc - 26), (40, 11, 44), "skin", scale=(5, 4), belly_y=ay - 9)
            ft.cube((x - 17, ay - 3, zc - 20), (34, 7, 34), "skin", scale=(5, 4))
            for k in range(3):
                tx = x + (k - 1) * 12.0
                yaw = -(k - 1) * 10.0
                ft.cube((tx - 4.6, ay - 12, zc - 38), (9.2, 9, 14), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=(tx, ay - 12, zc - 26))
                ft.cube((tx - 3, ay - 12, zc - 47), (6, 6, 10), "ivory", g=(zc - 38, zc - 47), axis=2, rot=(0, yaw, 0), pivot=(tx, ay - 12, zc - 26))
        ft.locator(f"foot_{tag}", (x, ay - 12, zc - 8))
        return up

    leg("fl", +1, -98, chest, True)
    leg("fr", -1, -98, chest, True)
    leg("bl", +1, 72, hips, False)
    leg("br", -1, 72, hips, False)

    # ---------------------------------------------------------------- tail
    par = hips
    z = 106.0
    ty = back_cy(100) - 2
    tails = []
    for i, (ln, rw, rh, pitch) in enumerate(TAIL):
        zone = 2 if i < 3 else 1
        tb = m.bone(f"tail{i + 1}", par, (0, ty, z), rot=(pitch, 0, 0), zone=zone)
        barrel(tb, z - 8, z + ln, ty, rw, rh, scale=(5, 4), belly_y=ty - rh * 0.5, back_y=(ty, ty + rh), belly_scale=(9, 5))
        pb = m.bone(f"plates_tail{i + 1}", tb, (0, ty + rh, z + ln / 2))
        h = max(46 - i * 4.8, 10)
        shard(pb, 0, ty + rh - 4, z + ln * 0.5, 26 - i * 2.0, h, 5 if i < 4 else 3, lean=24, blades=2 if i < 4 else 1, seed=SEED + 70 + i)
        if i < 6:
            for s in (1, -1):
                scute(tb, s * (rw * 0.84 - 1), ty + rh * 0.3, z + ln * 0.5, s, 0.7 - i * 0.05, seed=SEED + 80 + i + s)
        tails.append(tb)
        par = tb
        z += ln
    tails[6].locator("tail_notch", (10.0, ty, z - 25 + 12))

    # ---------------------------------------------------------------- the tail blade: flat, upright, with a prong each side
    club = m.bone("club", par, (0, ty, z), zone=0)
    cz = z + 20.0
    club.cube((-8, ty - 8, z - 2), (16, 16, 10), "rock", scale=(8, 7))
    club.cube((-5, ty - 12, z + 4), (10, 24, 14), "rock", scale=(8, 7))
    for f0, f1, hh in ((0.0, 0.3, 54.0), (0.3, 0.55, 42.0), (0.55, 0.78, 28.0), (0.78, 1.0, 11.0)):
        zz0, zz1 = z + 8 + f0 * 58, z + 8 + f1 * 58
        club.cube((-3, ty - hh / 2, zz0), (6, hh, zz1 - zz0), "plate", g=(z + 8, z + 66), axis=2)
    club.locator("club_core", (0, ty, cz))
    tips = []
    for s in (1, -1):
        _, tip = spike(club, (s * 4, ty, z + 12), (s * 1.0, 0.15, 0.9), 26, 8, mat="horn")
        tips.append(tip)
    tips.append((0, ty, z + 66))
    tips += [(0, ty + 20 - 3 * k, z + 10 + 11 * k) for k in range(4)] + [(0, ty - 20 + 3 * k, z + 10 + 11 * k) for k in range(4)]
    tips.append((0, ty, z + 30))
    tips.append((0, ty, z + 42))
    for k, tip in enumerate(tips[:12]):
        club.locator(f"spike_tip_{k}", tip)

    # ---------------------------------------------------------------- the spine row: tallest over the shoulders
    ridge = [  # (z, height, owner)
        (-130, 44, chest_pl), (-108, 70, chest_pl), (-84, 86, chest_pl),
        (-58, 92, mid_pl), (-32, 88, mid_pl), (-6, 80, mid_pl), (20, 70, mid_pl),
        (44, 60, hips_pl), (68, 52, hips_pl), (92, 42, hips_pl),
    ]
    for j, (zz, hh, pb) in enumerate(ridge):
        by = back_cy(zz) + torso_rh(zz) - 6 + (zz + 10) * math.tan(math.radians(-SLOPE)) * 0.0
        shard(pb, 0, by, zz, 40, hh, 6, lean=16, blades=2, seed=SEED + 100 + j)
        if j < 7:
            for s in (1, -1):
                shard(pb, s * 22, by - 10, zz + 8, 18, hh * 0.32, 4, lean=22, tilt=s * 30, blades=1, seed=SEED + 120 + j * 2 + s)
        pb.locator(f"plate_tip_{j}", (0, by + hh * 0.95, zz + hh * 0.25))
    body.locator("heart", (0, back_cy(-30), -30))
    body.locator("back", (0, back_cy(-40) + torso_rh(-40), -40))
    return m
