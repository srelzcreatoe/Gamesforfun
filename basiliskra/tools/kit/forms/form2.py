"""
Basiliskra II -- the shore.

The same animal, days later.  The front half has become heavy and armoured and stands on two
huge clawed forelimbs; the hips drag; the hind legs are small and webbed; the old gills have
half grown shut; the ribbon has fused into blunt plates; the tail ends in a heavy oval knob
with two short horn buds.

Bone contract:
  root > body > chest > neck > head > jaw, eye_l, eye_r
                neck  > gill_l1..3, gill_r1..3
                chest > arm_l > forearm_l > claw_l          (and _r)
                chest > plates_chest
         body > mid   > plates_mid
                mid   > hips > plates_hips
                hips  > leg_l > foot_l                      (and _r)
                hips  > tail1..tail6 > knob,   tail{k} > plates_tail{k}
Glow zones (tail to head): 0 knob, 1 tail4-6, 2 tail1-3, 3 hips, 4 mid, 5 chest and arms,
6 neck, 7 gills, 8 head.
"""
from __future__ import annotations

from kit import Model, barrel, column
from parts import eye, tooth_row, claws, gill_set, spike, rnd

SEED = 202

# shared with the animation generator and the server rig
ARM = (48.0, 14.0, 50.0, -38.0, 24.0)       # upper length, upper pitch, forearm length, forearm pitch, hand pitch
SHOULDER_Y = 102.0
TAIL = [(28, 40, 30), (28, 37, 28), (28, 34, 26), (28, 31, 24), (28, 28.5, 22), (28, 26.5, 21)]   # (length, half-width, half-height)
HEAD_PITCH = 4.0
JAW_REST = 9.0


def plate(b, x, y, z, length, height, thick, sweep=16.0):
    """A blunt plate: what is left of the ribbon.  A broad root, a rounded top that leans
    towards the tail -- a worn shark fin, not a blade."""
    piv = (x, y, z)
    rot = (-sweep, 0.0, 0.0)
    g = (y - 2, y + height * 1.05)
    z1 = z + length / 2                               # trailing edge stays, leading edge retreats
    for f0, f1, wf, tf in ((0.0, 0.34, 1.0, 0.0), (0.34, 0.60, 0.88, 1.0), (0.60, 0.82, 0.70, 2.0), (0.82, 1.0, 0.46, 3.0)):
        ww = length * wf
        t = max(thick - tf, 2.0)
        b.cube((x - t / 2, y + f0 * height - (3 if f0 == 0 else 0), z1 - ww), (t, (f1 - f0) * height + (3 if f0 == 0 else 0), ww),
               "plate", rot=rot, pivot=piv, g=g, axis=1)


def build() -> Model:
    m = Model("basiliskra_ii", "geometry.basiliskra.ii", seed=SEED)
    m.meta.update(glow_y0=10.0, glow_y1=104.0, wetness=0.5, bounds_margin=6.0, form=2)

    root = m.bone("root", None, (0, 0, 0))
    body = m.bone("body", root, (0, 44, 0), zone=5)

    def hide(cy, rh, **kw):
        d = dict(back_y=(cy - rh * 0.2, cy + rh), belly_y=cy - rh * 0.5, scale=(7, 5), belly_scale=(13, 7))
        d.update(kw)
        return d

    # ---------------------------------------------------------------- chest: the heavy armoured front
    CYC = 78.0
    chest = m.bone("chest", body, (0, CYC, 0), zone=5)
    barrel(chest, -36, 32, CYC, 50, 43, **hide(CYC, 43))
    chest.cube((-34, CYC + 34, -28), (68, 10, 50), "skin", scale=(8, 6), bias=-0.12, back_y=(CYC + 28, CYC + 46))     # shoulder hump
    chest.cube((-24, CYC + 42, -20), (48, 5, 34), "skin", scale=(8, 6), bias=-0.16)
    for s in (1, -1):
        chest.cube((s * 42 - 10, CYC - 6, -30), (20, 40, 46), "skin", scale=(8, 6), bias=-0.06)           # shoulder mass
        chest.cube((s * 48 - 6, CYC + 2, -22), (12, 26, 30), "skin", scale=(8, 6), bias=-0.1)
    chest_pl = m.bone("plates_chest", chest, (0, CYC + 44, 0))
    for j, (zz, hh) in enumerate(((-22, 36), (3, 42), (28, 40))):
        plate(chest_pl, 0, CYC + 44 - (4 if j == 2 else 0), zz, 27, hh, 8)
    chest.locator("heart", (0, CYC, 0))

    # ---------------------------------------------------------------- neck and head
    NY = CYC + 6.0
    neck = m.bone("neck", chest, (0, NY, -32), rot=(3.0, 0, 0), zone=6)
    barrel(neck, -62, -24, NY, 37, 33, **hide(NY, 33, scale=(6, 4)))
    npl = m.bone("plates_neck", neck, (0, NY + 32, -46))
    plate(npl, 0, NY + 31, -44, 20, 24, 6)
    # old gills: half grown shut -- a dark socket with only a thread of colour left, still in
    # their own bones so they can gape when he strains
    for s in (1, -1):
        t = "l" if s > 0 else "r"
        for i in range(3):
            gz = -58 + i * 9.0
            gb = m.bone(f"gill_{t}{i + 1}", neck, (s * 37.0, NY, gz + 2), zone=7)
            H = 30.0
            x0 = 35.6 if s > 0 else -37.6
            gb.cube((x0, NY - H / 2 - 1, gz - 0.8), (2.0, H + 2, 5.0), "pit", rot=(-10, 0, 0), pivot=(s * 37.0, NY, gz + 2))
            xs = 36.4 if s > 0 else -38.0
            gb.cube((xs, NY - H * 0.42, gz + 0.4), (1.6, H * 0.84, 2.6), "gillscar", rot=(-10, 0, 0), pivot=(s * 37.0, NY, gz + 2),
                    axis=2, g=(gz + 0.4, gz + 3.0))
        neck.locator("gill_l" if s > 0 else "gill_r", (s * 38, NY, -47))

    ny, hz = NY, -62.0
    head = m.bone("head", neck, (0, ny, hz), rot=(HEAD_PITCH, 0, 0), zone=8)
    HS = dict(scale=(5, 4))
    K = 1.3

    def hc(x, y, zz, w, h, d, mat="skin", bone=None, **kw):
        kw = {**HS, **kw} if mat == "skin" else kw
        if "g" in kw and kw.get("axis", 1) == 1:
            kw["g"] = tuple(ny + v * K for v in kw["g"])
        return (bone or head).cube((x * K, ny + y * K, hz + zz * K), (w * K, h * K, d * K), mat, **kw)

    hc(-19, -12, -28, 38, 31, 34, back_y=(ny, ny + 23))              # braincase
    hc(-21.5, -13, -22, 43, 19, 24)                                   # jaw muscle
    hc(-16, -10, -50, 32, 24, 24)                                     # snout root
    hc(-13.5, -9, -66, 27, 20, 18)                                    # snout
    hc(-11.5, -8, -79, 23, 16, 14)                                    # muzzle
    hc(-9.5, -7, -85, 19, 11.5, 7)                                    # nose
    hc(-4, 13.5, -62, 8, 2.5, 32, bias=-0.15)                         # nasal ridge
    for s in (1, -1):
        hc(s * 21.0 - 4.5, 9, -33, 9, 8.5, 24, bias=-0.25)            # brow
        hc(s * 22.5 - 3.5, 15.5, -29, 7, 4.5, 16, bias=-0.25)
        hc(s * 22.0 - 2.5, -3.5, -34, 5, 5.5, 16, bias=-0.1)          # cheekbone
        hc(s * 6.5 - 1.5, 3.5, -85.6, 3, 2.4, 2, "pit")               # nostril
        eye(m, head, "eye_l" if s > 0 else "eye_r", s, s * 21.6 * K, ny + 4.2 * K, hz - 29.0 * K, size=4, depth=2)
        tooth_row(head, s * 12.2 * K, ny - 9.2 * K, hz - 78 * K, hz - 26 * K, 10, size=(2.8, 7.2, 3.6), jitter_seed=SEED + (1 if s > 0 else 2))
    for k in range(4):
        hc(-8.2 + k * 4.8, -13.8, -83.6, 2.2, 6.2, 2, "ivory", g=(-7.6, -13.8), axis=1, glow=0.3)
    hc(-12, -10.3, -80, 24, 1.4, 60, "mouth")
    jaw = m.bone("jaw", head, (0, ny - 10 * K, hz - 10 * K), rot=(JAW_REST, 0, 0), zone=8)
    hc(-18, -22, -26, 36, 11, 24, bone=jaw, belly_y=ny - 16 * K)
    hc(-14.5, -20.5, -50, 29, 10, 26, bone=jaw, belly_y=ny - 15 * K)
    hc(-12, -19, -68, 24, 9, 20, bone=jaw, belly_y=ny - 14 * K)
    hc(-10, -17.5, -81, 20, 7.5, 15, bone=jaw, belly_y=ny - 13 * K)
    hc(-10, -11.2, -78, 20, 1.4, 62, "mouth", bone=jaw)
    hc(-6, -10.2, -70, 12, 2.6, 50, "tongue", bone=jaw)
    for s in (1, -1):
        tooth_row(jaw, s * 10.6 * K, ny - 10.2 * K, hz - 76 * K, hz - 28 * K, 9, up=True, size=(2.8, 6.2, 3.6), jitter_seed=SEED + (5 if s > 0 else 6))
    for k in range(3):
        hc(-6 + k * 5.0, -10.2, -80.6, 2.2, 5.6, 2, "ivory", bone=jaw, g=(-10.2, -4.6), axis=1, glow=0.3)
    jaw.locator("mouth", (0, ny - 6 * K, hz - 70 * K))
    head.locator("muzzle", (0, ny - 5 * K, hz - 88 * K))
    head.locator("nose", (0, ny + 5 * K, hz - 86 * K))
    head.locator("throat", (0, ny - 5 * K, hz - 6 * K))

    # ---------------------------------------------------------------- forelimbs: his first true claws
    L1, p1, L2, p2, p3 = ARM
    for s in (1, -1):
        t = "l" if s > 0 else "r"
        x = s * 54.0
        zc = -14.0
        arm = m.bone(f"arm_{t}", chest, (x, SHOULDER_Y, zc), rot=(p1, 0, s * 10.0), zone=5)
        column(arm, x, zc, SHOULDER_Y - L1 - 4, SHOULDER_Y + 10, 24, 27, scale=(7, 5))
        arm.cube((x + s * 13 - 7, SHOULDER_Y - L1 * 0.74, zc - 17), (14, L1 * 0.62, 34), "skin", scale=(7, 5), bias=-0.08)       # deltoid
        arm.cube((x - 10, SHOULDER_Y - L1 * 0.62, zc - 26), (20, L1 * 0.5, 10), "skin", scale=(7, 5))                            # bicep
        ey = SHOULDER_Y - L1
        fore = m.bone(f"forearm_{t}", arm, (x, ey, zc), rot=(p2, 0, -s * 10.0))
        column(fore, x, zc, ey - L2 - 3, ey + 7, 20.5, 22.5, scale=(6, 4))
        column(fore, x, zc + 2, ey - 7, ey + 9, 23.5, 26, scale=(6, 4), bias=0.04)                                              # elbow
        fore.cube((x - 4.5, ey - 3, zc + 19), (9, 14, 9), "skin", scale=(4, 3), bias=-0.2)                                      # elbow spur
        fore.cube((x - 9, ey - L2 * 0.6, zc + 12), (18, L2 * 0.44, 9), "skin", scale=(6, 4), bias=-0.06)
        wy = ey - L2
        hand = m.bone(f"claw_{t}", fore, (x, wy, zc), rot=(p3, 0, 0))
        column(hand, x, zc - 1, wy - 5, wy + 6, 23, 25, scale=(6, 4), bias=0.06)                                               # wrist
        hand.cube((x - 25, wy - 10, zc - 28), (50, 11, 46), "skin", scale=(6, 4), belly_y=wy - 7)                             # palm
        hand.cube((x - 19, wy - 2, zc - 22), (38, 7, 34), "skin", scale=(6, 4))
        for k in range(4):                                                                                                     # fingers
            tx = x + (k - 1.5) * 11.6
            yaw = -(k - 1.5) * 10.0
            hand.cube((tx - 5, wy - 10, zc - 44), (10, 10, 19), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=(tx, wy - 10, zc - 27))
            hand.cube((tx - 4, wy - 2, zc - 41), (8, 4.5, 15), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=(tx, wy - 10, zc - 27))
        # the claws: long, hooked, ivory -- the thing the reference paintings linger on
        claws(hand, x, wy - 10, zc - 43, 17.4, n=4, size=(8, 11, 15), forward=-1, splay=15.0)
        for k in range(4):
            tx = x + (k - 1.5) * 11.6
            hand.cube((tx - 2.5, wy - 10, zc - 64), (5, 5, 7), "ivory", rot=(0, -(k - 1.5) * 15.0, 0), pivot=(tx, wy - 10, zc - 43),
                      g=(zc - 43, zc - 66), axis=2)
        hand.cube((x + s * 20 - 3.5, wy - 10, zc - 6), (7, 7, 13), "ivory", rot=(0, s * 55, 0), pivot=(x + s * 20, wy - 10, zc), g=(zc, zc - 14), axis=2)   # thumb claw
        hand.locator(f"claw_{t}", (x, wy - 10, zc - 30))

    # ---------------------------------------------------------------- belly and hips: stepping down to the ground
    mid = m.bone("mid", body, (0, 66, 30), zone=4)
    barrel(mid, 30, 68, 68, 48, 40, **hide(68, 40), flat_belly=0.05)
    barrel(mid, 66, 104, 54, 46, 37, **hide(54, 37), flat_belly=0.08)
    mid_pl = m.bone("plates_mid", mid, (0, 100, 66))
    for j, (zz, yy, hh) in enumerate(((52, 106, 38), (76, 96, 35), (98, 88, 32))):
        plate(mid_pl, 0, yy, zz, 26, hh, 8, sweep=20)

    hips = m.bone("hips", mid, (0, 36, 104), zone=3)
    barrel(hips, 102, 150, 38, 44, 34, **hide(38, 34), flat_belly=0.12)
    hips.cube((-32, 64, 106), (64, 9, 40), "skin", scale=(8, 6), bias=-0.1, back_y=(60, 76))
    hips_pl = m.bone("plates_hips", hips, (0, 72, 126))
    for j, (zz, hh) in enumerate(((121, 29), (143, 26))):
        plate(hips_pl, 0, 72 - 2 * j, zz, 24, hh, 7, sweep=20)

    # small webbed hind legs, splayed
    for s in (1, -1):
        t = "l" if s > 0 else "r"
        hx, hy, hzc = s * 40.0, 24.0, 126.0
        leg = m.bone(f"leg_{t}", hips, (hx, hy, hzc), rot=(0, -s * 40.0, s * 24.0), zone=3)
        # thigh runs outwards (+/-X) in its own frame
        xa, xb = (hx - 4, hx + 30) if s > 0 else (hx - 30, hx + 4)
        leg.cube((xa, hy - 9, hzc - 10), (xb - xa, 18, 20), "skin", scale=(5, 4))
        leg.cube((xa + (4 if s > 0 else 0), hy - 11, hzc - 7), (xb - xa - 4, 22, 14), "skin", scale=(5, 4), bias=-0.05)
        fx = hx + s * 30
        foot = m.bone(f"foot_{t}", leg, (fx, hy - 4, hzc), rot=(0, 0, -s * 24.0))
        # three toes and the web between them, fanned
        for k in range(3):
            yaw = (k - 1) * 24.0
            piv = (fx, hy - 12, hzc)
            xt0, xt1 = (fx, fx + 30) if s > 0 else (fx - 30, fx)
            foot.cube((xt0, hy - 13, hzc - 3), (xt1 - xt0, 5, 6), "skin", scale=(4, 3), rot=(0, yaw, 0), pivot=piv)
            xc0 = fx + 28 if s > 0 else fx - 34
            foot.cube((xc0, hy - 13, hzc - 2), (6, 4, 4), "ivory", rot=(0, yaw, 0), pivot=piv,
                      g=(fx + s * 28, fx + s * 34), axis=0)
        for k in range(2):
            yaw = (k - 0.5) * 24.0
            xw0, xw1 = (fx + 4, fx + 27) if s > 0 else (fx - 27, fx - 4)
            foot.cube((xw0, hy - 12.4, hzc - 6.5), (xw1 - xw0, 1.6, 13), "web", rot=(0, yaw, 0), pivot=(fx, hy - 12, hzc),
                      axis=0, g=(fx + s * 4, fx + s * 28), ray_axis=2, ragged=0.25)
        foot.locator(f"foot_{t}", (fx + s * 16, hy - 13, hzc))
        hips.locator(f"hip_{t}", (s * 30, 0, 140))

    # ---------------------------------------------------------------- tail: thick, on the ground
    par = hips
    z = 150.0
    tails = []
    tz = []
    for i, (ln, rw, rh) in enumerate(TAIL, start=1):
        cy = rh + 2.0
        tb = m.bone(f"tail{i}", par, (0, cy, z), zone=2 if i <= 3 else 1)
        barrel(tb, z - 8, z + ln, cy, rw, rh, **hide(cy, rh, scale=(7, 5)), flat_belly=0.14)
        pb = m.bone(f"plates_tail{i}", tb, (0, cy + rh, z + ln / 2))
        plate(pb, 0, cy + rh - 2, z + ln * 0.62, 22 - i * 1.2, 25 - i * 2.4, 6 if i < 4 else 5, sweep=20)
        tails.append((tb, cy, rh))
        tz.append(z)
        par = tb
        z += ln
    # the pale notch on the LEFT of the tail, just ahead of the knob
    t6, cy6, rh6 = tails[5]
    t6.cube((TAIL[5][1] - 3.0, cy6 - 4, tz[5] + 9), (4.4, 10, 12), "scar")
    t6.cube((TAIL[5][1] - 0.6, cy6 - 2, tz[5] + 11), (3.4, 6, 8), "scar")
    t6.locator("tail_notch", (TAIL[5][1] + 3, cy6, tz[5] + 15))

    # ---------------------------------------------------------------- the knob
    kcy = 32.0
    knob = m.bone("knob", par, (0, cy6, z), zone=0)
    R = dict(scale=(9, 8))
    for (z0, z1, rw, rh) in ((0, 10, 27, 22), (8, 24, 33, 27), (22, 56, 37, 30), (54, 70, 32.5, 26.5), (68, 80, 25, 20.5), (78, 86, 15.5, 13)):
        barrel(knob, z + z0, z + z1, kcy, rw, rh, mat="rock", **R)
    # rings that band it
    for zr in (27, 38, 49):
        knob.cube((-38.2, kcy - 13, z + zr), (76.4, 26, 3), "rock", scale=(9, 8), bias=-0.2)
        knob.cube((-15, kcy - 31.2, z + zr), (30, 62.4, 3), "rock", scale=(9, 8), bias=-0.2)
    knob.cube((-6, kcy - 6, z + 84), (12, 12, 4), "horn", axis=2, g=(z + 84, z + 89))               # the red socket on its end
    knob.locator("knob_core", (0, kcy, z + 40))
    for s in (1, -1):
        base = (s * 14.0, kcy + 27.0, z + 46.0)
        _, tip = spike(knob, base, (s * 0.3, 1.0, 0.2), 19.0, 12.0, mat="horn")
        knob.locator("horn_l" if s > 0 else "horn_r", tip)
    return m
