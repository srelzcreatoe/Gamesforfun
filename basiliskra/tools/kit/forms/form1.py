"""
Basiliskra I -- the water.

A 30-block swimmer: flattened wedge skull, three crimson gill slits, two paddle fins, a ragged
crimson ribbon down the back (and under the tail), a fanned tail fin that ends in two bony
knobs.  Shoulders six blocks wide.  Proportions are measured from the reference paintings
(head 17 % of the length, body depth 15 %, gills ~55 % of the depth, tail fan 1.3 x the depth).

Bone contract:
  root > body > chest > head > jaw, eye_l, eye_r
                chest > gill_l1..3, gill_r1..3
                chest > fin_l > fin_l_tip, fin_r > fin_r_tip
                chest > ribbon0
                chest > seg1 > seg2 > ... > seg10 > tailfin
                seg{k} > ribbon{k}   (k = 1..10),   seg{k} > vribbon{k}   (k = 6..10)
Glow zones (tail to head): 0 tailfin, 1 seg9-10, 2 seg8, 3 seg6-7, 4 seg4-5, 5 seg1-3, 6 chest,
7 gills, 8 head.
"""
from __future__ import annotations

from kit import Model, barrel
from parts import eye, tooth_row, rnd

SEED = 101
CY = 36.0                      # spine height: belly at 0, back at 72 over the shoulders
SEG_LEN = 32.0
SEGS = [  # (half-width, half-height) for seg1..seg10
    (47.5, 36), (46.5, 35.5), (45, 34.5), (42.5, 33), (39.5, 31), (35.5, 28.5), (30.5, 25), (25, 21), (19, 17), (13.5, 13.5),
]
CHEST = (48.0, 36.0)
HEAD_LEN = 84.0
CHEST_Z = (-24.0, 24.0)


def ribbon_piece(b, z0, length, y, height, seed, down=False, thick=2.0, tines=3):
    """One stretch of the ragged ribbon: a low torn membrane with flame-like rays leaning
    towards the tail."""
    sgn = -1.0 if down else 1.0
    g = (y, y + sgn * height * 1.25)
    # membrane (its free edge is torn by the painter)
    if not down:
        b.cube((-thick / 2, y - 2, z0), (thick, height * 0.62 + 2, length), "fin",
               axis=1, g=(y, y + height * 0.62), ray_axis=2, ray_w=3.0, ragged=0.5)
    else:
        b.cube((-thick / 2, y - height * 0.62, z0), (thick, height * 0.62 + 2, length), "fin",
               axis=1, g=(y, y - height * 0.62), ray_axis=2, ray_w=3.0, ragged=0.5)
    for k in range(tines):
        j = rnd(seed, k, 5)
        h = height * (0.75 + 0.5 * j)
        w = length / tines * (1.15 + 0.35 * rnd(seed, k, 6))
        zc = z0 + (k + 0.55) * length / tines
        sweep = (26 + 16 * rnd(seed, k, 7)) * sgn
        piv = (0.0, y, zc)
        xo = (k % 2) * 0.6 - 0.3
        for f0, f1, wf in ((0.0, 0.34, 1.0), (0.34, 0.62, 0.66), (0.62, 0.84, 0.38), (0.84, 1.0, 0.18)):
            ww = max(w * wf, 1.0)
            z_lo = zc + w / 2 - ww                   # trailing edge fixed, leading edge retreats
            ya, yb = y + sgn * f0 * h, y + sgn * f1 * h
            b.cube((xo - (thick - 0.6) / 2, min(ya, yb), z_lo), (thick - 0.6, abs(yb - ya), ww), "fin",
                   rot=(-sweep, 0, 0), pivot=piv, axis=1, g=g, ray_axis=2, ray_w=3.0)


def build() -> Model:
    m = Model("basiliskra_i", "geometry.basiliskra.i", seed=SEED)
    m.meta.update(glow_y0=10.0, glow_y1=74.0, wetness=0.8, bounds_margin=6.0, form=1)

    root = m.bone("root", None, (0, 0, 0))
    body = m.bone("body", root, (0, CY, 0), zone=6)

    def hide(rw, rh, **kw):
        d = dict(back_y=(CY, CY + rh), belly_y=CY - rh * 0.42, scale=(10, 3), belly_scale=(30, 3), belly_style="striae", bias=0.07)
        d.update(kw)
        return d

    # ---------------------------------------------------------------- chest (the six-block shoulders)
    chest = m.bone("chest", body, (0, CY, 0), zone=6)
    cw, ch = CHEST
    barrel(chest, CHEST_Z[0], CHEST_Z[1] + 8, CY, cw, ch, **hide(cw, ch))
    barrel(chest, CHEST_Z[0] - 8, CHEST_Z[0] + 2, CY, cw - 4, ch - 4, **hide(cw - 4, ch - 4))      # neck: the skull is narrower
    chest.locator("back", (0, CY + ch, 0))
    chest.locator("belly", (0, 0, 0))
    chest.locator("spine_0", (0, CY + ch, 0))

    # gills: three tall crimson slits behind the skull, each in its own bone so the LEFT set can
    # seize open.  The slit is a crescent: a tall middle with the ends hooked towards the tail.
    for side in (1, -1):
        s = "l" if side > 0 else "r"
        for i in range(3):
            gz = CHEST_Z[0] + 5 + i * 10.0
            gb = m.bone(f"gill_{s}{i + 1}", chest, (side * cw, CY, gz + 2), zone=7)
            x0 = cw - 1.2 if side > 0 else -cw - 0.8
            H = 40.0
            # dark socket, then the crimson lamellae standing a little proud of it
            gb.cube((x0 - (0.0 if side > 0 else 0.4), CY - H / 2 - 1.5, gz - 1.0), (2.4, H + 3, 6.2), "pit",
                    rot=(-10, 0, 0), pivot=(side * cw, CY, gz + 2))
            xs = cw - 0.4 if side > 0 else -cw - 1.6
            gb.cube((xs, CY - H * 0.30, gz), (2.0, H * 0.60, 5.0), "gill", rot=(-10, 0, 0), pivot=(side * cw, CY, gz + 2), axis=2, g=(gz, gz + 4))
            gb.cube((xs, CY + H * 0.28, gz + 1.6), (2.0, H * 0.22, 3.6), "gill", rot=(-10, 0, 0), pivot=(side * cw, CY, gz + 2), axis=2, g=(gz + 1.6, gz + 5.2))
            gb.cube((xs, CY - H * 0.50, gz + 1.6), (2.0, H * 0.22, 3.6), "gill", rot=(-10, 0, 0), pivot=(side * cw, CY, gz + 2), axis=2, g=(gz + 1.6, gz + 5.2))
        chest.locator(f"gill_{s}", (side * (cw + 1), CY, CHEST_Z[0] + 17))

    # ---------------------------------------------------------------- head: a flattened wedge
    hz = CHEST_Z[0]
    head = m.bone("head", chest, (0, CY, hz), zone=8)
    HS = dict(scale=(6, 3))
    JAW_Y = CY - 4.0                                     # the mouth line
    # (z far, half-width, top y above CY, jaw depth below JAW_Y)
    WEDGE = [(-18, 43, 32, 25), (-34, 38, 28, 21.5), (-48, 32.5, 23.5, 18), (-60, 27, 19.5, 15), (-70, 21.5, 15.5, 12), (-78, 16, 12, 9.5), (-84, 11, 9, 7)]
    z_near = 4.0
    jaw = m.bone("jaw", head, (0, JAW_Y, hz - 10), rot=(4.0, 0, 0), zone=8)
    for k, (zf, hw, top, jd) in enumerate(WEDGE):
        z0, z1 = hz + zf, hz + z_near
        ln = z1 - z0
        # skull: a broad slab, a narrower crown over it, and a keel -- the top steps like armour
        head.cube((-hw, JAW_Y, z0), (2 * hw, (top + 4) * 0.62, ln), "skin", back_y=(CY, CY + 32), **HS)
        head.cube((-hw * 0.84, JAW_Y + (top + 4) * 0.62 - 1, z0 + 0.6), (2 * hw * 0.84, (top + 4) * 0.24 + 1, ln - 0.6), "skin", back_y=(CY, CY + 32), bias=-0.06, **HS)
        head.cube((-hw * 0.55, JAW_Y + (top + 4) * 0.86 - 1, z0 + 1.2), (2 * hw * 0.55, (top + 4) * 0.14 + 1, ln - 1.2), "skin", bias=-0.14, **HS)
        # lower jaw: a touch narrower, lighter underneath, its keel rising to the chin
        jw = hw - 2.0
        jaw.cube((-jw, JAW_Y - jd * 0.66, z0 + 0.4), (2 * jw, jd * 0.66 - 1.2, ln + 0.4), "skin", belly_y=JAW_Y - jd * 0.3, belly_style="striae", belly_scale=(18, 3), **HS)
        jaw.cube((-jw * 0.7, JAW_Y - jd, z0 + 1.0), (2 * jw * 0.7, jd * 0.34 + 1, ln - 0.4), "skin", belly_y=JAW_Y, belly_style="striae", belly_scale=(18, 3), **HS)
        z_near = zf + 0.0
    head.cube((-6, JAW_Y + 2, hz - 86.5), (12, 6, 3), "skin", **HS)                 # blunt snout tip
    for side in (1, -1):
        head.cube((side * 6 - 1.5, JAW_Y + 6.5, hz - 87), (3, 2, 2), "pit")         # nostril
        # brow ledge over the eye, and the eye itself: tiny, pale, high on the head
        head.cube((side * 27.2 - 3.0, CY + 13.0, hz - 61), (6, 4.5, 17), "skin", bias=-0.22, **HS)
        eye(m, head, "eye_l" if side > 0 else "eye_r", side, side * 27.4, CY + 7.6, hz - 56.0, size=4, depth=2)
        # teeth: small, many, interlocking -- upper row outside, lower row just inside it
        for a, b_, hw0, hw1, n in ((-80, -56, 12.5, 27.0, 7), (-56, -22, 27.0, 40.0, 8)):
            for i in range(n):
                t = (i + 0.5) / n
                zz = hz + a + (b_ - a) * t
                xx = side * (hw0 + (hw1 - hw0) * t)
                hh = 3.2 + 2.0 * rnd(SEED, i, int(a) + (5 if side > 0 else 9))
                head.cube((xx - 1.0, JAW_Y - hh, zz - 1.2), (2.0, hh, 2.4), "ivory", g=(JAW_Y, JAW_Y - hh), axis=1, glow=0.2)
                if i % 2 == 0:
                    jaw.cube((xx - side * 2.6 - 0.9, JAW_Y - 1.2, zz + 1.6), (1.8, hh * 0.8, 2.2), "ivory",
                             g=(JAW_Y - 1.2, JAW_Y - 1.2 + hh * 0.8), axis=1, glow=0.2)
    for k in range(3):
        head.cube((-5 + k * 4.0, JAW_Y - 3.4, hz - 85.5), (2, 3.4, 2), "ivory", g=(JAW_Y, JAW_Y - 3.4), axis=1, glow=0.2)
    head.cube((-9, JAW_Y - 0.6, hz - 80), (18, 1.2, 64), "mouth")
    jaw.cube((-8, JAW_Y - 2.2, hz - 76), (16, 1.2, 60), "mouth")
    jaw.cube((-4.5, JAW_Y - 1.4, hz - 66), (9, 1.8, 44), "tongue")
    jaw.locator("mouth", (0, JAW_Y - 1, hz - 70))
    head.locator("muzzle", (0, JAW_Y + 2, hz - 90))
    head.locator("nose", (0, JAW_Y + 8, hz - 88))
    head.locator("throat", (0, JAW_Y - 4, hz - 8))

    # ---------------------------------------------------------------- paddle fins
    for side in (1, -1):
        s = "l" if side > 0 else "r"
        px, py, pz = side * 40.0, 13.0, 16.0
        fin = m.bone(f"fin_{s}", chest, (px, py, pz), rot=(0, -side * 34.0, side * 30.0), zone=6)
        # the paddle lies along +/-X in its own frame: leading edge towards the head (-Z)
        def slab(x_in, x_out, zf, zb, y_thick, mat="skin", bone=fin, **kw):
            xa, xb = (px + x_in, px + x_out) if side > 0 else (px - x_out, px - x_in)
            return bone.cube((xa, py - y_thick / 2, pz + zf), (xb - xa, y_thick, zb - zf), mat, **kw)
        slab(-6, 14, -11, 13, 9, scale=(5, 4), bias=-0.05)            # shoulder root
        slab(10, 34, -16, 16, 6, scale=(5, 4))
        tip = m.bone(f"fin_{s}_tip", fin, (px + side * 34, py, pz))
        slab(30, 54, -19, 18, 4.5, bone=tip, scale=(5, 4))
        slab(50, 70, -17, 16, 3.5, bone=tip, scale=(5, 4))
        slab(66, 80, -12, 12, 3, bone=tip, scale=(5, 4))
        slab(76, 86, -6, 7, 2.6, bone=tip, scale=(5, 4))
        # the crimson trailing edge: a torn fringe of rays
        slab(8, 34, 15, 30, 2.2, "fin", axis=2, g=(pz + 15, pz + 31), ray_axis=0, ray_w=3.0, ragged=0.5)
        slab(30, 70, 16.5, 36, 2.0, "fin", bone=tip, axis=2, g=(pz + 16, pz + 37), ray_axis=0, ray_w=3.0, ragged=0.55)
        slab(66, 86, 10, 24, 1.8, "fin", bone=tip, axis=2, g=(pz + 10, pz + 25), ray_axis=0, ray_w=3.0, ragged=0.5)
        tip.locator(f"fin_{s}", (px + side * 80, py, pz + 6))

    # ---------------------------------------------------------------- trunk and tail
    rb0 = m.bone("ribbon0", chest, (0, CY + ch, 6), zone=6)
    ribbon_piece(rb0, CHEST_Z[0] + 22, CHEST_Z[1] - CHEST_Z[0] - 16, CY + ch - 1, 20, SEED + 300, tines=2)

    par = chest
    z = CHEST_Z[1]
    zone_of = {1: 5, 2: 5, 3: 5, 4: 4, 5: 4, 6: 3, 7: 3, 8: 2, 9: 1, 10: 1}
    for i, (rw, rh) in enumerate(SEGS, start=1):
        sb = m.bone(f"seg{i}", par, (0, CY, z), zone=zone_of[i])
        barrel(sb, z - 8, z + SEG_LEN, CY, rw, rh, **hide(rw, rh))
        sb.locator(f"spine_{i}", (0, CY + rh, z + SEG_LEN / 2))
        rb = m.bone(f"ribbon{i}", sb, (0, CY + rh, z + SEG_LEN / 2))
        ribbon_piece(rb, z, SEG_LEN, CY + rh - 1, 23 + 6 * rnd(SEED, i, 11) + (5 if 2 <= i <= 7 else 0) - (4 if i >= 9 else 0), SEED + 310 + i, tines=2)
        if i >= 6:
            vb = m.bone(f"vribbon{i}", sb, (0, CY - rh, z + SEG_LEN / 2))
            ribbon_piece(vb, z, SEG_LEN, CY - rh + 1, 13 + 3.0 * (i - 6), SEED + 330 + i, down=True, tines=2)
        par = sb
        z += SEG_LEN

    # ---------------------------------------------------------------- tail fin
    tf = m.bone("tailfin", par, (0, CY, z), zone=0)
    F = dict(axis=2, ray_axis=1, ray_w=3.0)
    gz = (z - 4, z + 68)
    tf.cube((-5, CY - 9, z - 6), (10, 18, 14), "skin", scale=(5, 4))                       # peduncle
    # fan: slabs that grow in height towards the trailing edge, thinning as they go
    fan = [(0, 8, 15, 3.2), (6, 8, 22, 3.0), (12, 8, 29, 2.8), (18, 8, 36, 2.6), (24, 8, 43, 2.4), (30, 8, 49, 2.3),
           (36, 8, 54, 2.2), (42, 8, 58, 2.1), (48, 7, 61, 2.0)]
    for zo, ln, hh, th in fan:
        tf.cube((-th / 2, CY - hh, z + zo), (th, 2 * hh, ln), "fin", g=gz, **F)
    # trailing edge: two lobes with a notch between, torn
    tf.cube((-0.9, CY + 14, z + 54), (1.8, 52, 12), "fin", g=gz, ragged=0.35, **F)
    tf.cube((-0.9, CY - 66, z + 54), (1.8, 52, 12), "fin", g=gz, ragged=0.35, **F)
    # the two bony knobs on the fin's tips
    for sgn in (1, -1):
        ky = CY + sgn * 64
        tf.cube((-3, ky - 4, z + 58), (6, 8, 8), "rock", scale=(4, 3))
        tf.cube((-2, ky - 2.5 + sgn * 2.5, z + 63), (4, 5, 5), "rock", scale=(4, 3))
        tf.locator("knob_u" if sgn > 0 else "knob_d", (0, ky, z + 65))
    # the pale notch: the seam closed across the tip of his tail and took a bite out of the upper
    # lobe.  The scar faces his LEFT; the same side carries it in Forms II and III.
    tf.cube((0.3, CY + 34, z + 55), (2.0, 12, 9), "scar")
    tf.cube((0.9, CY + 37, z + 58), (1.8, 7, 7), "scar")
    tf.locator("tail_notch", (2.5, CY + 40, z + 61))
    tf.locator("tail_tip", (0, CY, z + 66))
    return m
