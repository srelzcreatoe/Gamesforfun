"""Block-built remakes, batch B: Chimpanzini Bananini, Chef Crabracadabra,
Bombardiro Crocodilo and Coccodrillo Tacorito. Clean voxel versions of the
characters that used to be auto-voxelised from the Higgsfield models: flat
bold colours, a few shades per material and big readable faces."""

import numpy as np

from blocky import design, shade

WHITE = "#ffffff"
BLACK = "#141417"


# -- helpers ------------------------------------------------------------------


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1, radius):
    """A box (bounds included) with its edges rounded off by `radius`."""
    xs, ys, zs = m._centres
    cx = xs.clip(x0 + radius, x1 + 1 - radius)
    cy = ys.clip(y0 + radius, y1 + 1 - radius)
    cz = zs.clip(z0 + radius, z1 + 1 - radius)
    inside = (xs >= x0) & (xs <= x1 + 1) & (ys >= y0) & (ys <= y1 + 1) & (zs >= z0) & (zs <= z1 + 1)
    return inside & ((xs - cx) ** 2 + (ys - cy) ** 2 + (zs - cz) ** 2 <= radius**2)


def flat_mask(m, x0, y_top, rows, chars):
    """A 2D (x, y) mask of the characters in `chars` in pixel art whose top
    row is at y_top and whose first column is at x0."""
    flat = np.zeros((m.width, m.height), dtype=bool)
    for r, row in enumerate(rows):
        y = y_top - r
        for c, ch in enumerate(row):
            x = x0 + c
            if ch in chars and 0 <= x < m.width and 0 <= y < m.height:
                flat[x, y] = True
    return flat


def extrude(m, flat, z0, z1, bevel=True):
    """A 2D mask pushed from z0 to z1 (bounds included). With `bevel` the
    front and back layers shrink by a voxel all round, so the edges look
    rounded instead of sharp."""
    eroded = flat.copy()
    eroded[1:, :] &= flat[:-1, :]
    eroded[:-1, :] &= flat[1:, :]
    eroded[:, 1:] &= flat[:, :-1]
    eroded[:, :-1] &= flat[:, 1:]
    mask = np.zeros(m.grid.shape, dtype=bool)
    for z in range(z0, z1 + 1):
        edge = bevel and z1 - z0 >= 2 and z in (z0, z1)
        mask[:, :, z] = eroded if edge else flat
    return mask


def layer(m, y):
    ys = m._centres[1]
    return (ys > y) & (ys < y + 1)


def top_pixels(m, x0, z0, rows, colours, mask=None):
    """Pixel art seen from above: rows[0] is the frontmost row (at z0)."""
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch in colours:
                region = m.box_mask(x0 + c, 0, z0 + r, x0 + c, m.height - 1, z0 + r)
                if mask is not None:
                    region &= mask
                m.paint_face(region, colours[ch], face="top")


# -- Chimpanzini Bananini --------------------------------------------------------


@design("ChimpanziniBananini", width=40, height=48, depth=20)
def chimpanzini_bananini(m):
    fur, fur_dark, fur_light = "#5c2c1b", "#3f1b10", "#74402a"
    skin, skin_dark, skin_light = "#e39a62", "#c27643", "#f2b684"
    peel, peel_dark, peel_light = "#f8d53a", "#dcaa1c", "#ffe77e"
    flesh, flesh_dark = "#fbf2c2", "#eedf98"
    stem = "#5a3a1c"
    mouth = "#4a1a12"
    cx, cz = 20, 10
    xs, ys, zs = m._centres

    # Long chimp legs with big tan feet, three toes each.
    for x0, phase in ((14, 0), (22, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 17, 10), phase=phase)
        m.box(x0, 3, 8, x0 + 3, 16, 11, fur, part=leg)
        m.mask(rounded_box_mask(m, x0 - 1, 0, 5, x0 + 4, 3, 12, 0.9), skin, part=leg)
        m.box(x0 - 1, 0, 4, x0 + 4, 1, 5, skin, part=leg)
        m.paint(m.box_mask(x0 - 1, 0, 0, x0 + 4, 0, 19), skin_dark)
        for dx in (0, 1, 4, 5):
            m.paint(m.box_mask(x0 - 1 + dx, 1, 4, x0 - 1 + dx, 1, 4), skin_light)
        m.paint(m.box_mask(x0, 3, 0, x0 + 3, 3, 19) & m.surface("front"), fur_dark)

    # The chimp's body inside the banana, and his shoulders.
    m.box(14, 15, 7, 25, 33, 13, fur)
    m.box(11, 28, 8, 13, 32, 11, fur, mirror=True)

    # The banana: a fat yellow pod, pointed at the bottom with a brown tip.
    radius = {12: 1.6, 13: 2.7, 14: 3.7, 15: 4.6, 16: 5.4, 17: 6.1, 18: 6.7, 19: 7.2, 20: 7.6,
              21: 7.9, 22: 8.1, 23: 8.3, 24: 8.4}
    pod = np.zeros(m.grid.shape, dtype=bool)
    for y in range(12, 34):
        rx = radius.get(y, 8.4 if y < 31 else 8.4 - (y - 30) * 0.2)
        rz = max(1.5, rx * 0.72)
        pod |= layer(m, y) & (((xs - cx) / rx) ** 2 + ((zs - cz) / rz) ** 2 <= 1)
    m.mask(pod, peel)
    m.paint(pod & (np.abs(xs - cx) > 6.5), peel_dark)
    m.paint(pod & (ys < 16), peel_dark)
    m.paint(pod & (ys < 14), stem)
    # The peeled front shows the fruit: a cream V with a yellow rim.
    half = 1.2 + (ys - 17) * 0.36
    front = m.surface("front")
    m.paint(pod & front & (ys > 17) & (np.abs(xs - cx) < half + 1), peel_light)
    m.paint(pod & front & (ys > 17) & (np.abs(xs - cx) < half), flesh)
    m.paint(pod & front & (ys > 17) & (np.abs(xs - cx) < half) & (ys < 20), flesh_dark)
    m.paint_face(pod, flesh_dark, face="top")

    # Four strips of peel hanging over his shoulders, front and back: yellow
    # outside, cream inside, turned outwards.
    for y in range(21, 35):
        t = (34 - y) / 13
        shift = int(round(4.2 * t))
        xa, xb = 8 - shift, 13 - shift
        if y <= 22:
            xa, xb = xa + 1, xb - 1
        for z_out, z_in in ((4, 5), (15, 14)):
            m.box(xa, y, min(z_out, z_in), xb, y, max(z_out, z_in), peel, mirror=True)
            if y > 22 and y < 34:
                m.box(xa + 1, y, z_out, xb - 1, y, z_out, flesh, mirror=True)
    m.box(8, 34, 4, 13, 35, 15, peel, mirror=True)
    m.box(9, 35, 5, 12, 35, 14, peel_light, mirror=True)

    # Long arms hanging at his sides with tan hands.
    for x0, phase in ((8, 0), (29, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 32, 10), phase=phase)
        m.box(x0, 17, 8, x0 + 2, 33, 11, fur, part=arm)
        m.mask(rounded_box_mask(m, x0, 12, 7, x0 + 2, 16, 11, 0.8), skin, part=arm)
        m.paint(m.box_mask(x0, 12, 0, x0 + 2, 12, 19), skin_dark)
        thumb = x0 + 2 if x0 < cx else x0
        m.box(thumb, 14, 6, thumb, 15, 7, skin, part=arm)

    # The big round head: dark fur, a tan face with a toothy grin, big ears.
    head = m.limb("Head", pivot=(cx, 33, 10))
    m.mask(rounded_box_mask(m, 13, 33, 4, 26, 45, 15, 2.5), fur, part=head)
    m.paint_face(m.box_mask(13, 43, 0, 26, 47, 19), fur_dark, face="top")
    face = [
        "..ssssssssss..",
        "..shkksshkks..",
        "..skkksskkks..",
        "..skkksskkks..",
        ".ssssssssssss.",
        ".ssssssssssss.",
        ".ssssssssssss.",
        "..ssssssssss..",
        "...ssssssss...",
    ]
    m.pixels(13, 33, face, {"s": skin, "k": BLACK, "h": WHITE})
    m.pixels(13, 42, ["...ssss.ssss.."[:14]], {"s": skin})
    # Brow ridge.
    m.box(15, 42, 3, 24, 42, 3, fur_dark, part=head)
    # The muzzle sticks out, with nostrils and a grin.
    m.mask(rounded_box_mask(m, 15, 33, 1, 24, 37, 4, 1.0), skin_light, part=head)
    muzzle = [
        "...n..n...",
        "..........",
        ".m......m.",
        "..mwwwwm..",
        "...mmmm...",
    ]
    m.pixels(15, 33, muzzle, {"n": skin_dark, "m": mouth, "w": WHITE})
    # Round ears.
    ear = rounded_box_mask(m, 9, 36, 8, 12, 42, 11, 1.4)
    m.mask(ear, fur, part=head, mirror=True)
    m.paint(m.box_mask(10, 37, 0, 11, 41, 8) & m.surface("front"), skin, mirror=True)
    m.paint(m.box_mask(10, 38, 0, 10, 40, 8) & m.surface("front"), skin_dark)
    m.paint(m.box_mask(29, 38, 0, 29, 40, 8) & m.surface("front"), skin_dark)


# -- Chef Crabracadabra ----------------------------------------------------------


@design("ChefCrabracadabra", width=46, height=48, depth=16)
def chef_crabracadabra(m):
    red, red_dark, red_light, red_deep = "#e3342b", "#b41f22", "#f7624c", "#7e1218"
    apron, apron_shade = "#f7f7f4", "#d6d6d2"
    mouth = "#5a0c12"
    cx = 23
    xs, ys, zs = m._centres

    # Two stubby legs on round red feet.
    for x0, phase in ((16, 0), (26, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 12, 8), phase=phase)
        m.box(x0, 3, 6, x0 + 3, 11, 9, red, part=leg)
        m.paint(m.box_mask(x0, 6, 0, x0 + 3, 6, 15), red_dark)
        m.mask(rounded_box_mask(m, x0 - 1, 0, 3, x0 + 4, 3, 10, 1.2), red, part=leg)
        m.paint(m.box_mask(x0 - 1, 0, 0, x0 + 4, 0, 15), red_deep)

    # Little crab legs along the sides.
    for z in (5, 8, 11):
        m.line((15, 13, z + 0.5), (10.5, 11, z + 0.5), 0.75, red_dark, mirror=True)
        m.line((10.5, 11, z + 0.5), (9.5, 7, z + 0.5), 0.75, red_dark, mirror=True)

    # The carapace body.
    shell = rounded_box_mask(m, 14, 10, 3, 31, 27, 12, 2.5)
    m.mask(shell, red)
    m.paint(shell & (ys < 12), red_dark)
    m.paint_face(shell & (ys > 25), red_light, face="top")

    # A chef's white apron: a bib and skirt with a pocket, straps over the
    # shoulders and a tie round the waist with a bow at the back.
    m.box(17, 9, 2, 28, 19, 2, apron)
    m.box(19, 20, 2, 26, 22, 2, apron)
    m.box(17, 9, 2, 28, 9, 2, apron_shade)
    m.pixels(20, 12, ["pppppp", "p....p", "p....p", "pppppp"], {"p": apron_shade}, z=2)
    straps = [
        "s......s",
        "s......s",
        ".s....s.",
        ".s....s.",
        "..s..s..",
    ]
    m.pixels(17, 23, [row.replace("s", "a") for row in straps], {"a": apron}, face="front")
    m.pixels(17, 23, ["." * 8] * 0 + straps, {"s": apron})
    for face in ("left", "right", "back"):
        m.paint_face(m.box_mask(0, 18, 0, 45, 19, 15), apron_shade, face=face)
    m.paint_face(m.box_mask(16, 27, 0, 18, 27, 15), apron, face="top")
    m.paint_face(m.box_mask(27, 27, 0, 29, 27, 15), apron, face="top")
    m.box(21, 17, 13, 24, 20, 13, apron_shade)
    m.box(22, 18, 13, 23, 19, 13, apron)

    # A happy little mouth above the bib.
    m.pixels(20, 24, ["m....m", ".mmmm."], {"m": mouth})

    # A tall chef's hat on top of the shell.
    m.box(19, 28, 8, 26, 30, 12, apron_shade)
    hat = rounded_box_mask(m, 18, 31, 7, 27, 38, 13, 2.2)
    hat |= m.ellipsoid_mask(20, 38.5, 10, 2.6, 2.2, 3.2) | m.ellipsoid_mask(26, 38.5, 10, 2.6, 2.2, 3.2)
    hat |= m.ellipsoid_mask(23, 39.5, 10, 2.8, 2.2, 3.2)
    m.mask(hat, apron)
    m.paint(hat & (ys < 32), apron_shade)

    # Eyes on stalks: big and black with a white shine, red lids on top.
    for x0 in (16, 25):
        m.box(x0 + 2, 28, 5, x0 + 3, 31, 6, red)
        m.mask(rounded_box_mask(m, x0, 32, 3, x0 + 4, 36, 7, 1.0), BLACK)
        m.box(x0, 36, 3, x0 + 4, 36, 7, red)
        m.pixels(x0, 32, [".....", ".hh..", ".hh..", "....."], {"h": WHITE})

    # Big pincer claws raised high on the arms.
    claw = [
        "..ddd.......",
        ".d###d......",
        "######......",
        "######...dd.",
        "######..d##.",
        "######..###.",
        "#######.###.",
        "#######.####",
        "############",
        "############",
        "############",
        ".##########.",
        "..########..",
        "....####....",
    ]
    spots = [(1, 42), (3, 39), (2, 36), (9, 37), (5, 35)]
    for side, phase in ((0, 0), (1, 1)):
        rows = claw if side == 0 else [row[::-1] for row in claw]
        x0 = 1 if side == 0 else 33
        sx = (lambda x: x) if side == 0 else (lambda x: 45 - x)
        arm = m.limb("Arm", pivot=(sx(13.5) + (1 if side else 0), 23.5, 8), phase=phase)
        m.line((sx(14), 23, 8), (sx(9.5), 26.5, 8), 1.8, red, part=arm)
        m.line((sx(9.5), 26.5, 8), (sx(7), 32.5, 8), 1.7, red, part=arm)
        m.sphere(sx(9.5), 26.5, 8, 2.1, red_dark, part=arm)
        body = extrude(m, flat_mask(m, x0, 46, rows, "#d"), 4, 11)
        m.mask(body, red, part=arm)
        m.paint(body & extrude(m, flat_mask(m, x0, 46, rows, "d"), 0, 15, bevel=False), red_deep)
        m.paint(body & (ys < 35), red_dark)
        for x, y in spots:
            m.paint(m.box_mask(sx(x), y, 0, sx(x), y, 15) & m.surface("front"), red_light)


# -- Bombardiro Crocodilo --------------------------------------------------------


@design("BombardiroCrocodilo", width=56, height=30, depth=48)
def bombardiro_crocodilo(m):
    cx = 28
    metal, metal_dark, metal_light, metal_deep = "#8f969e", "#646b73", "#b7bec5", "#474d55"
    croc, croc_dark, croc_light = "#4dad3b", "#2f7f27", "#7fcb52"
    jaw, jaw_dark = "#ece6a6", "#cfc57c"
    mouth, tooth = "#6a1a1f", WHITE
    leather, leather_dark = "#8b4a22", "#5f3014"
    frame, lens, lens_light = "#a4acb4", "#5fb0f0", "#d4eeff"
    bomb, bomb_dark, band = "#5a6b30", "#3d4a20", "#f2c230"
    blade, tip = "#26262b", "#f4b41a"
    navy, glass = "#27345a", "#33485e"
    xs, ys, zs = m._centres

    # The grey bomber's fuselage, tapering up towards the tail.
    for z in range(10, 45):
        r = 6.5 if z < 30 else 6.5 - (z - 30) * 0.3
        cy = 14.5 if z < 30 else 14.5 + (z - 30) * 0.18
        m.cylinder(cx, cy, z, r, 1, metal, axis="Z")
    hull = m.grid == m.colour(metal)
    m.paint(hull & m.surface("bottom", 2), metal_dark)
    m.paint(hull & m.surface("top") & (np.abs(xs - cx) < 1.5), metal_light)
    for z in (22, 33):
        m.paint(hull & m.box_mask(0, 0, z, 55, 29, z), metal_dark)
    # Windows along both sides.
    for z in range(17, 30, 3):
        m.paint(m.surface("left") & m.box_mask(0, 16, z, 27, 17, z + 1), glass)
        m.paint(m.surface("right") & m.box_mask(28, 16, z, 55, 17, z + 1), glass)

    # Straight wings: the inner part with the engines stays put, the outer
    # panels flap.
    wing = np.zeros(m.grid.shape, dtype=bool)
    for x in range(0, 28):
        d = cx - (x + 0.5)
        lead, trail = 17 + d * 0.1, 28 - d * 0.12
        if d > 23:
            lead, trail = lead + (d - 23) * 0.8, trail - (d - 23) * 0.8
        wing |= m.box_mask(x, 13, round(lead), x, 14, round(trail))
    wing |= wing[::-1, :, :]
    m.mask(wing, metal)
    m.paint(wing & (ys < 14), metal_dark)
    m.paint(wing & m.surface("top") & (zs < 19), metal_light)
    left_panel = wing & (xs < 9)
    right_panel = wing & (xs > 47)
    panels = []
    for mask, px, phase in ((left_panel, 9, 0), (right_panel, 47, 1)):
        part = m.limb("Wing", pivot=(px, 14, 22.5), phase=phase)
        m.assign(mask, part)
        panels.append(part)
    # Star roundels on the outer panels.
    roundel = [".nnn.", "nnwnn", "nwwwn", "nnwnn", ".nnn."]
    top_pixels(m, 2, 20, roundel, {"n": navy, "w": WHITE})
    top_pixels(m, 49, 20, roundel, {"n": navy, "w": WHITE})

    # Bombs hang under the wings (the outer ones flap with their panel).
    def drop_bomb(bx, part):
        m.cylinder(bx, 8.5, 22.5, 1.6, 3.5, bomb, axis="Y", part=part)
        m.ellipsoid(bx, 8.5, 22.5, 1.6, 1.8, 1.6, bomb, part=part)
        m.paint(m.cylinder_mask(bx, 10, 22.5, 1.8, 1, axis="Y"), band)
        m.box(bx - 0.5, 12, 22, bx - 0.5, 12, 22, metal_deep, part=part)
        m.paint(m.box_mask(bx - 2, 6, 0, bx + 1, 7, 47) & (m.grid == m.colour(bomb)), bomb_dark)

    drop_bomb(4.5, panels[0])
    drop_bomb(51.5, panels[1])
    drop_bomb(17.5, 0)
    drop_bomb(38.5, 0)

    # Engines on the wings with four-blade propellers.
    for ex, phase in ((12, 0), (44, 1)):
        m.cylinder(ex, 14, 12, 2.6, 17, metal, axis="Z")
        m.paint(m.cylinder_mask(ex, 14, 12, 2.7, 1, axis="Z"), metal_deep)
        m.paint(m.cylinder_mask(ex, 14, 27, 2.7, 2, axis="Z"), metal_dark)
        m.paint_face(m.box_mask(ex - 1, 16, 13, ex, 16, 26), metal_light, face="top")
        prop = m.limb("Prop", pivot=(ex, 14, 11), phase=phase, axis="Z")
        m.box(ex - 1, 13, 10, ex, 14, 11, tip, part=prop)
        m.box(ex - 1, 15, 11, ex, 19, 11, blade, part=prop)
        m.box(ex - 1, 8, 11, ex, 12, 11, blade, part=prop)
        m.box(ex - 6, 13, 11, ex - 2, 14, 11, blade, part=prop)
        m.box(ex + 1, 13, 11, ex + 5, 14, 11, blade, part=prop)
        m.box(ex - 1, 20, 11, ex, 20, 11, tip, part=prop)
        m.box(ex - 1, 7, 11, ex, 7, 11, tip, part=prop)
        m.box(ex - 7, 13, 11, ex - 7, 14, 11, tip, part=prop)
        m.box(ex + 6, 13, 11, ex + 6, 14, 11, tip, part=prop)

    # The tail: a fin with a navy badge and tailplanes.
    for y in range(19, 29):
        z0 = 36 + round((y - 19) * 0.7)
        m.box(27, y, z0, 28, y, 45, metal)
    m.paint(m.box_mask(27, 27, 0, 28, 28, 47), metal_dark)
    badge = [".nnnnn.", "nnnwnnn", "nnnwnnn", "nwwwwwn", "nnnwnnn", "nnnwnnn", ".nnnnn."]
    m.pixels(38, 20, badge, {"n": navy, "w": WHITE}, face="left")
    m.pixels(38, 20, badge, {"n": navy, "w": WHITE}, face="right")
    for x in range(17, 28):
        d = cx - (x + 0.5)
        m.box(x, 16, 39 + (1 if d > 8 else 0), x, 16, 46 - (1 if d > 9 else 0), metal, mirror=True)
    m.paint(m.box_mask(0, 16, 0, 55, 16, 47) & m.surface("bottom"), metal_dark)

    # Croc legs tucked under like landing gear, with cream claws.
    for z0, h in ((12, 9), (31, 8)):
        m.box(22, 2, z0, 25, h, z0 + 3, croc, mirror=True)
        m.box(21, 0, z0 - 2, 26, 2, z0 + 3, croc, mirror=True)
        m.box(21, 0, z0 - 2, 26, 0, z0 + 3, croc_dark, mirror=True)
        for x in (21, 23, 25):
            m.voxel(x, 0, z0 - 3, jaw, mirror=True)
        m.paint(m.box_mask(22, 5, z0, 25, 5, z0 + 3), croc_dark, mirror=True)

    # The croc head is the plane's nose: a toothy grin, eyes on top, and a
    # leather flying cap with goggles.
    head = m.limb("Head", pivot=(cx, 14, 14))
    m.mask(rounded_box_mask(m, 20, 9, 5, 35, 22, 16, 2.5), croc, part=head)
    m.mask(rounded_box_mask(m, 21, 14, 0, 34, 18, 10, 1.4), croc, part=head)
    m.mask(rounded_box_mask(m, 21, 9, 1, 34, 11, 10, 1.1), jaw, part=head)
    m.paint(m.box_mask(21, 9, 0, 34, 9, 10), jaw_dark)
    m.box(22, 12, 1, 33, 13, 9, mouth, part=head)
    # Interlocking teeth round the front and sides of the mouth.
    for x in range(22, 34):
        if x % 2 == 0:
            m.voxel(x, 13, 1, tooth, part=head)
        else:
            m.voxel(x, 12, 1, tooth, part=head)
    for z in range(2, 10):
        y = 13 if z % 2 == 0 else 12
        m.voxel(21, y, z, tooth, part=head, mirror=True)
    m.clear(m.box_mask(21, 12, 1, 21, 13, 1), mirror=True)
    m.paint_face(m.box_mask(21, 18, 0, 34, 18, 10), croc_light, face="top")
    # Nostril bumps.
    for x in (24, 31):
        m.box(x, 19, 1, x, 19, 2, croc, part=head)
        m.voxel(x, 19, 1, croc_dark, part=head)
    # Eyes on top.
    for x0 in (21, 30):
        m.box(x0, 18, 6, x0 + 4, 22, 9, croc, part=head)
        m.pixels(x0, 18, ["ddddd", "wwkhw", "wwkkw", "wwwww", "....."], {"d": croc_dark, "w": WHITE, "k": BLACK, "h": WHITE}, z=5, part=head)
    # Leather flying cap with ear flaps and goggles.
    cap = rounded_box_mask(m, 20, 22, 7, 35, 25, 16, 1.8)
    m.mask(cap, leather, part=head)
    m.paint(cap & (np.abs(xs - cx) < 1), leather_dark)
    m.box(20, 15, 11, 20, 22, 14, leather, part=head, mirror=True)
    m.box(20, 15, 11, 20, 15, 14, leather_dark, part=head, mirror=True)
    goggle = [".fff.", "fLLlf", "fLLLf", ".fff."]
    for x0 in (21, 30):
        m.pixels(x0, 23, goggle, {"f": frame, "L": lens, "l": lens_light}, z=6, part=head)
    m.box(26, 24, 6, 29, 24, 6, leather_dark, part=head)


# -- Coccodrillo Tacorito --------------------------------------------------------


@design("CoccodrilloTacorito", width=34, height=48, depth=22)
def coccodrillo_tacorito(m):
    tortilla, tortilla_dark, tortilla_light = "#dea75e", "#bf8840", "#ecc07e"
    grill = "#6a3d20"
    shell, shell_dark, shell_light = "#f6c84c", "#d9a22e", "#ffe083"
    lettuce, lettuce_dark = "#5cbf3c", "#2f8f2a"
    tomato, tomato_dark = "#e23a2e", "#a82320"
    meat = "#7b4424"
    croc, croc_dark, croc_light = "#3fa83a", "#277a26", "#72c94f"
    jaw = "#c8df5c"
    mouth = "#6a1a1f"
    cx = 17
    xs, ys, zs = m._centres

    # Strong legs with grill stripes and big flat feet.
    for x0, phase in ((10, 0), (19, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2.5, 18, 12.5), phase=phase)
        m.box(x0, 3, 10, x0 + 4, 17, 15, tortilla, part=leg)
        m.mask(rounded_box_mask(m, x0 - 1, 0, 7, x0 + 5, 3, 16, 1.0), tortilla, part=leg)
        m.paint(m.box_mask(x0 - 1, 0, 0, x0 + 5, 0, 21), tortilla_dark)
        for y in (6, 12):
            m.paint(m.box_mask(x0, y, 0, x0 + 4, y + 1, 21), grill)

    # A muscular tortilla torso.
    m.mask(rounded_box_mask(m, 9, 17, 9, 24, 26, 16, 1.5), tortilla)
    m.mask(rounded_box_mask(m, 7, 24, 8, 26, 34, 17, 2.2), tortilla)
    m.box(14, 33, 11, 19, 36, 15, tortilla)

    # The taco shell on his front, point down, stuffed with lettuce,
    # tomato and meat spilling out of the edges.
    taco = np.zeros(m.grid.shape, dtype=bool)
    for y in range(18, 34):
        hw = 1.3 + (y - 18) * 0.5
        taco |= layer(m, y) & (np.abs(xs - cx) < hw) & (zs > 5) & (zs < 9)
    m.mask(taco, shell)
    edge = taco & ~(np.abs(xs - cx) < 0.8 + (ys - 18.5) * 0.5 - 1.0)
    m.paint(edge, shell_dark)
    m.paint(taco & m.surface("front") & (np.abs(xs - cx) < 2) & (ys > 22), shell_light)
    for x, y in ((14, 28), (19, 25), (17, 21), (13, 31), (21, 30)):
        m.paint(m.box_mask(x, y, 0, x, y, 7) & m.surface("front"), shell_dark)
    for side in (-1, 1):
        for i, y in enumerate(range(20, 34, 2)):
            hw = 1.3 + (y - 18) * 0.5
            x = cx + side * hw
            xi = int(np.floor(x)) if side > 0 else int(np.floor(x - 1))
            kind = i % 3
            if kind == 0:
                m.box(xi, y, 6, xi, y + 1, 8, tomato)
                m.voxel(xi, y, 6, tomato_dark)
            elif kind == 1:
                m.box(xi, y, 6, xi, y + 1, 7, lettuce)
                m.voxel(xi + side, y + 1, 6, lettuce, )
            else:
                m.box(xi, y, 6, xi, y, 8, lettuce_dark)
                m.voxel(xi, y + 1, 7, meat)
    for i, x in enumerate(range(8, 26)):
        colour = (lettuce, tomato, lettuce_dark, lettuce, meat, tomato)[i % 6]
        m.box(x, 34, 5, x, 34 + (i % 2), 9, colour)

    # Big arms with grill stripes and chunky hands.
    for x0, phase in ((2, 0), (27, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2.5, 32, 12.5), phase=phase)
        m.mask(rounded_box_mask(m, x0 - 1, 27, 9, x0 + 5, 34, 16, 2.0), tortilla, part=arm)
        m.box(x0, 22, 10, x0 + 4, 28, 15, tortilla, part=arm)
        m.mask(rounded_box_mask(m, x0 - 1, 14, 9, x0 + 5, 22, 16, 1.2), tortilla, part=arm)
        m.mask(rounded_box_mask(m, x0, 10, 10, x0 + 4, 14, 15, 0.9), tortilla_light, part=arm)
        thumb = x0 + 4 if x0 < cx else x0
        m.box(thumb, 12, 8, thumb, 13, 9, tortilla_light, part=arm)
        for y in (25, 18):
            m.paint(m.box_mask(x0 - 1, y, 0, x0 + 5, y + 1, 21), grill)

    # The croc head: a long snout with a toothy grin and eyes on top.
    head = m.limb("Head", pivot=(cx, 35, 13))
    m.mask(rounded_box_mask(m, 10, 35, 9, 23, 45, 19, 2.0), croc, part=head)
    snout = rounded_box_mask(m, 10, 35, 1, 23, 41, 10, 1.5)
    m.mask(snout, croc, part=head)
    m.paint(snout & (ys < 38), jaw)
    m.paint((m.grid > 0) & (ys > 38) & (ys < 39) & (zs < 11), mouth)
    for x in range(11, 23):
        if x % 2 == 1:
            m.paint(m.box_mask(x, 38, 0, x, 38, 1), WHITE)
    for z in range(2, 10):
        if z % 2 == 0:
            m.paint(m.box_mask(10, 38, z, 10, 38, z), WHITE, mirror=True)
    m.paint_face(snout & (ys > 40), croc_light, face="top")
    for x in (12, 21):
        m.box(x, 42, 2, x, 42, 3, croc, part=head)
        m.voxel(x, 42, 2, croc_dark, part=head)
    # Eyes.
    for x0 in (10, 19):
        m.box(x0, 42, 8, x0 + 4, 46, 12, croc, part=head)
        m.pixels(x0, 42, ["ddddd", "wwkhw", "wwkkw", "wwwww", "....."], {"d": croc_dark, "w": WHITE, "k": BLACK, "h": WHITE}, z=7, part=head)
    # Scutes along the back of the head.
    for z in (13, 16):
        m.box(15, 46, z, 18, 46, z + 1, croc_dark, part=head)
