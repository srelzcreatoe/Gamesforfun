"""Block-built remakes, batch B: Chimpanzini Bananini, Chef Crabracadabra,
Bombardiro Crocodilo and Coccodrillo Tacorito. Clean voxel versions of the
characters that used to be auto-voxelised from the Higgsfield models: flat
bold colours, a few shades per material and big readable faces."""

import numpy as np

from blocky import design

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


def rrect_mask(m, cx, cy, a, b, r):
    """Every voxel (at any z) inside a rounded rectangle across x and y,
    centred on (cx, cy) with half sizes a and b and corner radius r."""
    xs, ys, _ = m._centres
    dx = np.maximum(np.abs(xs - cx) - (a - r), 0)
    dy = np.maximum(np.abs(ys - cy) - (b - r), 0)
    return (np.abs(xs - cx) <= a) & (np.abs(ys - cy) <= b) & (dx**2 + dy**2 <= r**2)


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


def top_pixels(m, x0, z0, rows, colours):
    """Pixel art seen from above: rows[0] is the frontmost row (at z0)."""
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch in colours:
                region = m.box_mask(x0 + c, 0, z0 + r, x0 + c, m.height - 1, z0 + r)
                m.paint_face(region, colours[ch], face="top")


# -- Chimpanzini Bananini --------------------------------------------------------


@design("ChimpanziniBananini", width=40, height=47, depth=20)
def chimpanzini_bananini(m):
    fur, fur_dark = "#5c2c1b", "#3f1b10"
    skin, skin_dark, skin_light = "#e39a62", "#c27643", "#f2b684"
    peel, peel_dark, peel_light = "#f8d53a", "#dcaa1c", "#ffe77e"
    flesh, flesh_dark = "#fff4c4", "#f1e19c"
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

    # The chimp's body inside the banana, and his shoulders.
    m.box(14, 15, 7, 25, 33, 13, fur)
    m.box(11, 28, 8, 13, 32, 11, fur, mirror=True)

    # The banana: a fat yellow pod, pointed at the bottom with a brown tip.
    radius = {12: 1.6, 13: 2.7, 14: 3.7, 15: 4.6, 16: 5.4, 17: 6.1, 18: 6.7, 19: 7.2, 20: 7.6,
              21: 7.9, 22: 8.2, 31: 8.2, 32: 8.0, 33: 7.8}
    pod = np.zeros(m.grid.shape, dtype=bool)
    for y in range(12, 34):
        rx = radius.get(y, 8.4)
        rz = max(1.5, rx * 0.72)
        pod |= layer(m, y) & (((xs - cx) / rx) ** 2 + ((zs - cz) / rz) ** 2 <= 1)
    m.mask(pod, peel)
    m.paint(pod & (ys < 17), peel_dark)
    m.paint(pod & (ys < 14), stem)
    m.paint_face(pod, flesh_dark, face="top")
    # The peeled front shows the fruit: a cream V with a light rim.
    for y in range(17, 34):
        hw = min(6, max(0, 1 + (y - 19) // 2))
        m.paint_face(m.box_mask(cx - hw - 1, y, 0, cx + hw, y, 19) & pod, peel_light, face="front")
        if hw:
            m.paint_face(m.box_mask(cx - hw, y, 0, cx + hw - 1, y, 19) & pod, flesh, face="front")

    # Strips of peel hang over his shoulders, front and back: yellow outside,
    # the cream inside turned outwards.
    for y in range(21, 35):
        t = (34 - y) / 13
        shift = int(round(4.6 * t**0.6))
        xa, xb = 8 - shift, 13 - shift
        if y == 22:
            xa, xb = xa + 1, xb - 1
        elif y == 21:
            xa, xb = xa + 2, xb - 2
        for z_out, z_in in ((4, 5), (15, 14)):
            m.box(xa, y, min(z_out, z_in), xb, y, max(z_out, z_in), peel, mirror=True)
            if 22 < y < 34:
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
    m.paint_face(m.box_mask(13, 43, 0, 26, 46, 19), fur_dark, face="top")
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
    m.box(15, 42, 3, 24, 42, 3, fur_dark, part=head)  # brow ridge
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
    m.mask(rounded_box_mask(m, 9, 36, 8, 12, 42, 11, 1.4), fur, part=head, mirror=True)
    m.paint(m.box_mask(10, 37, 0, 11, 41, 8) & m.surface("front"), skin, mirror=True)
    m.paint(m.box_mask(10, 38, 0, 10, 40, 8) & m.surface("front"), skin_dark, mirror=True)


# -- Chef Crabracadabra ----------------------------------------------------------


@design("ChefCrabracadabra", width=50, height=48, depth=16)
def chef_crabracadabra(m):
    red, red_dark, red_light, red_deep = "#e3342b", "#b41f22", "#f7624c", "#7e1218"
    apron, apron_shade = "#f7f7f4", "#d6d6d2"
    mouth = "#5a0c12"
    ys = m._centres[1]

    # Two stubby legs on round red feet.
    for x0, phase in ((18, 0), (28, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 12, 8), phase=phase)
        m.box(x0, 3, 6, x0 + 3, 11, 9, red, part=leg)
        m.paint(m.box_mask(x0, 6, 0, x0 + 3, 6, 15), red_dark)
        m.mask(rounded_box_mask(m, x0 - 1, 0, 3, x0 + 4, 3, 10, 1.2), red, part=leg)
        m.paint(m.box_mask(x0 - 1, 0, 0, x0 + 4, 0, 15), red_deep)

    # Little crab legs along the sides.
    for z in (5, 8, 11):
        m.box(13, 14, z, 16, 14, z, red_dark, mirror=True)
        m.box(12, 8, z, 12, 14, z, red_dark, mirror=True)
        m.voxel(12, 8, z, red_deep, mirror=True)

    # The carapace body.
    shell = rounded_box_mask(m, 16, 10, 3, 33, 27, 12, 2.5)
    m.mask(shell, red)
    m.paint(shell & (ys < 12), red_dark)
    m.paint_face(shell & (ys > 25), red_light, face="top")

    # A chef's white apron: a bib and skirt with a pocket, straps over the
    # shoulders and a tie round the waist with a bow at the back.
    m.box(19, 9, 2, 30, 19, 2, apron)
    m.box(21, 20, 2, 28, 22, 2, apron)
    m.box(19, 9, 2, 30, 9, 2, apron_shade)
    m.pixels(22, 12, ["pppppp", "p....p", "p....p", "pppppp"], {"p": apron_shade}, z=2)
    straps = [
        "s..........s",
        "s..........s",
        ".s........s.",
        ".s........s.",
        "..s......s..",
    ]
    m.pixels(19, 23, straps, {"s": apron})
    for face in ("left", "right", "back"):
        m.paint_face(m.box_mask(0, 18, 0, 49, 19, 15), apron_shade, face=face)
    m.paint_face(m.box_mask(18, 27, 0, 20, 27, 15), apron, face="top", mirror=True)
    m.box(23, 17, 13, 26, 20, 13, apron_shade)
    m.box(24, 18, 13, 25, 19, 13, apron)

    # A happy little mouth above the bib.
    m.pixels(22, 24, ["m....m", ".mmmm."], {"m": mouth})

    # A tall, puffy chef's hat on top of the shell.
    m.box(21, 28, 7, 28, 31, 12, apron)
    for x in (22, 24, 25, 27):
        m.paint(m.box_mask(x, 28, 0, x, 31, 15) & m.surface("front"), apron_shade)
    hat = rounded_box_mask(m, 20, 32, 6, 29, 39, 13, 2.2)
    for hx, hy in ((22.5, 39.6), (25, 40.6), (27.5, 39.6)):
        hat |= m.ellipsoid_mask(hx, hy, 9.5, 2.7, 2.2, 3.4)
    m.mask(hat, apron)
    m.paint(hat & (ys < 33), apron_shade)

    # Eyes on stalks: big and black with a white shine, red lids on top.
    m.box(16, 25, 5, 17, 31, 6, red, mirror=True)
    for x0 in (14, 31):
        m.mask(rounded_box_mask(m, x0, 32, 3, x0 + 4, 37, 7, 1.1), BLACK)
        m.box(x0, 37, 3, x0 + 4, 37, 7, red)
        m.paint(m.box_mask(x0, 37, 3, x0 + 4, 37, 3), red_dark)
        m.pixels(x0, 32, [".....", ".hh..", ".hh..", ".....", "....."], {"h": WHITE})

    # Big pincer claws held up high; the claws belong to the arms.
    claw = [
        "..ddd.......",
        ".#####......",
        "######......",
        "######...d..",
        "#####...###.",
        "#####...####",
        "#####...####",
        "######.#####",
        "############",
        "############",
        "############",
        ".##########.",
        "..########..",
        "...######...",
        "....####....",
    ]
    spots = [(2, 44), (4, 41), (2, 38), (9, 39), (6, 36)]
    for side, phase in ((0, 0), (1, 1)):
        rows = claw if side == 0 else [row[::-1] for row in claw]
        x0 = 1 if side == 0 else 37
        sx = (lambda x: x) if side == 0 else (lambda x: 49 - x)  # voxel columns
        fx = (lambda x: x) if side == 0 else (lambda x: 50 - x)  # positions
        arm = m.limb("Arm", pivot=(fx(15.5), 23.5, 8), phase=phase)
        m.line((fx(16.5), 23.5, 8), (fx(10.5), 27.5, 8), 1.8, red, part=arm)
        m.line((fx(10.5), 27.5, 8), (fx(7), 33.5, 8), 1.7, red, part=arm)
        m.sphere(fx(10.5), 27.5, 8, 2.1, red_dark, part=arm)
        pincer = extrude(m, flat_mask(m, x0, 47, rows, "#d"), 4, 11)
        m.mask(pincer, red, part=arm)
        m.paint(pincer & extrude(m, flat_mask(m, x0, 47, rows, "d"), 0, 15, bevel=False), red_deep)
        m.paint(pincer & (ys < 35), red_dark)
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

    # The grey bomber's fuselage: boxy with rounded corners, tapering up
    # towards the tail.
    hull = np.zeros(m.grid.shape, dtype=bool)
    for z in range(10, 45):
        t = max(0.0, (z - 30) / 14)
        section = rrect_mask(m, cx, 14.5 + 3 * t, 7 - 4.2 * t, 6 - 3.5 * t, 2.5 - t)
        hull |= section & (zs > z) & (zs < z + 1)
    m.mask(hull, metal)
    m.paint(hull & m.surface("bottom", 2), metal_dark)
    m.paint(hull & m.surface("top") & (np.abs(xs - cx) < 1.5), metal_light)
    for z in (23, 33):
        m.paint(hull & m.box_mask(0, 0, z, 55, 29, z), metal_dark)
    # Windows along both sides and a glass canopy on top.
    for z in range(17, 30, 3):
        m.paint(m.surface("left") & m.box_mask(18, 16, z, 27, 17, z + 1), glass)
        m.paint(m.surface("right") & m.box_mask(28, 16, z, 37, 17, z + 1), glass)
    m.mask(rounded_box_mask(m, 25, 20, 17, 30, 22, 24, 1.0), glass)
    m.paint(m.box_mask(25, 20, 20, 30, 22, 20) | m.box_mask(27, 22, 17, 28, 22, 24), metal_dark)

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
    panels = []
    for mask, px, phase in ((wing & (xs < 9), 9, 0), (wing & (xs > 47), 47, 1)):
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

    # The tail: a fin with a navy badge, and tailplanes.
    for y in range(19, 29):
        z0 = 36 + round((y - 19) * 0.7)
        m.box(27, y, z0, 28, y, 45, metal)
    m.paint(m.box_mask(27, 27, 0, 28, 28, 47), metal_dark)
    badge = [".nnn.", "nnwnn", "nwwwn", "nnwnn", ".nnn."]
    m.pixels(41, 21, badge, {"n": navy, "w": WHITE}, face="left")
    m.pixels(41, 21, badge, {"n": navy, "w": WHITE}, face="right")
    for x in range(17, 28):
        d = cx - (x + 0.5)
        m.box(x, 16, 39 + (1 if d > 8 else 0), x, 16, 46 - (1 if d > 9 else 0), metal, mirror=True)
    m.paint(m.box_mask(0, 16, 0, 55, 16, 47) & m.surface("bottom"), metal_dark)

    # Croc legs tucked under like landing gear, with cream claws.
    for z0, h in ((17, 9), (33, 9)):
        m.box(22, 2, z0, 25, h, z0 + 3, croc, mirror=True)
        m.box(21, 0, z0 - 2, 26, 2, z0 + 3, croc, mirror=True)
        m.box(21, 0, z0 - 2, 26, 0, z0 + 3, croc_dark, mirror=True)
        for x in (21, 23, 25):
            m.voxel(x, 0, z0 - 3, jaw, mirror=True)
        m.paint(m.box_mask(22, 5, z0, 25, 5, z0 + 3), croc_dark, mirror=True)

    # The croc head is the plane's nose: a long snout with a toothy grin,
    # eyes on top, and a leather flying cap with goggles.
    head = m.limb("Head", pivot=(cx, 14, 12))
    m.mask(rounded_box_mask(m, 21, 9, 7, 34, 21, 17, 2.5), croc, part=head)
    m.mask(rounded_box_mask(m, 21, 14, 0, 34, 18, 12, 1.3), croc, part=head)
    m.mask(rounded_box_mask(m, 21, 9, 1, 34, 11, 12, 1.0), jaw, part=head)
    m.paint(m.box_mask(21, 9, 0, 34, 9, 12), jaw_dark)
    m.box(22, 12, 1, 33, 13, 11, mouth, part=head)
    # Interlocking teeth round the front and sides of the mouth.
    for x in range(22, 34):
        m.voxel(x, 13 if x % 2 == 0 else 12, 1, tooth, part=head)
    for z in range(2, 12):
        m.voxel(21, 13 if z % 2 == 0 else 12, z, tooth, part=head, mirror=True)
    m.paint_face(m.box_mask(21, 18, 0, 34, 18, 12), croc_light, face="top")
    for x in (24, 31):
        m.box(x, 19, 1, x, 19, 2, croc, part=head)
        m.voxel(x, 19, 1, croc_dark, part=head)
    # Eyes on top.
    for x0 in (21, 30):
        m.box(x0, 19, 7, x0 + 4, 22, 10, croc, part=head)
        m.pixels(x0, 19, ["ddddd", "wwkhw", "wwkkw", "wwwww"], {"d": croc_dark, "w": WHITE, "k": BLACK, "h": WHITE}, z=6, part=head)
    # Leather flying cap with ear flaps, and goggles pushed up on it.
    cap = rounded_box_mask(m, 21, 21, 8, 34, 24, 17, 1.8)
    m.mask(cap, leather, part=head)
    m.paint(cap & (np.abs(xs - cx) < 1), leather_dark)
    m.box(20, 15, 11, 20, 22, 14, leather, part=head, mirror=True)
    m.box(20, 15, 11, 20, 15, 14, leather_dark, part=head, mirror=True)
    goggle = [".fff.", "fLLlf", "fLLLf", ".fff."]
    for x0 in (21, 30):
        m.pixels(x0, 23, goggle, {"f": frame, "L": lens, "l": lens_light}, z=7, part=head)
    m.box(26, 24, 7, 29, 25, 7, leather_dark, part=head)


# -- Coccodrillo Tacorito --------------------------------------------------------


@design("CoccodrilloTacorito", width=34, height=46, depth=22)
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
    ys, zs = m._centres[1], m._centres[2]

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
    for y in range(18, 34):
        hw = 1 + (y - 18) // 2
        m.box(cx - hw, y, 6, cx + hw - 1, y, 8, shell)
        m.box(cx - hw, y, 6, cx - hw, y, 8, shell_dark, mirror=True)
        step = (y - 18) // 2
        leaf = lettuce if step % 2 == 0 else lettuce_dark
        m.box(cx - hw - 1, y, 6, cx - hw - 1, y, 7, leaf, mirror=True)
        if step % 3 == 1 and y % 2 == 0:
            m.box(cx - hw - 2, y, 6, cx - hw - 1, y + 1, 7, tomato, mirror=True)
            m.voxel(cx - hw - 2, y, 6, tomato_dark, mirror=True)
    m.paint(m.box_mask(16, 21, 6, 17, 33, 6), shell_light)
    for x, y in ((12, 30), (15, 26), (19, 29), (21, 32), (18, 23)):
        m.paint(m.box_mask(x, y, 6, x, y, 6), shell_dark)
    ruffle = "LLTTlLMML"
    colours = {"L": lettuce, "l": lettuce_dark, "T": tomato, "M": meat}
    for i, ch in enumerate(ruffle):
        m.box(8 + i, 34, 5, 8 + i, 34, 9, colours[ch], mirror=True)
        if ch in "Ll":
            m.box(8 + i, 35, 6, 8 + i, 35, 8, colours[ch], mirror=True)

    # Big arms with grill stripes and chunky hands.
    for x0, phase in ((2, 0), (27, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2.5, 32, 12.5), phase=phase)
        right = int(x0 > cx)
        m.mask(rounded_box_mask(m, x0 - 1 + right, 27, 9, x0 + 4 + right, 34, 16, 2.0), tortilla, part=arm)
        m.box(x0, 22, 10, x0 + 4, 28, 15, tortilla, part=arm)
        m.mask(rounded_box_mask(m, x0 - 1, 14, 9, x0 + 5, 22, 16, 1.2), tortilla, part=arm)
        m.mask(rounded_box_mask(m, x0, 10, 10, x0 + 4, 14, 15, 0.9), tortilla_light, part=arm)
        thumb = x0 + 4 if x0 < cx else x0
        m.box(thumb, 12, 8, thumb, 13, 9, tortilla_light, part=arm)
        for y in (25, 18):
            m.paint(m.box_mask(x0 - 1, y, 0, x0 + 5, y + 1, 21), grill)

    # The croc head: a long snout with a toothy grin and eyes on top.
    head = m.limb("Head", pivot=(cx, 35, 13))
    m.mask(rounded_box_mask(m, 10, 35, 10, 23, 43, 18, 2.0), croc, part=head)
    snout = rounded_box_mask(m, 11, 35, 0, 22, 41, 11, 1.3)
    m.mask(snout, croc, part=head)
    m.paint(snout & (ys < 38), jaw)
    m.paint(snout & (ys > 38) & (ys < 39), mouth)
    for x in range(12, 22, 2):
        m.paint(m.box_mask(x, 38, 0, x, 38, 1), WHITE)
    for z in range(2, 11, 2):
        m.paint(m.box_mask(11, 38, z, 11, 38, z), WHITE, mirror=True)
    m.paint_face(snout & (ys > 40), croc_light, face="top")
    for x in (13, 20):
        m.box(x, 42, 1, x, 42, 2, croc, part=head)
        m.voxel(x, 42, 1, croc_dark, part=head)
    # Eyes.
    for x0 in (10, 19):
        m.box(x0, 41, 9, x0 + 4, 45, 12, croc, part=head)
        m.pixels(x0, 42, ["ddddd", "wwkhw", "wwkkw", "wwwww"], {"d": croc_dark, "w": WHITE, "k": BLACK, "h": WHITE}, z=8, part=head)
    # Scutes along the back of the head.
    for z in (13, 16):
        m.box(15, 44, z, 18, 44, z + 1, croc_dark, part=head)
    m.paint(m.box_mask(10, 35, 0, 23, 35, 21) & (zs > 11), croc_dark)
