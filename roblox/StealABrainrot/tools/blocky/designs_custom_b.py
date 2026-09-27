"""Block-built brainrots, custom batch B: Italian brainrots made from classic
Roblox things (the Korblox leg, the Linked Sword, lag, the builder, the
Valkyrie Helm) and Italian food (pizza, cannoli, gelato, lasagna, meatballs)."""

import math

import numpy as np

from blocky import design

BLACK = "#1b1b1f"
WHITE = "#ffffff"


# -- helpers -------------------------------------------------------------------


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1, r):
    """A box (inclusive voxel bounds) with its edges and corners rounded off by r."""
    xs, ys, zs = m._centres
    rx, ry, rz = (r, r, r) if not isinstance(r, tuple) else r
    dx = np.maximum(0, np.maximum((x0 + rx) - xs, xs - (x1 + 1 - rx))) / max(rx, 1e-6)
    dy = np.maximum(0, np.maximum((y0 + ry) - ys, ys - (y1 + 1 - ry))) / max(ry, 1e-6)
    dz = np.maximum(0, np.maximum((z0 + rz) - zs, zs - (z1 + 1 - rz))) / max(rz, 1e-6)
    return m.box_mask(x0, y0, z0, x1, y1, z1) & (dx * dx + dy * dy + dz * dz <= 1.0001)


def tube_mask(m, a, b, r):
    """A cylinder with flat ends between the points a and b."""
    xs, ys, zs = m._centres
    p = np.stack([xs, ys, zs], axis=-1)
    a, b = np.array(a, dtype=float), np.array(b, dtype=float)
    ab = b - a
    t = ((p - a) @ ab) / (ab @ ab)
    closest = a + t[..., None] * ab
    return (t >= 0) & (t <= 1) & (np.linalg.norm(p - closest, axis=-1) <= r)


def exposed(m):
    """Filled voxels with at least one empty neighbour (what you can see)."""
    f = m.grid > 0
    p = np.pad(f, 1)
    inner = (
        p[:-2, 1:-1, 1:-1] & p[2:, 1:-1, 1:-1] & p[1:-1, :-2, 1:-1]
        & p[1:-1, 2:, 1:-1] & p[1:-1, 1:-1, :-2] & p[1:-1, 1:-1, 2:]
    )
    return f & ~inner


def scatter(m, region, colour, chance, seed):
    """Speckles the visible voxels of a region at random (the same every build)."""
    rng = np.random.default_rng(seed)
    m.paint(region & exposed(m) & (rng.random(m.grid.shape) < chance), colour)


def raised(m, x0, y0, rows, colours, part=0):
    """Pixel art one voxel in front of the surface, so it stands out (a nose,
    a moustache, a badge). rows[0] is the top row, like Model.pixels."""
    filled = m.grid > 0
    height = len(rows)
    for r, row in enumerate(rows):
        y = y0 + height - 1 - r
        for c, char in enumerate(row):
            if char not in colours:
                continue
            x = x0 + c
            zs = np.nonzero(filled[x, y, :])[0]
            if len(zs) and zs[0] > 0:
                m.voxel(x, y, zs[0] - 1, colours[char], part=part)


def region(m, x0, y0, x1, y1):
    """Every voxel of a rectangle as seen from the front, through the whole depth."""
    return m.box_mask(x0, y0, 0, x1, y1, m.depth - 1)


# -- 1. Korbloxo Scheletrino ---------------------------------------------------


@design("KorbloxoScheletrino", width=30, height=44, depth=16)
def korbloxo_scheletrino(m):
    armour, armour_dark, armour_light = "#28387f", "#161f4c", "#4661bb"
    bone, bone_dark, bone_light = "#ece6d2", "#b8ad8c", "#fffbef"
    glow, glow_light, glow_dark = "#38d6ff", "#d2f8ff", "#1686c2"
    blade, blade_dark, blade_edge = "#30344d", "#1c1e2e", "#8d95bd"
    void = "#070818"
    cape, cape_dark = "#1d1648", "#110c2e"

    # The famous Korblox leg: the character's right leg (left in the picture)
    # is all bones held together by glowing blue joints.
    bony = m.limb("Leg", pivot=(12, 13, 8), phase=0)
    m.box(10, 11, 6, 13, 12, 9, glow, part=bony)          # hip joint
    m.box(11, 8, 7, 12, 10, 8, bone, part=bony)           # thigh bone
    m.box(10, 6, 6, 13, 7, 9, glow, part=bony)            # knee
    m.box(11, 3, 7, 12, 5, 8, bone, part=bony)            # shin
    m.box(11, 2, 6, 12, 2, 9, glow_dark, part=bony)       # ankle
    m.box(10, 0, 7, 13, 1, 9, bone, part=bony)            # heel
    for x in (10, 12, 13):
        m.box(x, 0, 3, x, 1 if x != 13 else 0, 6, bone, part=bony)  # toe bones
    m.pixels(10, 6, ["lggl", "gllg"], {"g": glow, "l": glow_light})
    m.pixels(10, 11, ["gllg", "lggl"], {"g": glow, "l": glow_light})
    m.paint_face(m.box_mask(11, 3, 0, 12, 10, 15), bone_light, face="front")
    m.paint(m.box_mask(12, 3, 0, 12, 10, 15), bone_dark)

    # The other leg: dark armour, a shiny knee plate and a heavy boot.
    armoured = m.limb("Leg", pivot=(18, 13, 8), phase=1)
    m.box(16, 3, 6, 19, 12, 9, armour, part=armoured)
    m.box(16, 6, 5, 19, 7, 9, armour_light, part=armoured)
    m.box(15, 0, 4, 20, 2, 10, armour_dark, part=armoured)
    m.box(16, 3, 5, 19, 3, 10, armour_dark, part=armoured)
    m.box(17, 7, 4, 18, 7, 4, glow, part=armoured)
    m.paint(m.box_mask(19, 3, 0, 19, 12, 15) & m.surface("right"), armour_dark)

    # Torso: a breastplate with a glowing skull, a belt and armoured skirt plates.
    m.mask(rounded_box_mask(m, 8, 13, 4, 21, 26, 12, 1.2), armour)
    m.box(9, 17, 3, 20, 25, 3, armour_light)
    m.paint_face(m.box_mask(9, 17, 0, 20, 17, 15), armour, face="front")
    m.box(8, 13, 3, 21, 14, 12, armour_dark)
    m.box(14, 13, 2, 15, 14, 2, glow)
    for x in (9, 13, 16, 20):
        m.paint_face(m.box_mask(x, 15, 0, x, 16, 15), armour_dark, face="front")
    m.pixels(12, 19, [".wwww.", "wwwwww", "wggwgg", "wwwwww", ".w..w."], {"w": bone, "g": glow})
    m.pixels(12, 21, ["wggwgg"], {"w": bone, "g": glow})
    # A tattered dark cape hangs down the back.
    for x in range(8, 22):
        bottom = 9 + (0, 2, 1, 3, 0, 1, 2, 0, 3, 1, 0, 2, 1, 0)[x - 8]
        m.box(x, bottom, 13, x, 26, 14, cape if x % 3 else cape_dark)
    m.box(8, 25, 12, 21, 27, 14, cape_dark)

    # Arms with spiky pauldrons; the right-hand fist holds a dark sword.
    for x0, phase in ((3, 0), (23, 1)):
        arm = sword = m.limb("Arm", pivot=(x0 + 2, 26, 8), phase=phase)
        m.box(x0, 17, 6, x0 + 3, 24, 9, armour, part=arm)
        m.box(x0, 14, 5, x0 + 3, 17, 10, armour_dark, part=arm)
        m.mask(rounded_box_mask(m, x0 - 1, 22, 5, x0 + 4, 27, 11, 1.3), armour_light, part=arm)
        m.box(x0 - 1, 22, 5, x0 + 4, 22, 11, glow_dark, part=arm)
        m.box(x0 + 1, 28, 7, x0 + 2, 29, 8, bone, part=arm)
        m.voxel(x0 + 1, 30, 7, bone_light, part=arm)
    m.box(23, 14, 2, 26, 17, 10, armour_dark, part=sword)       # fist around the grip
    m.box(24, 11, 2, 25, 18, 3, blade_dark, part=sword)         # grip
    m.box(24, 10, 2, 25, 10, 3, glow, part=sword)               # pommel gem
    m.box(21, 19, 2, 28, 20, 3, blade_edge, part=sword)         # crossguard
    m.box(21, 19, 2, 21, 20, 3, glow, part=sword)
    m.box(28, 19, 2, 28, 20, 3, glow, part=sword)
    for y in range(21, 42):
        if y <= 38:
            x0, x1 = 23, 26
        elif y <= 40:
            x0, x1 = 24, 25
        else:
            x0, x1 = 24, 24
        m.box(x0, y, 2, x1, y, 3, blade, part=sword)
        m.box(x0, y, 2, x0, y, 3, blade_edge, part=sword)
        m.box(x1, y, 2, x1, y, 3, blade_edge, part=sword)
    m.paint(m.box_mask(24, 22, 0, 25, 38, 2), blade_dark)
    m.paint(m.box_mask(24, 25, 0, 24, 36, 2), glow_dark)
    m.paint(m.box_mask(24, 28, 0, 24, 33, 2), glow)

    # The head: a horned knight's helm with a T-shaped visor and glowing eyes.
    head = m.limb("Head", pivot=(15, 27, 8))
    m.mask(rounded_box_mask(m, 9, 27, 3, 20, 37, 12, 1.4), armour, part=head)
    m.box(14, 38, 4, 15, 38, 11, armour_light, part=head)
    m.box(14, 33, 2, 15, 37, 2, armour_light, part=head)
    m.paint_face(m.box_mask(9, 34, 0, 20, 37, 15), armour_light, face="front")
    m.box(9, 33, 2, 20, 33, 2, armour_dark, part=head)
    m.pixels(10, 27, [
        "kkkkkkkkkk",
        "kllgkklggk",
        "kgggkkgggk",
        "...kkkk...",
        "...kwwk...",
        "...kkkk...",
    ], {"k": void, "g": glow, "l": glow_light, "w": bone})
    m.voxel(14, 35, 1, glow, part=head)
    m.voxel(15, 35, 1, glow, part=head)
    for mirror in (False, True):
        m.line((9.5, 34.5, 7.5), (5.5, 36.5, 7.5), 1.7, bone, part=head, mirror=mirror)
        m.line((5.5, 36.5, 7.5), (4.5, 40.5, 7.5), 1.3, bone, part=head, mirror=mirror)
        m.line((4.5, 40.5, 7.5), (5.6, 43.3, 7.5), 0.85, bone_dark, part=head, mirror=mirror)
        m.paint(m.box_mask(3, 35, 0, 6, 36, 15), bone_dark, mirror=mirror)


# -- 2. Dogino Pizzarino --------------------------------------------------------


@design("DoginoPizzarino", width=32, height=44, depth=18)
def dogino_pizzarino(m):
    fur, fur_dark, fur_light = "#e8943a", "#c0701f", "#f7b660"
    cream, cream_dark = "#fbe9c9", "#e5cc9e"
    nose, pink = "#2b1d17", "#f29aa3"
    box_w, box_shade, box_edge = "#f7f4ec", "#e9e2d2", "#bfb39c"
    red, red_dark = "#d8352a", "#a3231a"
    cheese = "#ffc93a"
    crust, crust_dark = "#d9913f", "#a9652a"
    pepperoni, basil = "#b8281e", "#2f8f3a"
    grease = "#e9b86a"
    xs, ys, _ = m._centres

    # Shiba legs with cream paws.
    for x0, phase in ((10, 0), (18, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 10, 9.5), phase=phase)
        m.box(x0, 2, 8, x0 + 3, 9, 11, fur, part=leg)
        m.box(x0, 0, 6, x0 + 3, 1, 11, cream, part=leg)
        m.box(x0, 2, 8, x0 + 3, 2, 11, cream, part=leg)
        m.pixels(x0, 0, [".k.k"], {"k": cream_dark}, part=leg)

    # The body is a pizza box standing on its end, lid facing forwards.
    m.box(6, 10, 4, 25, 25, 14, box_w)
    for face in ("left", "right", "top", "bottom"):
        m.paint_face(m.box_mask(0, 0, 6, 31, 43, 6), box_edge, face=face)
    m.paint_face(m.box_mask(0, 10, 0, 31, 25, 17), box_shade, face="back")
    m.paint_face(m.box_mask(8, 12, 0, 23, 23, 17) & ~m.box_mask(9, 13, 0, 22, 22, 17), box_edge, face="back")
    # Air vents on the sides and a greasy spot.
    for z in (9, 12):
        m.paint_face(m.box_mask(0, 16, z, 31, 19, z), box_edge, face="left")
        m.paint_face(m.box_mask(0, 16, z, 31, 19, z), box_edge, face="right")
    m.paint_face(m.ellipsoid_mask(25, 13, 10, 2, 1.6, 2.5), grease, face="right")
    # The lid: a red frame, a little Italian flag and a pizza with one slice gone.
    m.paint_face(m.box_mask(7, 11, 0, 24, 24, 17) & ~m.box_mask(8, 12, 0, 23, 23, 17), red, face="front")
    m.pixels(13, 22, ["ggwwrr"], {"g": "#2e9b45", "w": box_w, "r": red})
    m.pixels(9, 22, ["rr", ".."], {"r": red_dark})
    m.pixels(21, 22, ["rr"], {"r": red_dark})
    pizza = m.ellipsoid_mask(16, 17, 0, 4.8, 4.8, 99)
    m.paint_face(pizza, crust, face="front")
    m.paint_face(m.ellipsoid_mask(16, 17, 0, 3.8, 3.8, 99), cheese, face="front")
    m.paint_face(pizza & ~m.ellipsoid_mask(16, 17, 0, 4.2, 4.2, 99), crust_dark, face="front")
    m.pixels(12, 14, ["pp....", "pp..pp", "....pp"], {"p": pepperoni})
    m.pixels(13, 18, ["pp", "pp"], {"p": pepperoni})
    m.pixels(15, 16, ["g"], {"g": basil})
    wedge = (xs > 16) & (ys > 17) & ((xs - 16) > (ys - 17) * 0.5)
    m.paint_face(wedge & pizza, box_w, face="front")

    # Arms; the right paw holds a slice of pizza, crust up.
    arms = []
    for x0, phase in ((2, 0), (26, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2, 24, 9.5), phase=phase)
        arms.append(arm)
        m.box(x0, 16, 8, x0 + 3, 24, 11, fur, part=arm)
        m.box(x0, 13, 7, x0 + 3, 15, 11, cream, part=arm)
    rows = [
        "cccccc",
        "dccccd",
        "yyyyyy",
        "yyppyy",
        ".yppy.",
        ".yyyy.",
        ".yypy.",
        "..yy..",
        "..yy..",
        "..y...",
    ]
    colours = {"c": crust, "d": crust_dark, "y": cheese, "p": pepperoni}
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != ".":
                m.box(26 + c, 15 - r, 5, 26 + c, 15 - r, 6, colours[ch], part=arms[1])
    m.box(26, 14, 7, 26, 15, 7, crust, part=arms[1])

    # The doge head.
    head = m.limb("Head", pivot=(16, 26, 9))
    m.mask(rounded_box_mask(m, 7, 26, 3, 24, 37, 14, 2.5), fur, part=head)
    m.mask(rounded_box_mask(m, 5, 27, 6, 26, 31, 12, 1.5), fur_light, part=head)
    m.paint_face(m.box_mask(0, 34, 0, 31, 43, 17), fur_light, face="top")
    m.paint_face(m.ellipsoid_mask(16, 27.5, 9, 8.3, 4.8, 99), cream, face="front")
    m.mask(rounded_box_mask(m, 12, 26, 1, 19, 31, 3, 1.2), cream, part=head)
    m.paint_face(m.box_mask(12, 31, 0, 19, 31, 3), cream_dark, face="top")
    m.pixels(14, 30, ["nhnn", ".nn."], {"n": nose, "h": "#6b5a52"}, z=0, part=head)
    m.pixels(12, 27, ["...kk...", ".kk..kk."], {"k": nose})
    m.pixels(14, 26, ["pp"], {"p": pink})
    # Side-eye and raised eyebrows.
    for x0 in (10, 19):
        m.pixels(x0, 32, ["wbh", "wbb"], {"w": WHITE, "b": BLACK, "h": WHITE})
    m.pixels(10, 35, ["cc"], {"c": cream})
    m.pixels(20, 36, ["cc"], {"c": cream})
    # Pointy ears with cream and pink insides.
    for y, (a, b) in enumerate(((7, 12), (7, 12), (7, 11), (8, 11), (8, 10), (9, 10), (9, 9))):
        m.box(a, 37 + y, 7, b, 37 + y, 10, fur, part=head, mirror=True)
    m.paint_face(region(m, 9, 38, 10, 40) | region(m, 9, 41, 9, 41), cream, face="front", mirror=True)
    m.paint_face(region(m, 10, 38, 10, 39), pink, face="front", mirror=True)
    m.paint_face(region(m, 7, 38, 12, 43), fur_dark, face="back", mirror=True)


# -- 3. Spadino Linkino ---------------------------------------------------------


@design("SpadinoLinkino", width=28, height=44, depth=12)
def spadino_linkino(m):
    steel, steel_dark, steel_light = "#bfc7d1", "#6f7986", "#e4eaf0"
    gold, gold_dark, gold_light = "#f0b429", "#b7800f", "#ffe07a"
    leather, leather_dark = "#7b4a25", "#4f2d14"
    gem, gem_light = "#2f7dff", "#9cc7ff"
    blush = "#f49ab0"
    xs, ys, zs = m._centres

    # The hilt splits into two legs wrapped in leather, with golden pommel feet.
    for x0, phase in ((10, 0), (15, 1)):
        leg = m.limb("Leg", pivot=(x0 + 1.5, 11, 5.5), phase=phase)
        m.box(x0, 2, 4, x0 + 2, 10, 7, leather, part=leg)
        m.mask(rounded_box_mask(m, x0 - 1, 0, 3, x0 + 3, 2, 8, 0.8), gold, part=leg)
    m.box(10, 11, 4, 17, 12, 7, leather)
    wrap = (xs + ys + zs).astype(int) % 3 == 0
    m.paint(wrap & m.box_mask(9, 3, 0, 18, 12, 11), leather_dark)
    m.paint_face(m.box_mask(9, 2, 0, 18, 2, 11), gold_light, face="top")

    # The crossguard: a gold bar with a blue gem; its ends are the arms.
    m.mask(rounded_box_mask(m, 8, 13, 3, 19, 16, 8, 0.8), gold)
    m.paint_face(m.box_mask(8, 16, 0, 19, 16, 11), gold_light, face="top")
    m.paint_face(m.box_mask(8, 13, 0, 19, 13, 11), gold_dark, face="front")
    m.pixels(13, 14, ["lg", "gg"], {"g": gem, "l": gem_light})
    for x0, phase in ((2, 0), (20, 1)):
        arm = m.limb("Arm", pivot=(8 if x0 == 2 else 20, 14.5, 5.5), phase=phase)
        m.box(x0, 13, 4, x0 + 5, 15, 7, gold, part=arm)
        m.paint_face(m.box_mask(x0, 15, 0, x0 + 5, 15, 11), gold_light, face="top")
        m.paint_face(m.box_mask(x0, 13, 0, x0 + 5, 13, 11), gold_dark, face="front")
        cx = 2.5 if x0 == 2 else 25.5
        m.sphere(cx, 12.5, 5.5, 2.2, gold_light, part=arm)
        m.paint(m.ellipsoid_mask(cx, 11.5, 5.5, 2.3, 1.3, 2.3), gold)

    # The blade: grey with dark bevelled edges, a fuller and a pointed tip.
    for y in range(17, 44):
        half = 5 if y <= 38 else 5 - (y - 38)
        if half <= 0:
            break
        x0, x1 = 14 - half, 13 + half
        m.box(x0, y, 3, x1, y, 7, steel)
        for x in (x0, x1):
            m.clear(m.box_mask(x, y, 3, x, y, 3) | m.box_mask(x, y, 7, x, y, 7))
            m.paint(m.box_mask(x, y, 0, x, y, 11), steel_dark)
        if half <= 2:
            m.clear(m.box_mask(x0, y, 0, x1, y, 3) | m.box_mask(x0, y, 7, x1, y, 11))
    m.box(9, 17, 3, 18, 17, 7, steel_dark)
    for face in ("front", "back"):
        m.paint_face(m.box_mask(13, 18, 0, 14, 23, 11), steel_dark, face=face)
        m.paint_face(m.box_mask(13, 33, 0, 14, 39, 11), steel_dark, face=face)
        for i in range(4):
            m.paint_face(m.box_mask(10 + i, 34 + i, 0, 10 + i, 34 + i, 11), steel_light, face=face)
            m.paint_face(m.box_mask(15 + i, 19 + i, 0, 15 + i, 19 + i, 11), steel_light, face=face)
    # A brave little face on the blade.
    m.pixels(10, 32, ["bb....bb", ".b....b."], {"b": BLACK})
    m.pixels(11, 27, ["hb..hb", "bb..bb", "bb..bb"], {"b": BLACK, "h": WHITE})
    m.pixels(10, 24, ["p......p", ".b....b.", "..bbbb.."], {"b": BLACK, "p": blush})


# -- 4. Lagino Pingone ----------------------------------------------------------


@design("LaginoPingone", width=30, height=42, depth=22)
def lagino_pingone(m):
    case, case_dark, case_light = "#2a2c34", "#17181d", "#454856"
    panel, fist = "#3b3e4a", "#6b6f7c"
    green, amber = "#3dff7a", "#ffb020"
    red, red_dim = "#ff3b30", "#9c1f19"
    cable, cable_dark = "#f5c518", "#c79a0a"
    xs, ys, zs = m._centres

    # Little legs with rubber feet.
    for x0, phase in ((8, 0), (19, 1)):
        leg = m.limb("Leg", pivot=(x0 + 1.5, 6, 10), phase=phase)
        m.box(x0, 2, 8, x0 + 2, 5, 11, case_light, part=leg)
        m.box(x0 - 1, 0, 7, x0 + 3, 1, 12, BLACK, part=leg)

    # The router box, with air vents on top.
    m.mask(rounded_box_mask(m, 3, 6, 5, 26, 25, 14, 1.5), case)
    m.paint_face(m.box_mask(0, 6, 0, 29, 25, 21), case_light, face="top")
    for z in (8, 10, 12):
        m.paint_face(m.box_mask(6, 0, z, 23, 41, z), case_dark, face="top")
    m.paint_face(m.box_mask(0, 6, 0, 29, 6, 21), case_dark, face="front")
    # Ports on the back.
    for x, colour in ((7, cable), (11, cable), (15, "#2f8cff"), (19, "#2f8cff")):
        m.paint_face(region(m, x, 10, x + 2, 12), BLACK, face="back")
        m.paint_face(region(m, x + 1, 10, x + 1, 11), colour, face="back")
    m.paint_face(region(m, 23, 16, 24, 17), green, face="back")
    # The status panel: blinking lights and red ping bars (only one bar left).
    m.paint_face(region(m, 5, 7, 24, 11), panel, face="front")
    m.pixels(6, 9, ["g.g.a"], {"g": green, "a": amber})
    m.pixels(13, 7, [
        "..........OO",
        ".......OO.OO",
        "....rr.OO.OO",
        ".rr.rr.OO.OO",
    ], {"r": red, "O": red_dim})
    # A furious face: red brows, glaring eyes and gritted teeth.
    m.pixels(6, 21, ["rrrr..........rrrr", "..rrr........rrr.."], {"r": red})
    for x0, flip in ((7, False), (18, True)):
        eye = ["ww...", "wwww.", "wkkww", "wkkhw", ".www."]
        if flip:
            eye = [row[::-1] for row in eye]
        m.pixels(x0, 15, eye, {"w": WHITE, "k": BLACK, "h": "#9aa0b4"})
    m.pixels(9, 12, [
        "wkwwkwwkwwkw",
        "kkkkkkkkkkkk",
        "wkwwkwwkwwkw",
    ], {"w": WHITE, "k": "#7b8194"})

    # Stubby arms shaking their fists.
    for x0, phase in ((0, 0), (27, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 19, 9.5), phase=phase)
        m.box(x0, 13, 8, x0 + 2, 19, 11, case_light, part=arm)
        m.box(x0, 10, 7, x0 + 2, 13, 12, fist, part=arm)
        m.paint_face(m.box_mask(x0, 10, 0, x0 + 2, 13, 21), "#8a8e9c", face="front")

    # Two antennae at the back corners.
    for mirror in (False, True):
        m.box(4, 25, 11, 6, 26, 13, case_light, mirror=mirror)
        m.box(5, 27, 12, 5, 37, 12, case, mirror=mirror)
        m.box(4, 27, 11, 6, 27, 13, case_dark, mirror=mirror)
        m.box(4, 37, 11, 6, 39, 13, case_dark, mirror=mirror)
        m.box(5, 38, 12, 5, 38, 12, "#5a5d6b", mirror=mirror)

    # A yellow network cable for a tail.
    tail = m.limb("Tail", pivot=(15, 10, 15))
    m.line((15, 10, 15), (15, 8, 18.5), 0.9, cable, part=tail)
    m.line((15, 8, 18.5), (15, 4, 20), 0.9, cable, part=tail)
    m.box(14, 2, 19, 16, 4, 21, "#d7dde4", part=tail)
    m.box(14, 2, 19, 16, 2, 21, cable_dark, part=tail)

    # The loading ring spinning above its head: a bright head and a fading tail.
    ring = m.limb("Prop", pivot=(15, 34.5, 10), axis="Y")
    dist = np.sqrt((xs - 15) ** 2 + (zs - 10) ** 2)
    angle = (np.arctan2(zs - 10, xs - 15) + math.pi) / (2 * math.pi)
    band = (dist >= 5.2) & (dist <= 7.6) & (ys > 33) & (ys < 36)
    shades = ["#2b3f78", "#2c56a0", "#2f73c8", "#3b93e8", "#5cb4ff", "#8fd0ff", "#c6e9ff", "#ffffff"]
    for i, colour in enumerate(shades):
        lo, hi = 0.2 + i * 0.1, 0.3 + i * 0.1
        m.mask(band & (angle >= lo) & (angle < hi), colour, part=ring)


# -- 5. Cannolino Cannone -------------------------------------------------------


@design("CannolinoCannone", width=28, height=30, depth=38)
def cannolino_cannone(m):
    wood, wood_dark, wood_light = "#9c5f2b", "#6b3d17", "#c07f40"
    iron, iron_light = "#3b3b42", "#62636e"
    shell, shell_dark, shell_light = "#e7a54b", "#bb772d", "#f8cf7c"
    cream, cream_shade = "#fff7e3", "#eee0bf"
    chip, chip_light = "#3a2112", "#5c3820"
    truffle = "#5a3218"
    xs, ys, zs = m._centres

    # The wooden cart.
    m.box(6, 5, 4, 21, 9, 33, wood)
    for z in range(4, 34, 5):
        m.paint_face(m.box_mask(0, 5, z, 27, 9, z), wood_dark, face="left")
        m.paint_face(m.box_mask(0, 5, z, 27, 9, z), wood_dark, face="right")
    for x in (9, 13, 17):
        m.paint_face(m.box_mask(x, 0, 0, x, 29, 37), wood_dark, face="top")
    m.paint_face(m.box_mask(0, 9, 0, 27, 9, 37), wood_light, face="front")
    for z in (7, 30):
        m.paint(m.box_mask(6, 5, z, 21, 9, z) & exposed(m), iron)
    m.box(5, 4, 10, 22, 5, 11, iron)
    m.box(5, 4, 26, 22, 5, 27, iron)
    # The wheels roll about their axles.
    for x0, zc in ((2, 11), (23, 11), (2, 27), (23, 27)):
        wheel = m.limb("Prop", pivot=(x0 + 1.5, 5, zc), axis="X")
        outer = x0 if x0 == 2 else x0 + 2
        dy, dz = ys - 5, zs - zc
        d = np.sqrt(dy * dy + dz * dz)
        spokes = (np.abs(dy) < 0.75) | (np.abs(dz) < 0.75) | (np.abs(dy - dz) < 0.9) | (np.abs(dy + dz) < 0.9)
        rim = m.box_mask(x0, 0, 0, x0 + 2, 29, 37) & ~m.box_mask(outer, 0, 0, outer, 29, 37)
        m.mask(rim & (d <= 5) & (d > 4), iron, part=wheel)
        m.mask(rim & (d <= 4) & (d > 3.1), wood, part=wheel)
        m.mask(rim & (d <= 3.1) & spokes, wood_light, part=wheel)
        m.mask(m.box_mask(x0, 0, 0, x0 + 2, 29, 37) & (d <= 1.5), wood_dark, part=wheel)
        m.mask(m.box_mask(outer, 0, 0, outer, 29, 37) & (d <= 1.0), iron_light, part=wheel)

    # The cradle holding the cannon.
    for x0 in (6, 20):
        m.mask(rounded_box_mask(m, x0, 10, 11, x0 + 1, 17, 22, 1.2), wood_dark)
        m.box(x0 if x0 == 6 else x0 + 1, 15, 16, x0 if x0 == 6 else x0 + 1, 16, 17, iron)
    m.box(8, 10, 12, 19, 11, 24, wood_dark)

    # The cannoli barrel: a fried shell with cream bursting out of both ends.
    front, back = np.array([14, 21, 1.5]), np.array([14, 16, 25.5])
    u = (back - front) / np.linalg.norm(back - front)
    m.mask(tube_mask(m, front, back, 4.8), cream)
    m.mask(tube_mask(m, front + 2.4 * u, back - 2.4 * u, 5.8), shell)
    shell_mask = tube_mask(m, front + 2.4 * u, back - 2.4 * u, 5.9)
    # Bubbly fried ridges round the shell, and a dusting of icing sugar on top.
    p = np.stack([xs, ys, zs], axis=-1)
    t = (p - front) @ u
    m.paint(shell_mask & (np.floor(t).astype(int) % 4 == 0), shell_dark)
    scatter(m, shell_mask, shell_light, 0.14, 2)
    scatter(m, shell_mask, shell_dark, 0.06, 1)
    scatter(m, shell_mask & (ys > 24), WHITE, 0.12, 3)
    # Chocolate chips pressed into the cream round the rims.
    ends = tube_mask(m, front, back, 5) & ~shell_mask
    rims = ends & ~tube_mask(m, front - u, back + u, 3.9)
    scatter(m, rims, cream_shade, 0.3, 4)
    scatter(m, rims & (zs < 12) & (ys < 18.5), chip, 0.25, 5)
    scatter(m, ends & (zs > 20), chip, 0.25, 7)
    # A face on the cream at the front: it fires from its mouth.
    m.pixels(11, 20, ["hb..hb", "bb..bb"], {"b": BLACK, "h": WHITE})
    m.pixels(10, 16, ["p......p", "...kk...", "..kkkk..", "...kk..."], {"k": BLACK, "p": "#f49ab0"})
    # A lit fuse at the back.
    m.box(14, 21, 24, 14, 25, 24, BLACK)
    m.box(14, 25, 25, 14, 25, 26, BLACK)
    m.voxel(14, 25, 27, "#ff8a00")
    for x, y, z in ((14, 26, 27), (13, 25, 27), (15, 25, 27), (14, 25, 28), (14, 24, 27)):
        m.voxel(x, y, z, "#ffe14d")
    # Chocolate truffle cannonballs.
    for cx, cy in ((11.5, 11), (16.5, 11), (14, 13)):
        m.sphere(cx, cy, 30.5, 1.9, truffle)
    scatter(m, m.box_mask(9, 10, 28, 19, 16, 33), chip_light, 0.3, 6)


# -- 6. Valkyrio Polpetto -------------------------------------------------------


@design("ValkyrioPolpetto", width=36, height=46, depth=20)
def valkyrio_polpetto(m):
    meat, meat_dark, meat_light = "#8a4b2b", "#5e321b", "#a8683d"
    sauce, sauce_dark = "#d4301f", "#971c10"
    silver, silver_dark, silver_light = "#c7cdd7", "#8a93a1", "#f0f3f7"
    feather, feather_soft, feather_tip = "#ffffff", "#e9eef6", "#c6d2e4"
    gold, gold_dark, parsley = "#f2b632", "#c48a12", "#3f9b35"
    fork, fork_dark, fork_light = "#8f99aa", "#5f6878", "#dde2ea"
    brow = "#2a150a"
    xs, ys, zs = m._centres

    # The meatball: a bumpy brown ball, speckled everywhere but the face.
    rng = np.random.default_rng(7)
    m.sphere(18, 20, 10, 9.6, meat)
    for _ in range(34):
        theta, phi = rng.uniform(0, 2 * math.pi), math.acos(rng.uniform(-1, 1))
        d = np.array([math.sin(phi) * math.cos(theta), math.cos(phi), math.sin(phi) * math.sin(theta)])
        c = np.array([18, 20, 10]) + d * 9.3
        m.sphere(c[0], c[1], c[2], rng.uniform(1.3, 1.9), meat)
    ball = (m.grid > 0) & ~(region(m, 10, 11, 25, 23) & (zs < 5))
    scatter(m, ball, meat_dark, 0.16, 8)
    scatter(m, ball, meat_light, 0.1, 9)
    scatter(m, ball, parsley, 0.025, 10)

    # Legs with silver armoured boots.
    for x0, phase in ((13, 0), (19, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 13, 10), phase=phase)
        m.box(x0, 4, 8, x0 + 3, 12, 11, meat, part=leg)
        m.box(x0, 0, 6, x0 + 3, 3, 11, silver, part=leg)
        m.box(x0 - 1, 4, 7, x0 + 4, 4, 12, gold, part=leg)
        m.paint_face(m.box_mask(x0, 0, 0, x0 + 3, 0, 19), silver_dark, face="front")

    # Tomato sauce oozing from under the helmet.
    m.paint((m.grid > 0) & exposed(m) & (ys > 24.5), sauce)
    for x, length in ((10, 3), (11, 6), (16, 2), (19, 2), (24, 5), (26, 3)):
        m.paint_face(region(m, x, 24 - length, x, 24), sauce, face="front")
        m.paint_face(region(m, x, 24 - length, x, 24 - length), sauce_dark, face="front")
    for x, length in ((11, 4), (16, 6), (20, 3), (24, 5)):
        m.paint_face(region(m, x, 24 - length, x, 24), sauce, face="back")

    # A brave face.
    m.pixels(11, 18, [".www.", "whkkw", "wkkkw", ".www."], {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(20, 18, [".www.", "whkkw", "wkkkw", ".www."], {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(11, 22, ["kk..........kk", "..kkk....kkk.."], {"k": brow})
    m.pixels(14, 13, ["k......k", "kwwwwwwk", ".kkkkkk."], {"k": brow, "w": WHITE})

    # The Valkyrie Helm: a silver dome with a gold band and a nose guard.
    helm = m.ellipsoid_mask(18, 22, 10, 10.4, 10.2, 10.4) & (ys > 25)
    m.mask(helm, silver)
    m.paint(helm & (ys > 31), silver_light)
    m.mask(m.ellipsoid_mask(18, 22, 10, 10.7, 10.4, 10.7) & (ys > 25) & (ys < 27.5), gold)
    m.paint(m.ellipsoid_mask(18, 22, 10, 11, 11, 11) & (ys > 25) & (ys < 26.5) & (np.floor(xs + zs).astype(int) % 3 == 0), gold_dark)
    raised(m, 17, 20, ["ss", "ss", "ss", "ss", "dd"], {"s": silver, "d": silver_dark})
    m.mask(m.ellipsoid_mask(18, 22, 10, 11.3, 11.2, 11.3) & (ys > 28) & region(m, 17, 0, 18, 45), silver_dark)

    # Big white feathered wings on the helmet, sweeping up and back (they flap).
    up = np.array([0.0, 1.0, 0.15])
    for sign, phase in ((1, 0), (-1, 1)):
        out = np.array([-0.78 * sign, 0.0, 0.62])
        base = np.array([18 - 9.7 * sign, 29.5, 11.0])
        wing = m.limb("Wing", pivot=tuple(base), phase=phase)
        feathers = 8
        for i in range(feathers):
            theta = math.radians(6 + i * 78 / (feathers - 1))
            length = 15.5 - i * 0.85
            tip = base + length * (math.cos(theta) * up + math.sin(theta) * out)
            m.line(tuple(base), tuple(tip), 1.35, feather if i % 2 == 0 else feather_soft, part=wing)
            m.sphere(*tip, 1.1, feather_tip, part=wing)
        for i in range(feathers - 1):
            theta = math.radians(10 + i * 78 / (feathers - 1))
            tip = base + 8 * (math.cos(theta) * up + math.sin(theta) * out)
            m.line(tuple(base), tuple(tip), 2.2, feather_soft, part=wing)
        m.sphere(*(base + 0.8 * out), 2.0, gold, part=wing)

    # Meaty arms with silver bracers; the right fist holds a giant fork.
    for x0, phase in ((5, 0), (27, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2, 19.5, 9.5), phase=phase)
        m.box(x0, 14, 8, x0 + 3, 19, 11, meat, part=arm)
        m.box(x0, 14, 8, x0 + 3, 15, 11, silver, part=arm)
        m.box(x0, 11, 7, x0 + 3, 13, 11, meat_dark, part=arm)
    m.box(28, 2, 5, 29, 34, 6, fork, part=arm)
    m.box(28, 2, 5, 28, 34, 6, fork_light, part=arm)
    m.box(27, 11, 5, 30, 13, 7, meat_dark, part=arm)
    for y, (a, b) in ((33, (27, 30)), (34, (26, 31)), (35, (25, 32)), (36, (25, 32))):
        m.box(a, y, 5, b, y, 6, fork, part=arm)
    m.box(25, 35, 5, 32, 35, 5, fork_light, part=arm)
    for x in (25, 27, 30, 32):
        top = 43 if x in (27, 30) else 42
        m.box(x, 37, 5, x, top, 6, fork, part=arm)
        m.box(x, top, 5, x, top, 6, fork_light, part=arm)
    m.paint(m.box_mask(25, 33, 6, 32, 43, 6), fork_dark)


# -- 7. Builderino Mattoncino --------------------------------------------------


@design("BuilderinoMattoncino", width=34, height=42, depth=16)
def builderino_mattoncino(m):
    skin, skin_dark = "#f1b98a", "#d69262"
    hat, hat_dark, hat_light = "#ffd21f", "#e0a300", "#fff08a"
    vest, vest_dark, vest_light = "#ff7a1a", "#d95a00", "#ff9d4d"
    stripe = "#e6eef2"
    shirt, shirt_shade = "#f4f4f4", "#d5d9de"
    jeans, jeans_dark, jeans_light = "#2f62b8", "#1f4287", "#4d82d9"
    boot, boot_dark, boot_light = "#6b4423", "#3f2612", "#8a5a30"
    belt, buckle = "#5a3a1c", "#d9d9d9"
    brick, brick_dark, brick_light = "#d8281c", "#a01a10", "#ff6a5c"
    glove = "#c89a5a"
    iron, handle = "#8c929c", "#a8733f"
    hair = "#4a2a14"

    # Jeans and work boots.
    for x0, phase in ((8, 0), (15, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2.5, 14, 7.5), phase=phase)
        m.box(x0, 3, 5, x0 + 4, 13, 10, jeans, part=leg)
        m.box(x0, 3, 5, x0 + 4, 4, 10, jeans_light, part=leg)
        m.box(x0, 0, 3, x0 + 4, 2, 10, boot, part=leg)
        m.box(x0, 0, 3, x0 + 4, 0, 10, boot_dark, part=leg)
        m.paint_face(m.box_mask(x0 + 2, 5, 0, x0 + 2, 13, 15), jeans_dark, face="front")
        m.paint_face(m.box_mask(x0, 1, 0, x0 + 4, 2, 15), boot_light, face="top")

    # Torso: white tee under an orange safety vest with reflective stripes.
    m.box(7, 14, 4, 20, 26, 11, vest)
    m.box(7, 14, 4, 20, 15, 11, belt)
    m.box(13, 14, 3, 14, 15, 3, buckle)
    m.box(8, 13, 3, 10, 15, 4, belt)
    m.box(17, 13, 3, 19, 15, 4, belt)
    for y in (17, 21):
        m.paint(m.box_mask(7, y, 0, 20, y + 1, 15) & exposed(m), stripe)
    for face in ("front", "back"):
        m.paint_face(m.box_mask(9, 19, 0, 10, 26, 15), stripe, face=face)
        m.paint_face(m.box_mask(17, 19, 0, 18, 26, 15), stripe, face=face)
    m.paint_face(m.box_mask(13, 16, 0, 14, 26, 15), vest_dark, face="front")
    m.paint_face(m.box_mask(12, 24, 0, 15, 26, 15), shirt, face="front")
    m.paint_face(m.box_mask(7, 26, 0, 20, 26, 15), vest_light, face="top")

    # Arms: tee sleeves, bare forearms and leather work gloves.
    arms = []
    for x0, phase in ((3, 0), (21, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2, 26, 7.5), phase=phase)
        arms.append(arm)
        m.box(x0, 21, 5, x0 + 3, 26, 10, shirt, part=arm)
        m.box(x0, 21, 5, x0 + 3, 21, 10, shirt_shade, part=arm)
        m.box(x0, 17, 6, x0 + 3, 20, 9, skin, part=arm)
        m.box(x0, 14, 5, x0 + 3, 16, 10, glove, part=arm)
    # A hammer in the left hand; a toy stud on the left shoulder.
    m.box(4, 8, 7, 5, 13, 8, handle, part=arms[0])
    m.box(4, 5, 3, 5, 7, 10, iron, part=arms[0])
    m.box(4, 5, 3, 5, 7, 4, "#6d737d", part=arms[0])
    m.box(4, 27, 7, 5, 27, 8, shirt, part=arms[0])
    # A big red toy brick on the right shoulder.
    m.box(21, 27, 3, 31, 32, 10, brick, part=arms[1])
    m.paint_face(m.box_mask(21, 27, 0, 31, 27, 15), brick_dark, face="front")
    m.paint(m.box_mask(31, 27, 0, 31, 32, 15), brick_dark)
    for sx in (21, 24, 27, 30):
        for sz in (4, 8):
            m.box(sx, 33, sz, sx + 1, 34, sz + 1, brick, part=arms[1])
            m.box(sx, 34, sz, sx + 1, 34, sz + 1, brick_light, part=arms[1])

    # The head: a determined face under a yellow hard hat.
    head = m.limb("Head", pivot=(14, 27, 7.5))
    m.mask(rounded_box_mask(m, 8, 27, 3, 19, 35, 12, 1.0), skin, part=head)
    m.pixels(9, 33, ["bb......bb", ".bbb..bbb."], {"b": hair})
    m.pixels(10, 30, ["hb..hb", "bb..bb"], {"b": BLACK, "h": WHITE})
    raised(m, 13, 29, ["nn", "nn"], {"n": skin_dark}, part=head)
    m.pixels(11, 27, ["....b.", "bbbb.."], {"b": "#6b2e1a"})
    m.pixels(17, 28, ["tt"], {"t": "#e9c9a0"})
    m.mask(rounded_box_mask(m, 7, 35, 2, 20, 39, 13, 1.8), hat, part=head)
    m.box(6, 35, 1, 21, 35, 14, hat, part=head)
    m.box(8, 35, 0, 19, 35, 0, hat, part=head)
    m.box(13, 40, 4, 14, 40, 11, hat_light, part=head)
    m.paint_face(m.box_mask(0, 35, 0, 33, 35, 15), hat_dark, face="front")
    m.paint_face(m.box_mask(7, 38, 0, 20, 40, 15), hat_light, face="top")
    m.pixels(12, 36, ["r..r", "rrrr"], {"r": brick})


# -- 8. Pizzaiolo Turbino -------------------------------------------------------


@design("PizzaioloTurbino", width=34, height=44, depth=16)
def pizzaiolo_turbino(m):
    skin, skin_dark = "#f3bd92", "#dc9a6c"
    blush, nose = "#f08a7a", "#ec9676"
    white, white_shade = "#ffffff", "#e3e7ed"
    jacket = "#f1f4f8"
    check_dark, check_light = "#2a2a30", "#f0f0f0"
    red = "#d8312a"
    green = "#2e9b45"
    wood, wood_dark, wood_light = "#c98b4a", "#9a6330", "#e0a868"
    crust, sauce, mozz, basil = "#dd9b4a", "#d63a24", "#fff6dc", "#2f8f3a"
    xs, ys, zs = m._centres

    # Chef's check trousers and black shoes.
    for x0, phase in ((10, 0), (16, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 10, 8), phase=phase)
        m.box(x0, 2, 6, x0 + 3, 10, 9, check_light, part=leg)
        m.box(x0, 0, 4, x0 + 3, 1, 9, BLACK, part=leg)
    checks = ((xs // 2 + ys // 2 + zs // 2) % 2 == 0) & m.box_mask(10, 2, 6, 19, 10, 9)
    m.paint(checks, check_dark)

    # A round belly in a white chef's jacket with double buttons.
    m.mask(m.ellipsoid_mask(15, 16.5, 8, 8, 7.5, 6) & (ys > 10), jacket)
    m.mask(rounded_box_mask(m, 8, 17, 4, 21, 24, 12, 1.5), jacket)
    m.pixels(12, 20, ["k....k", "......", "k....k"], {"k": "#3a3a44"})
    # The apron stands a voxel proud of the jacket, with an Italian hem.
    raised(m, 9, 10, [
        "wwwwwwwwwwww",
        "wwwwwwwwwwww",
        "wwwwwwwwwwww",
        "wwssssswwwww",
        "wwswwwswwwww",
        "wwswwwswwwww",
        "wwwwwwwwwwww",
        "ggggwwwwrrrr",
    ], {"w": white, "s": white_shade, "g": green, "r": red})
    m.paint(m.box_mask(7, 18, 0, 22, 18, 15) & exposed(m), white_shade)
    m.pixels(17, 14, ["r.", "rr"], {"r": sauce})
    # The apron strings tie in a bow at the back.
    m.box(12, 17, 14, 17, 18, 14, white)
    m.box(14, 17, 15, 15, 18, 15, white_shade)
    m.box(14, 14, 14, 14, 16, 14, white)
    m.box(15, 15, 14, 15, 16, 14, white)

    # Red neckerchief with white polka dots.
    m.box(10, 24, 4, 19, 25, 12, red)
    raised(m, 12, 21, ["rwrrwr", ".rrrr.", "..wr.."], {"r": red, "w": WHITE})

    # Arms; the right hand holds a pizza peel with a margherita on it.
    arms = []
    for x0, phase in ((3, 0), (23, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2, 23.5, 8), phase=phase)
        arms.append(arm)
        m.box(x0, 18, 6, x0 + 3, 23, 10, jacket, part=arm)
        m.box(x0, 17, 6, x0 + 3, 17, 10, white_shade, part=arm)
        m.box(x0, 13, 7, x0 + 3, 16, 9, skin, part=arm)
        m.box(x0, 11, 6, x0 + 3, 13, 10, skin_dark, part=arm)
    peel = arms[1]
    m.box(23, 11, 3, 26, 13, 10, skin_dark, part=peel)
    m.box(25, 3, 3, 26, 22, 4, wood, part=peel)
    m.box(25, 3, 3, 25, 22, 4, wood_light, part=peel)
    m.mask(rounded_box_mask(m, 21, 22, 3, 30, 34, 4, (2.5, 2.5, 0.1)), wood, part=peel)
    m.paint_face(m.box_mask(21, 22, 0, 30, 34, 15), wood_dark, face="back")
    m.mask(m.ellipsoid_mask(26, 29, 2.5, 4.4, 4.4, 0.6), crust, part=peel)
    m.paint(m.ellipsoid_mask(26, 29, 2.5, 3.5, 3.5, 1), sauce)
    m.pixels(23, 27, [".m..m.", "......", "m..m..", "....m."], {"m": mozz})
    m.pixels(24, 30, ["g...", "...g"], {"g": basil})

    # The head: bushy brows, a big nose, rosy cheeks and a curly moustache.
    head = m.limb("Head", pivot=(15, 25, 8))
    m.mask(rounded_box_mask(m, 9, 25, 3, 20, 33, 12, 1.2), skin, part=head)
    m.pixels(11, 29, ["hb....hb", "bb....bb"], {"b": BLACK, "h": WHITE})
    m.pixels(10, 31, ["kkkk..kkkk", "k........k"], {"k": BLACK})
    m.pixels(10, 27, ["p........p"], {"p": blush})
    raised(m, 14, 27, ["nn", "nn", "nn"], {"n": nose}, part=head)
    raised(m, 9, 25, [
        "kk........kk",
        "k.kkkkkkkk.k",
        ".kkkk..kkkk.",
    ], {"k": BLACK}, part=head)
    # The tall white chef's hat.
    m.cylinder(15, 34, 7.5, 5.6, 3, white, part=head)
    for x in range(10, 21, 2):
        m.paint_face(m.box_mask(x, 34, 0, x, 36, 15), white_shade, face="front")
    m.ellipsoid(15, 39.8, 7.5, 7.2, 4.0, 6.3, white, part=head)
    for cx in (11.5, 15, 18.5):
        m.ellipsoid(cx, 41.2, 7.5, 3, 2.6, 4.5, white, part=head)
    m.paint(m.ellipsoid_mask(15, 37, 7.5, 8, 1.3, 7) & m.box_mask(0, 37, 0, 33, 37, 15), white_shade)


# -- 9. Gelatone Gigantone ------------------------------------------------------


@design("GelatoneGigantone", width=28, height=47, depth=22)
def gelatone_gigantone(m):
    cone, cone_dark, cone_light = "#dc9a4f", "#b0722f", "#f0bd78"
    choc, choc_dark, choc_light = "#6b3a1f", "#4a2512", "#8d5431"
    mint, mint_dark, mint_light = "#98e8c1", "#63c79b", "#c8f7e0"
    straw, straw_dark, straw_light = "#ff8fb1", "#e0668c", "#ffc2d4"
    cherry, cherry_dark, cherry_light = "#d8102a", "#8e0a1a", "#ff8a98"
    stem, chip = "#5b8a2a", "#3b2112"
    sprinkles = ["#ff3b3b", "#ff9f1c", "#ffe135", "#3ddc62", "#2f8cff", "#a55cff", "#ff5fc8"]
    xs, ys, zs = m._centres
    cx, cz = 14, 11

    def waffle(mask, x_centre, radius):
        angle = np.arctan2(zs - cz, xs - x_centre)
        u = np.round(angle * radius).astype(int)
        yy = np.floor(ys).astype(int)
        m.paint(mask & (((u + yy) % 4 == 0) | ((u - yy) % 4 == 0)), cone_dark)

    # Little waffle-cone legs, points down.
    for x0, phase in ((10, 0), (18, 1)):
        leg = m.limb("Leg", pivot=(x0, 8, cz), phase=phase)
        m.cylinder(x0, 0, cz, 1.0, 8, cone, radius2=2.9, part=leg)
        m.paint(m.box_mask(0, 7, 0, 27, 7, 21) & m.cylinder_mask(x0, 0, cz, 1.2, 8, radius2=3.0), cone_light)
        waffle(m.cylinder_mask(x0, 0, cz, 1.2, 7, radius2=2.8), x0, 2.4)

    # The cone body.
    body = m.cylinder_mask(cx, 7, cz, 3.6, 12, radius2=8.4)
    m.mask(body, cone)
    waffle(body, cx, 6)
    m.mask(m.cylinder_mask(cx, 17, cz, 8.6, 2, radius2=8.9) & ~m.cylinder_mask(cx, 17, cz, 6, 2), cone_light)

    # Three scoops with ruffled edges: chocolate, mint choc chip and strawberry.
    def scoop(cy, rx, ry, colour, dark, light, seed):
        m.mask(m.ellipsoid_mask(cx, cy, cz, rx, ry, rx), colour)
        for i in range(12):
            a = i / 12 * 2 * math.pi + seed
            m.sphere(cx + math.cos(a) * rx * 0.93, cy - ry * 0.45, cz + math.sin(a) * rx * 0.93, 1.6, colour)
        full = m.ellipsoid_mask(cx, cy, cz, rx + 1.8, ry + 1.2, rx + 1.8) & (m.grid > 0) & (ys > cy - ry - 1.5)
        m.paint(full & (ys < cy - ry * 0.35), dark)
        m.paint(full & (ys > cy + ry * 0.55), light)
        return full

    c = scoop(22, 8.6, 5.4, choc, choc_dark, choc_light, 0.2)
    scatter(m, c, choc_light, 0.08, 20)
    mi = scoop(29.5, 8.2, 5.6, mint, mint_dark, mint_light, 0.4)
    scatter(m, mi & ~region(m, 8, 23, 19, 33), chip, 0.1, 21)
    st = scoop(37, 7.2, 5.0, straw, straw_dark, straw_light, 0.1)
    scatter(m, st, straw_dark, 0.08, 22)

    # Chocolate drips running down the cone.
    for x, length in ((6, 4), (9, 3), (19, 5), (22, 3)):
        m.paint_face(region(m, x, 18 - length, x, 18), choc, face="front")
    for z, length in ((6, 4), (10, 2), (15, 5)):
        m.paint_face(m.box_mask(0, 18 - length, z, 27, 18, z), choc, face="left")
        m.paint_face(m.box_mask(0, 18 - length, z, 27, 18, z), choc, face="right")

    # Rainbow sprinkles all over the strawberry scoop.
    rng = np.random.default_rng(23)
    top = exposed(m) & st & (ys > 34)
    spots = np.argwhere(top)
    for i in rng.choice(len(spots), size=min(34, len(spots)), replace=False):
        x, y, z = spots[i]
        colour = sprinkles[i % len(sprinkles)]
        m.paint(m.box_mask(x, y, z, x + (i % 2), y, z + (1 - i % 2)) & exposed(m), colour)

    # The cherry on top.
    m.sphere(cx, 43.2, cz, 2.3, cherry)
    m.paint(m.ellipsoid_mask(cx - 1, 44, cz - 1, 1.2, 1.2, 1.2) & exposed(m), cherry_light)
    m.paint(m.ellipsoid_mask(cx, 41.5, cz, 2.5, 0.8, 2.5) & exposed(m), cherry_dark)
    m.box(cx, 45, cz, cx, 46, cz, stem)
    m.box(cx + 1, 46, cz, cx + 2, 46, cz, "#6fbf3a")

    # A happy face on the mint scoop.
    for x0 in (10, 15):
        m.pixels(x0, 28, ["hkk", "kkk", "kkk", ".k."], {"k": BLACK, "h": WHITE})
    m.pixels(11, 25, ["kkkkkk", ".krrk.", "..kk.."], {"k": BLACK, "r": "#ff6f91"})
    m.pixels(8, 28, ["pp........pp"], {"p": "#ff9fbf"})


# -- 10. Lasagno Leoncino -------------------------------------------------------


@design("LasagnoLeoncino", width=26, height=34, depth=40)
def lasagno_leoncino(m):
    pasta, pasta_dark, pasta_light = "#f3c663", "#d9a441", "#fbe29a"
    sauce = "#c7321f"
    ricotta, ricotta_shade = "#fbf6e9", "#e5dcc6"
    mane, mane_dark, mane_light = "#ffab1f", "#e07f00", "#ffd45e"
    baked, baked_dark = "#f2b13f", "#b3661a"
    basil, basil_light = "#2f9a3a", "#58c060"
    nose, blush = "#8a2418", "#f49a7a"
    layers = (pasta, pasta, sauce, ricotta)

    def stripes(mask, y0):
        for y in range(m.height):
            m.paint(mask & m.box_mask(0, y, 0, m.width - 1, y, m.depth - 1), layers[(y - y0) % 4])

    # Four lasagna legs with cheesy paws.
    for x0, z0, phase in ((5, 10, 0), (17, 10, 1), (5, 27, 1), (17, 27, 0)):
        leg = m.limb("Leg", pivot=(x0 + 2, 10, z0 + 2), phase=phase)
        m.box(x0, 2, z0, x0 + 3, 9, z0 + 3, pasta, part=leg)
        stripes(m.box_mask(x0, 2, z0, x0 + 3, 9, z0 + 3), 2)
        m.box(x0, 0, z0 - 1, x0 + 3, 1, z0 + 3, ricotta, part=leg)
        m.pixels(x0, 0, [".s.s"], {"s": ricotta_shade})

    # The body: a slab of lasagna, layers showing on every side.
    m.box(4, 10, 8, 21, 21, 33, pasta)
    stripes(m.box_mask(4, 10, 8, 21, 20, 33), 10)
    # Wavy pasta edges poke out along the sides.
    for y in (10, 14, 18):
        for z in range(9, 33):
            if (z // 2) % 2 == 0:
                m.box(3, y, z, 3, y + 1, z, pasta_dark if y == 10 else pasta)
                m.box(22, y, z, 22, y + 1, z, pasta_dark if y == 10 else pasta)
    # Golden baked cheese on top, browned in spots, with a basil leaf.
    m.box(4, 21, 8, 21, 21, 33, baked)
    scatter(m, m.box_mask(4, 21, 8, 21, 21, 33), baked_dark, 0.12, 30)
    scatter(m, m.box_mask(4, 21, 8, 21, 21, 33), mane_light, 0.12, 31)
    m.paint(m.box_mask(12, 21, 22, 14, 21, 26), basil)
    m.paint(m.box_mask(13, 21, 22, 13, 21, 26), basil_light)
    # Sauce dripping down the sides.
    for z, length in ((12, 2), (19, 3), (26, 2), (30, 3)):
        m.box(3, 16 - length, z, 3, 16, z, sauce)
        m.box(22, 16 - length + 1, z + 1, 22, 16, z + 1, sauce)

    # A tail: a strip of pasta with a basil leaf at the tip.
    tail = m.limb("Tail", pivot=(13, 18.5, 34))
    m.line((13, 18.5, 33.5), (13, 22, 36.5), 1.0, pasta, part=tail)
    m.line((13, 22, 36.5), (13, 26.5, 37.5), 1.0, pasta, part=tail)
    m.ellipsoid(13, 29.5, 37.5, 0.9, 2.6, 1.7, basil, part=tail)
    m.paint(m.ellipsoid_mask(13, 29.5, 37.5, 1, 2.6, 0.5), basil_light)

    # The head: a golden melted-cheese mane round a cute lion cub face.
    head = m.limb("Head", pivot=(13, 19, 8))
    m.mask(m.ellipsoid_mask(13, 24, 6, 10, 9.5, 3), mane, part=head)
    for i in range(16):
        a = i / 16 * 2 * math.pi
        m.sphere(13 + math.cos(a) * 9, 24 + math.sin(a) * 8.6, 6, 2.0, mane_light if i % 2 else mane, part=head)
    for x, length in ((5, 3), (8, 4), (17, 4), (20, 3)):
        m.box(x, 16 - length, 5, x + 1, 16, 6, mane, part=head)
        m.box(x, 16 - length, 5, x + 1, 16 - length, 6, mane_dark, part=head)
    scatter(m, m.ellipsoid_mask(13, 24, 6, 12, 12, 5), mane_dark, 0.06, 33)
    m.mask(rounded_box_mask(m, 7, 17, 1, 18, 29, 7, 1.5), pasta, part=head)
    m.paint_face(m.box_mask(7, 28, 0, 18, 29, 25), pasta_light, face="front")
    m.mask(rounded_box_mask(m, 9, 17, 0, 16, 21, 2, 1.0), ricotta, part=head)
    m.pixels(11, 20, ["nhnn", ".nn."], {"n": nose, "h": "#c4503c"})
    m.pixels(10, 17, ["k....k", ".kkkk.", "..pp.."], {"k": BLACK, "p": "#ff7a8a"})
    m.pixels(10, 19, ["s....s"], {"s": ricotta_shade})
    for x0 in (8, 15):
        m.pixels(x0, 23, ["hkk", "kkk", "kkk"], {"k": BLACK, "h": WHITE})
    m.pixels(8, 21, ["p........p"], {"p": blush})
    for x0 in (6, 17):
        m.box(x0, 29, 3, x0 + 2, 31, 4, pasta, part=head)
        m.pixels(x0, 29, [".s.", "sss"], {"s": sauce})
