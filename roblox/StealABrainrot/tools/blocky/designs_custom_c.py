"""Block-built brainrots, batch custom_c: original Italian brainrots themed on
classic Roblox things (Dominus, Headless, the logo, the ban hammer, Sparkle
Time, Robux, admins, the oof noob and the guest)."""

import math

import numpy as np

from blocky import design

BLACK = "#141419"
WHITE = "#ffffff"


# -- helpers -------------------------------------------------------------------


def centres(m):
    """Voxel centres (x, y, z) as grids the size of the model."""
    return np.meshgrid(
        np.arange(m.width) + 0.5, np.arange(m.height) + 0.5, np.arange(m.depth) + 0.5, indexing="ij"
    )


def rows_of(m, y0, y1):
    """Every voxel with y0 <= y <= y1."""
    return m.box_mask(0, y0, 0, m.width - 1, y1, m.depth - 1)


def exposed(m):
    """Filled voxels with at least one empty neighbour."""
    g = m.grid > 0
    p = np.pad(g, 1)
    inner = (
        p[:-2, 1:-1, 1:-1] & p[2:, 1:-1, 1:-1] & p[1:-1, :-2, 1:-1]
        & p[1:-1, 2:, 1:-1] & p[1:-1, 1:-1, :-2] & p[1:-1, 1:-1, 2:]
    )
    return g & ~inner


def ellipse_prism(m, cx, cz, rx, rz, y0, y1):
    """An upright elliptic prism (a flat disc when y0 == y1)."""
    xs, _, zs = centres(m)
    return (((xs - cx) / rx) ** 2 + ((zs - cz) / rz) ** 2 <= 1) & rows_of(m, y0, y1)


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1):
    """A box with its twelve edges bevelled off by one voxel."""
    xs, ys, zs = centres(m)
    ix, iy, iz = xs - 0.5, ys - 0.5, zs - 0.5
    ex = (ix == x0) | (ix == x1)
    ey = (iy == y0) | (iy == y1)
    ez = (iz == z0) | (iz == z1)
    return m.box_mask(x0, y0, z0, x1, y1, z1) & ~((ex & ey) | (ey & ez) | (ex & ez))


def line_mask(m, start, end, radius):
    xs, ys, zs = centres(m)
    p = np.stack([xs, ys, zs], axis=-1)
    a, b = np.array(start, dtype=float), np.array(end, dtype=float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(1e-9, ab @ ab), 0, 1)
    closest = a + t[..., None] * ab
    return np.linalg.norm(p - closest, axis=-1) <= radius


def stamp(m, face, a0, y0, rows, colours, lift=1, part=0, within=None):
    """Pixel art raised `lift` voxels off a curved surface (front, back, left
    or right). a0 is x for front/back and z for left/right; rows[0] is the top.
    The surface is measured before anything is placed, so a stamp never
    stacks on itself."""
    filled = m.grid > 0
    if within is not None:
        filled = filled & within
    height = len(rows)
    for r, row in enumerate(rows):
        y = y0 + height - 1 - r
        if not 0 <= y < m.height:
            continue
        for c, char in enumerate(row):
            if char not in colours:
                continue
            a = a0 + c
            if face in ("front", "back"):
                if not 0 <= a < m.width:
                    continue
                hits = np.nonzero(filled[a, y, :])[0]
                limit = m.depth
            else:
                if not 0 <= a < m.depth:
                    continue
                hits = np.nonzero(filled[:, y, a])[0]
                limit = m.width
            if len(hits) == 0:
                continue
            pos = hits[0] - lift if face in ("front", "left") else hits[-1] + lift
            if not 0 <= pos < limit:
                continue
            if face in ("front", "back"):
                m.voxel(a, y, pos, colours[char], part=part)
            else:
                m.voxel(pos, y, a, colours[char], part=part)


def top_art(m, x0, z0, rows, colours, within=None):
    """Paints pixel art on the top surface; rows[0] is the far (back) row, so
    it reads upright when seen from the front and above."""
    top = m.surface("top")
    count = len(rows)
    for r, row in enumerate(rows):
        z = z0 + count - 1 - r
        for c, char in enumerate(row):
            if char not in colours:
                continue
            mask = m.box_mask(x0 + c, 0, z, x0 + c, m.height - 1, z) & top
            if within is not None:
                mask &= within
            m.paint(mask, colours[char])


def carve(m, x0, y0, rows, colours, depth=1, part=0):
    """Cuts pixel art into the front surface: each pixel removes `depth`
    voxels and colours the voxel behind them (a lit carving)."""
    filled = m.grid > 0
    height = len(rows)
    for r, row in enumerate(rows):
        y = y0 + height - 1 - r
        for c, char in enumerate(row):
            if char not in colours:
                continue
            x = x0 + c
            hits = np.nonzero(filled[x, y, :])[0]
            if len(hits) == 0:
                continue
            s = hits[0]
            m.clear(m.box_mask(x, y, s, x, y, s + depth - 1))
            m.box(x, y, s + depth, x, y, s + depth, colours[char], part=part)


FONT = {
    "O": ["###", "#.#", "#.#", "#.#", "###"],
    "F": ["###", "#..", "##.", "#..", "#.."],
    "o": [".##.", "#..#", "#..#", "#..#", ".##."],
    "f": ["####", "#...", "###.", "#...", "#..."],
    "B": ["##.", "#.#", "##.", "#.#", "##."],
    "A": [".#.", "#.#", "###", "#.#", "#.#"],
    "N": ["#..#", "##.#", "#.##", "#..#", "#..#"],
}


def text_rows(text, gap=1):
    rows = ["" for _ in range(5)]
    for i, char in enumerate(text):
        for r in range(5):
            rows[r] += FONT[char][r] + ("." * gap if i < len(text) - 1 else "")
    return rows


def mirrored(rows):
    return [row[::-1] for row in rows]


def sparkle(m, x, y, z, colours, arm=2, part=0):
    """A 3D twinkle: a bright centre with arms along every axis."""
    core, ray, tip = colours
    for d in range(1, arm + 1):
        colour = ray if d < arm else tip
        m.box(x, y - d, z, x, y + d, z, colour, part=part)
    m.box(x - 1, y, z, x + 1, y, z, ray, part=part)
    m.box(x, y, z - 1, x, y, z + 1, ray, part=part)
    m.voxel(x, y, z, core, part=part)


# -- 1. Dominusso Cappuccinoso ----------------------------------------------------


@design("DominussoCappuccinoso", width=34, height=47, depth=26)
def dominusso_cappuccinoso(m):
    cx, cz = 17, 13
    navy, navy_dark, navy_light = "#1f2850", "#121833", "#35437d"
    gold, gold_dark, gold_light = "#f5c332", "#b8861a", "#ffe58a"
    void, glow, glow_core = "#05060b", "#5ff0ff", "#ffffff"
    gem, gem_light = "#e8265f", "#ff9cc0"
    cup, cup_shade, cup_dark = "#fbfaf6", "#e4ddd2", "#c9bfb0"
    foam, crema, crema_edge = "#f8eedc", "#c48650", "#dcae7c"
    xs, ys, zs = centres(m)
    rxz = np.hypot(xs - cx, zs - cz)

    # Two small navy legs in gold Dominus shoes.
    left = m.limb("Leg", pivot=(14, 6, 13), phase=0)
    right = m.limb("Leg", pivot=(20, 6, 13), phase=1)
    for part, x0 in ((left, 12), (right, 18)):
        m.box(x0, 2, 11, x0 + 3, 5, 14, navy, part=part)
        m.box(x0, 4, 11, x0 + 3, 4, 14, gold, part=part)
        m.box(x0, 0, 9, x0 + 3, 1, 14, gold, part=part)
        m.box(x0, 0, 9, x0 + 3, 0, 14, gold_dark, part=part)
        m.box(x0 + 1, 1, 9, x0 + 2, 1, 9, gold_light, part=part)

    # The saucer, with a gold edge.
    m.mask(rows_of(m, 6, 6) & (rxz <= 8.5), cup_shade)
    m.mask(rows_of(m, 7, 7) & (rxz <= 12.8), cup)
    m.mask(rows_of(m, 8, 8) & (rxz <= 12.8) & (rxz > 10.6), cup)
    m.paint(rows_of(m, 7, 7) & (rxz > 11.6), cup_shade)
    m.paint(rows_of(m, 8, 8) & (rxz > 11.8), gold)
    # A silver teaspoon resting on the saucer.
    m.mask(line_mask(m, (24.2, 8.9, 6.6), (29.5, 9.9, 2.4), 0.62), "#c3c9d2")
    m.mask(m.ellipsoid_mask(23.6, 8.5, 7.2, 1.5, 0.7, 1.9) & rows_of(m, 8, 8), "#dfe3e8")

    # The handle, a thick C on the right.
    ring = ((xs - 27.2) / 5.4) ** 2 + ((ys - 17.5) / 6.2) ** 2 <= 1
    hole = ((xs - 27.2) / 2.7) ** 2 + ((ys - 17.5) / 3.5) ** 2 <= 1
    handle = ring & ~hole & (xs > 24) & m.box_mask(0, 0, 11, m.width - 1, m.height - 1, 14)
    m.mask(handle, cup)
    m.paint(handle & (xs > 30.5), cup_shade)
    m.paint(handle & rows_of(m, 22, 23) & (xs > 26), gold)

    # The cup: white china that widens to the rim, with gold lines.
    m.mask(rows_of(m, 8, 8) & (rxz <= 7.2), cup_dark)
    cup_mask = m.cylinder_mask(cx, 9, cz, 8, 17, radius2=11)
    m.mask(cup_mask, cup)
    shell = exposed(m) & cup_mask
    m.paint(shell & rows_of(m, 9, 10), cup_shade)
    m.paint(shell & rows_of(m, 11, 11), gold)
    m.paint(shell & rows_of(m, 25, 25), gold)
    m.paint(shell & rows_of(m, 24, 24), gold_dark)
    # A soft highlight down the front-left of the china.
    angle = np.arctan2(zs - cz, xs - cx)
    m.paint(shell & rows_of(m, 13, 22) & (np.abs(angle + 2.25) < 0.18), WHITE)
    m.paint(shell & rows_of(m, 12, 23) & (np.abs(angle + 0.9) < 0.22), cup_shade)
    # The Dominus crest on the cup: a little navy hood with gold eyes.
    crest = [
        "...gg...",
        "..gnng..",
        ".gnnnng.",
        ".gnkkng.",
        "gnkcckng",
        "gnkkkkng",
        "gggggggg",
    ]
    m.pixels(13, 14, crest, {"g": gold, "n": navy, "k": void, "c": glow})
    m.pixels(13, 14, crest, {"g": gold, "n": navy, "k": void, "c": glow}, face="back")

    # Foam over the rim; the crema shows a latte-art heart in front of the hood.
    foam_mask = m.ellipsoid_mask(cx, 26, cz, 10.6, 3.8, 10.6) & rows_of(m, 26, 31)
    m.mask(foam_mask, foam)
    m.paint(foam_mask & (rxz < 9.4), crema)
    m.paint(foam_mask & (rxz < 9.4) & (rxz > 8.4), crema_edge)
    heart = [
        ".hh..hh.",
        "hhhhhhhh",
        "hhhhhhhh",
        ".hhhhhh.",
        "..hhhh..",
        "...hh...",
    ]
    top_art(m, 13, 3, heart, {"h": foam}, within=foam_mask)

    # The Dominus hood rising out of the cup: a tall navy cowl, pointed and
    # swept back, with a gold-trimmed face opening and glowing eyes.
    hood = m.limb("Head", pivot=(cx, 27, 17.5))
    profile = [
        (27, 8.8, 7.4, 17.5), (28, 8.3, 7.1, 17.5), (29, 7.9, 6.9, 17.5), (30, 7.7, 6.8, 17.5),
        (31, 7.7, 6.8, 17.5), (32, 7.6, 6.8, 17.5), (33, 7.6, 6.8, 17.5), (34, 7.4, 6.7, 17.6),
        (35, 7.2, 6.6, 17.7), (36, 7.0, 6.4, 17.8), (37, 6.7, 6.2, 18.0), (38, 6.3, 5.9, 18.2),
        (39, 5.8, 5.5, 18.5), (40, 5.2, 5.0, 18.8), (41, 4.6, 4.5, 19.2), (42, 3.9, 3.9, 19.6),
        (43, 3.2, 3.3, 20.0), (44, 2.4, 2.5, 20.4), (45, 1.6, 1.8, 20.8), (46, 0.9, 1.1, 21.2),
    ]
    hood_mask = np.zeros(m.grid.shape, dtype=bool)
    for y, rx, rz, zc in profile:
        hood_mask |= ellipse_prism(m, cx, zc, rx, rz, y, y)
    m.mask(hood_mask, navy, part=hood)
    m.paint(hood_mask & exposed(m) & (zs > 20.5), navy_dark)
    m.paint(hood_mask & rows_of(m, 27, 27), gold)
    m.paint(hood_mask & rows_of(m, 28, 28) & exposed(m), gold_dark)

    widths = {29: 3.6, 30: 4.4, 31: 4.6, 32: 4.6, 33: 4.6, 34: 4.6, 35: 4.4, 36: 4.0, 37: 3.4, 38: 2.6, 39: 1.6}
    opening = np.zeros(m.grid.shape, dtype=bool)
    for y, w in widths.items():
        opening |= rows_of(m, y, y) & (np.abs(xs - cx) <= w)
    m.clear(opening & (zs < 13))
    m.paint_face(opening & hood_mask, void, face="front")
    trim = {}
    for y in range(28, 41):
        inner = widths.get(y, -1)
        outer = max(widths.get(y - 1, -1), inner, widths.get(y + 1, -1)) + 1.3
        for x in range(m.width):
            d = abs(x + 0.5 - cx)
            if inner < d <= outer:
                trim[(x, y)] = gold if d > inner + 0.6 or y > 37 else gold_light
    for (x, y), colour in trim.items():
        stamp(m, "front", x, y, ["t"], {"t": colour}, lift=1, part=hood, within=hood_mask)
    # Glowing eyes in the dark.
    m.pixels(13, 33, ["gwg", "ggg"], {"g": glow, "w": glow_core})
    m.pixels(18, 33, ["gwg", "ggg"], {"g": glow, "w": glow_core})
    # A gem on the brow and a gold ridge down the back.
    stamp(m, "front", 16, 41, ["gg", "rr", "gg"], {"g": gold, "r": gem}, lift=1, part=hood, within=hood_mask)
    m.pixels(16, 42, ["w"], {"w": gem_light})
    m.paint_face(m.box_mask(16, 28, 0, 17, 46, m.depth - 1) & hood_mask, gold, face="back")
    m.paint(hood_mask & exposed(m) & m.box_mask(0, 29, 0, m.width - 1, 36, m.depth - 1)
            & (np.abs(np.abs(xs - cx) - 6.2) < 0.5) & (zs > 14) & (zs < 21), navy_light)


# -- 2. Headlesso Zuccone ----------------------------------------------------------


@design("HeadlessoZuccone", width=34, height=42, depth=22)
def headlesso_zuccone(m):
    cx = 17
    coat, coat_light = "#1c1b24", "#2f2d3b"
    orange, orange_dark, orange_light = "#ff8a1f", "#cf5f0a", "#ffb45c"
    vest, belt = "#4b2466", "#3a2416"
    pants, boot, boot_light, sole = "#2b2a33", "#2a1b12", "#4a3321", "#110b07"
    glove = "#3a3945"
    flame_dark, flame, flame_light, flame_core = "#159a3d", "#35e05a", "#a8ff6e", "#efffc8"
    pumpkin, pumpkin_dark, pumpkin_light = "#f0700f", "#b84c06", "#ff9a3c"
    stem, glow, glow_light = "#4d6a1f", "#ffe23a", "#fff6a8"
    cape, cape_light = "#17131d", "#282133"
    xs, ys, zs = centres(m)

    # Legs: charcoal trousers and tall riding boots with orange buckles.
    left = m.limb("Leg", pivot=(14, 14, 10.5), phase=0)
    right = m.limb("Leg", pivot=(20, 14, 10.5), phase=1)
    for part, x0 in ((left, 12), (right, 18)):
        m.box(x0, 8, 8, x0 + 3, 13, 12, pants, part=part)
        m.box(x0, 1, 8, x0 + 3, 5, 12, boot, part=part)
        m.box(x0, 0, 5, x0 + 3, 2, 12, boot, part=part)
        m.box(x0, 0, 5, x0 + 3, 0, 12, sole, part=part)
        m.box(x0, 6, 7, x0 + 3, 7, 13, boot_light, part=part)
        m.paint(m.box_mask(x0, 3, 5, x0 + 3, 3, 12), orange_dark)
        m.paint(m.box_mask(x0 + 1, 3, 0, x0 + 2, 3, 8), orange_light)
        m.paint(m.box_mask(x0, 2, 5, x0 + 3, 2, 6), boot_light)

    # A flowing cape behind, lined with orange along the edges and hem.
    for y in range(5, 29):
        t = (28 - y) / 23
        hw = 6.0 + 6.0 * t
        zb = 14 + 3.0 * t
        for x in range(m.width):
            dx = x + 0.5 - cx
            if abs(dx) > hw:
                continue
            wave = math.sin(dx * 1.05)
            z0 = int(round(zb + 1.4 * t * wave))
            colour = cape_light if wave > 0.8 else cape
            if abs(dx) > hw - 1 or y <= 6:
                colour = orange if y > 5 else orange_dark
            m.box(x, y, z0, x, y, z0 + 1, colour)

    # The black suit: coat, purple waistcoat, orange piping and buttons.
    m.box(10, 14, 7, 23, 28, 13, coat)
    m.paint(m.box_mask(15, 19, 0, 18, 28, 7), vest)
    m.paint(m.box_mask(14, 18, 0, 14, 28, 7), orange)
    m.paint(m.box_mask(19, 18, 0, 19, 28, 7), orange)
    m.paint(m.box_mask(12, 25, 0, 13, 28, 7), coat_light)
    m.paint(m.box_mask(20, 25, 0, 21, 28, 7), coat_light)
    for y in (20, 23, 26):
        m.paint(m.box_mask(16, y, 0, 17, y, 7), orange_light)
    m.paint(m.box_mask(10, 16, 0, 23, 17, 21), belt)
    m.paint(m.box_mask(15, 16, 0, 18, 17, 7), orange)
    m.paint(m.box_mask(16, 16, 0, 17, 17, 7), orange_dark)
    m.paint(exposed(m) & m.box_mask(10, 14, 7, 23, 14, 13), orange)
    # Coat tails at the back.
    m.box(11, 8, 13, 15, 13, 14, coat)
    m.box(18, 8, 13, 22, 13, 14, coat)
    m.paint(m.box_mask(11, 8, 13, 22, 8, 14), orange)
    # Orange epaulettes.
    for x0 in (7, 23):
        m.box(x0, 28, 8, x0 + 3, 29, 12, orange)
        m.paint(m.box_mask(x0, 29, 8, x0 + 3, 29, 12), orange_light)
        m.paint(m.box_mask(x0, 28, 8, x0 + 3, 28, 8), orange_dark)

    # The flat collar where the head should be, with a standing collar behind.
    m.mask(ellipse_prism(m, cx, 10.5, 7.2, 4.6, 29, 30), coat)
    rim = ellipse_prism(m, cx, 10.5, 7.2, 4.6, 30, 30) & ~ellipse_prism(m, cx, 10.5, 5.6, 3.3, 30, 30)
    m.paint(rim, orange)
    m.paint(ellipse_prism(m, cx, 10.5, 3.7, 2.7, 30, 30), "#0a090d")
    m.box(12, 31, 14, 21, 31, 15, coat)
    m.paint(m.box_mask(12, 31, 14, 21, 31, 14), orange_dark)

    # A little green flame burning out of the collar (it flickers like a head).
    head = m.limb("Head", pivot=(cx, 31, 10.5))
    flame_rows = [
        (40, "....x.", 10, 10),
        (39, "....x.", 10, 11),
        (38, "...xx.", 10, 11),
        (37, ".x.xx.", 10, 11),
        (36, ".xxxx.", 9, 11),
        (35, "xxxxxx", 9, 12),
        (34, "xxxxxx", 9, 12),
        (33, "xxxxxx", 9, 12),
        (32, ".xxxx.", 9, 12),
        (31, "..xx..", 10, 11),
    ]
    shades = {31: flame_dark, 32: flame_dark, 33: flame, 34: flame, 35: flame, 36: flame_light,
              37: flame_light, 38: flame_light, 39: flame_core, 40: flame_core}
    for y, row, z0, z1 in flame_rows:
        for c, char in enumerate(row):
            if char == "x":
                m.box(14 + c, y, z0, 14 + c, y, z1, shades[y], part=head)
    m.pixels(15, 33, [".cc.", "cwwc", ".ww."], {"w": flame_core, "c": flame_light})

    # Arms in black sleeves with orange cuffs.
    left_arm = m.limb("Arm", pivot=(8, 27.5, 10.5), phase=0)
    right_arm = m.limb("Arm", pivot=(26, 27.5, 10.5), phase=1)
    for part, x0 in ((left_arm, 6), (right_arm, 24)):
        m.box(x0, 17, 8, x0 + 3, 27, 12, coat, part=part)
        m.box(x0, 17, 8, x0 + 3, 18, 12, orange, part=part)
        m.box(x0, 14, 8, x0 + 3, 16, 12, glove, part=part)
    m.box(6, 24, 8, 6, 27, 12, coat_light, part=left_arm)
    m.box(27, 24, 8, 27, 27, 12, coat_light, part=right_arm)

    # The glowing jack-o'-lantern held out in the right hand, its face carved
    # in and lit from inside.
    pc = (27.5, 12.5, 4.2)
    pumpkin_mask = m.ellipsoid_mask(pc[0], pc[1], pc[2], 5.3, 4.6, 4.6)
    m.mask(pumpkin_mask, pumpkin, part=right_arm)
    phi = np.arctan2(zs - pc[2], xs - pc[0])
    ridge = np.abs(np.sin(3.5 * phi)) < 0.3
    m.paint(pumpkin_mask & ridge, pumpkin_dark)
    m.paint(pumpkin_mask & ((ys < 9.3) | (ys > 16.2)) & ~ridge, pumpkin_dark)
    m.paint(pumpkin_mask & (ys > 14) & (ys < 16.5) & (xs < 26) & (zs < 2.5) & ~ridge, pumpkin_light)
    m.box(27, 17, 3, 28, 18, 4, stem, part=right_arm)
    m.voxel(29, 18, 4, "#6f8f2c", part=right_arm)
    m.voxel(29, 18, 5, "#6f8f2c", part=right_arm)
    jack = [
        ".Y.....Y.",
        "YyY...YyY",
        "....Y....",
        "Y.......Y",
        "yY.YyY.Yy",
        ".yyyyyyy.",
    ]
    carve(m, 23, 10, jack, {"y": glow_light, "Y": glow}, depth=1, part=right_arm)


# -- 3. Robotino Robloxino ------------------------------------------------------------


@design("RobotinoRobloxino", width=36, height=44, depth=16)
def robotino_robloxino(m):
    cx, cy, tilt = 18, 26, -15.0
    metal, metal_dark, metal_light = "#8e949d", "#61666f", "#c5cad1"
    metal_mid, steel, bolt = "#767c85", "#3a3e46", "#dde1e6"
    visor, visor_light, visor_dark = "#1fd6f2", "#aefaff", "#0b7f99"
    red, red_light, red_dark = "#ff2b2b", "#ffa3a3", "#b01212"
    xs, ys, _ = centres(m)
    t = math.radians(tilt)
    u = (xs - cx) * math.cos(t) + (ys - cy) * math.sin(t)
    v = -(xs - cx) * math.sin(t) + (ys - cy) * math.cos(t)

    def at(uu, vv):
        """The voxel (x, y) under a point given in the logo's own tilted axes."""
        x = cx + uu * math.cos(t) - vv * math.sin(t)
        y = cy + uu * math.sin(t) + vv * math.cos(t)
        return int(math.floor(x)), int(math.floor(y))

    # Legs first: a hip block, then stompy metal legs.
    left = m.limb("Leg", pivot=(15, 10, 8.5), phase=0)
    right = m.limb("Leg", pivot=(21, 10, 8.5), phase=1)
    for part, x0 in ((left, 13), (right, 19)):
        m.box(x0, 5, 6, x0 + 3, 9, 10, metal, part=part)
        m.box(x0, 9, 6, x0 + 3, 9, 10, steel, part=part)
        m.box(x0, 4, 5, x0 + 3, 4, 11, steel, part=part)
        m.box(x0, 2, 6, x0 + 3, 3, 10, metal, part=part)
        m.box(x0 - 1, 0, 4, x0 + 4, 1, 10, metal_dark, part=part)
        m.box(x0, 1, 4, x0 + 3, 1, 4, visor, part=part)
        m.box(x0, 6, 5, x0 + 3, 7, 5, metal_light, part=part)
    m.box(13, 10, 6, 22, 13, 10, steel)
    m.box(15, 13, 6, 20, 18, 10, steel)
    m.paint(m.box_mask(13, 12, 6, 22, 12, 10), metal_mid)

    # The body is the tilted Roblox logo: a thick grey square with a square hole.
    slab = (np.abs(u) <= 10) & (np.abs(v) <= 10) & m.box_mask(0, 0, 5, m.width - 1, m.height - 1, 11)
    m.mask(slab, metal_dark)
    plate = (np.abs(u) <= 9.2) & (np.abs(v) <= 9.2) & m.box_mask(0, 0, 4, m.width - 1, m.height - 1, 4)
    m.mask(plate, metal)
    rim = slab & ~plate & m.box_mask(0, 0, 5, m.width - 1, m.height - 1, 5)
    m.paint(rim & ((v > 7) | (u < -7)), metal_light)
    hole = (np.abs(u) <= 3.1) & (np.abs(v) <= 3.1)
    m.paint(slab & (np.maximum(np.abs(u), np.abs(v)) <= 4.3), steel)
    m.clear(hole)
    # Back: vents and bolts.
    back = m.surface("back") & slab
    m.paint(back & (np.abs(u) <= 6.5) & (v < -4.5) & (v > -8.5) & (np.floor(v * 1.0) % 2 == 0), steel)
    m.paint(back & (np.abs(u) <= 6.5) & (v > 4.5) & (v < 8.5), metal)
    for su in (-8, 8):
        for sv in (-8, 8):
            m.paint(back & ((u - su) ** 2 + (v - sv) ** 2 < 0.9), bolt)

    # Face on the front plate (one voxel proud): a cyan visor with eyes, a smile.
    front = m.box_mask(0, 0, 3, m.width - 1, m.height - 1, 3)
    frame = (np.abs(u) <= 7.9) & (v >= 3.3) & (v <= 8.2)
    m.mask(front & frame, steel)
    glass = (np.abs(u) <= 6.9) & (v >= 4.3) & (v <= 7.3)
    m.mask(front & glass, visor_dark)
    for side in (-1, 1):
        eye = (np.abs(u - side * 3.5) <= 1.7) & (v >= 4.4) & (v <= 7.2)
        m.paint(front & eye, visor)
        eye_core = (np.abs(u - side * 3.5) <= 0.9) & (v >= 5.0) & (v <= 6.6)
        m.paint(front & eye_core, visor_light)
        x, y = at(side * 3.5 - 0.6, 6.2)
        m.paint(m.box_mask(x, y, 3, x, y, 3), WHITE)
    smile = (np.abs(u) <= 5.2) & (np.abs(v - (-7.4 + 0.085 * u ** 2)) <= 0.62)
    m.mask(front & smile, visor)
    m.paint(front & smile & (np.abs(u) <= 2.5), visor_light)
    for su in (-8.3, 8.3):
        for sv in (-8.3, 8.3):
            x, y = at(su, sv)
            m.box(x, y, 3, x, y, 3, bolt)

    # An antenna on the top corner with a red light.
    tx, ty = at(-10, 10)
    m.box(tx - 1, ty - 1, 7, tx + 1, ty, 9, steel)
    m.box(tx, ty + 1, 8, tx, ty + 3, 8, steel)
    m.box(tx - 1, ty + 4, 7, tx + 1, ty + 6, 9, red)
    m.voxel(tx - 1, ty + 6, 7, red_light)
    m.voxel(tx - 1, ty + 5, 7, red_light)
    m.box(tx + 1, ty + 4, 9, tx + 1, ty + 4, 9, red_dark)

    # Metal arms: ball shoulders, elbows and pincer hands.
    for phase, ax in ((0, 2), (1, 31)):
        part = m.limb("Arm", pivot=(ax + 1.5, 30, 8.5), phase=phase)
        m.sphere(ax + 1.5, 30, 8.5, 2.3, steel, part=part)
        if phase == 0:
            m.box(ax + 3, 29, 7, ax + 6, 31, 10, metal_dark, part=part)
        else:
            m.box(ax - 2, 28, 7, ax - 1, 30, 10, metal_dark, part=part)
        m.box(ax, 23, 7, ax + 2, 28, 9, metal, part=part)
        m.box(ax, 23, 7, ax, 28, 9, metal_light, part=part)
        m.sphere(ax + 1.5, 22, 8.5, 1.8, steel, part=part)
        m.box(ax, 16, 7, ax + 2, 21, 9, metal, part=part)
        m.box(ax, 16, 7, ax, 21, 9, metal_light, part=part)
        m.box(ax - 1, 15, 6, ax + 3, 15, 10, steel, part=part)
        m.box(ax - 1, 12, 6, ax + 3, 14, 10, metal_dark, part=part)
        m.box(ax - 1, 10, 6, ax + 3, 11, 6, metal_light, part=part)
        m.box(ax - 1, 10, 10, ax + 3, 11, 10, metal_light, part=part)
        m.box(ax + 1, 13, 5, ax + 1, 13, 5, visor, part=part)


# -- 4. Aeroplanino Paninino ------------------------------------------------------------


@design("AeroplaninoPaninino", width=46, height=24, depth=36)
def aeroplanino_paninino(m):
    cx = 23
    crust, crust_dark, crust_light, grill = "#d9963f", "#a9652a", "#efbd72", "#5e3314"
    lettuce, lettuce_dark = "#62d13e", "#3b9c2a"
    ham, ham_dark, ham_fat = "#f28c9c", "#d16a7c", "#ffd3da"
    cheese, cheese_dark = "#ffd23a", "#f0a716"
    tomato, tomato_light, basil = "#e8322b", "#ff8f86", "#2f8f3a"
    stick, stick_dark = "#ecc781", "#b88a45"
    xs, ys, zs = centres(m)
    ix, iy, iz = (xs - 0.5).astype(int), (ys - 0.5).astype(int), (zs - 0.5).astype(int)
    dxa = np.abs(xs - cx)

    # The fuselage is a pressed panini: bread, lettuce, ham, cheese, bread.
    hw = np.zeros(m.depth)
    for z in range(3, 35):
        hw[z] = {3: 3.6, 4: 4.9, 5: 5.6}.get(z, 6.0 if z <= 26 else max(2.0, 6.0 - (z - 26) * 0.5))
    width = hw[None, None, :]
    inside = (dxa <= width) & (width > 0)
    fus = inside & rows_of(m, 3, 13)
    fus &= ~(m.box_mask(0, 3, 3, m.width - 1, 3, 3) | m.box_mask(0, 13, 3, m.width - 1, 13, 3))
    m.mask(fus & rows_of(m, 3, 5), crust)
    m.mask(fus & rows_of(m, 6, 6), lettuce)
    m.mask(fus & rows_of(m, 7, 8), ham)
    m.mask(fus & rows_of(m, 9, 9), cheese)
    m.mask(fus & rows_of(m, 10, 13), crust)
    dome = (dxa <= width - 1.8) & (width > 0) & rows_of(m, 14, 14) & m.box_mask(0, 0, 5, m.width - 1, m.height - 1, 31)
    m.mask(dome, crust)
    # Fillings spilling out of the sides.
    edge = (dxa > width) & (dxa <= width + 1) & (width >= 5.5) & m.box_mask(0, 0, 5, m.width - 1, m.height - 1, 27)
    m.mask(edge & rows_of(m, 6, 6) & (iz % 3 != 1), lettuce)
    m.mask(edge & rows_of(m, 5, 5) & (iz % 3 == 0), lettuce_dark)
    m.mask(edge & rows_of(m, 7, 7) & (iz % 5 < 3), ham_dark)
    m.mask(edge & rows_of(m, 9, 9), cheese)
    m.mask(edge & rows_of(m, 7, 8) & (iz % 6 == 2), cheese_dark)
    m.mask(edge & rows_of(m, 8, 8) & (iz % 7 == 4), tomato)
    m.paint(fus & rows_of(m, 7, 8) & (dxa > width - 1) & ((iz + iy) % 4 == 0), ham_fat)
    m.paint(fus & rows_of(m, 3, 3), crust_dark)

    # Bread wings: two thin slices with cheese in between, dripping at the back.
    for x in range(m.width):
        d = abs(x + 0.5 - cx)
        if d < 5.5 or d > 22.4:
            continue
        s = d - 6
        zl, zt = 12 + s * 0.28, 22 - s * 0.2
        if d > 19.2:
            k = (d - 19.2) / 3.2
            mid, half = (zl + zt) / 2, (zt - zl) / 2 * math.sqrt(max(0.0, 1 - k * k))
            zl, zt = mid - half, mid + half
        z0, z1 = int(math.ceil(zl - 0.5)), int(math.floor(zt - 0.5))
        if z1 < z0:
            continue
        m.box(x, 6, z0, x, 6, z1, crust)
        m.box(x, 7, z0, x, 7, z1, cheese)
        m.box(x, 8, z0, x, 8, z1, crust)
        if 8 < d < 19 and x % 4 == 1:
            m.box(x, 5, z1 + 1, x, 7, z1 + 1, cheese_dark)

    # Tail: a bread stabiliser and a fin flying the Italian flag.
    for x in range(m.width):
        d = abs(x + 0.5 - cx)
        if d > 10.5:
            continue
        m.box(x, 11, int(round(28 + d * 0.3)), x, 12, 34, crust)
    for y in range(14, 22):
        m.box(22, y, int(round(26 + (y - 14) * 0.9)), 23, y, 34 if y < 21 else 33, crust)
    m.paint(m.box_mask(22, 15, 29, 23, 17, 30), "#1f9e48")
    m.paint(m.box_mask(22, 15, 31, 23, 17, 32), WHITE)
    m.paint(m.box_mask(22, 15, 33, 23, 17, 34), "#e0282e")

    # Toasty tops with grill marks.
    top = m.surface("top")
    bread_top = top & (m.grid > 0) & ~rows_of(m, 0, 9)
    m.paint(bread_top & ((ix - iz) % 5 == 0), grill)
    wing_top = top & rows_of(m, 8, 8) & (dxa > 7)
    m.paint(wing_top & ((ix - iz) % 5 == 0), grill)
    m.paint(exposed(m) & rows_of(m, 12, 13) & (dxa > width - 0.6) & inside, crust_light)

    # A cocktail stick and an olive on top.
    m.box(23, 15, 11, 23, 18, 11, stick)
    m.box(22, 19, 10, 24, 21, 12, "#7a9a2a")
    m.voxel(23, 20, 9, "#d8322b")
    m.voxel(22, 21, 10, "#9dbd45")

    # The face on the nose: big eyes, brows and a happy mouth.
    eye = [".kk.", "khkk", "kkkk", ".kk."]
    m.pixels(18, 10, eye, {"k": BLACK, "h": WHITE})
    m.pixels(24, 10, eye, {"k": BLACK, "h": WHITE})
    m.pixels(18, 14, ["bbb....bbb"], {"b": grill})
    m.pixels(20, 3, ["bbbbbb", "brrrrb", ".bbbb."], {"b": grill, "r": "#e2505f"})
    m.pixels(17, 5, ["p"], {"p": "#f59a86"})
    m.pixels(28, 5, ["p"], {"p": "#f59a86"})

    # Propeller: a cherry-tomato spinner with breadstick blades.
    prop = m.limb("Prop", pivot=(cx, 8, 1.5), axis="Z")
    m.box(16, 7, 1, 29, 8, 1, stick, part=prop)
    for x in (17, 20, 25, 28):
        m.voxel(x, 8, 1, stick_dark, part=prop)
    m.box(22, 7, 0, 23, 8, 2, tomato, part=prop)
    m.voxel(22, 8, 0, tomato_light, part=prop)
    m.voxel(23, 7, 2, basil, part=prop)


# -- 5. Banhammero Giustiziere --------------------------------------------------------------


@design("BanhammeroGiustiziere", width=42, height=42, depth=18)
def banhammero_giustiziere(m):
    cx, cy, cz = 21, 31, 9
    head_black, head_light, head_dark = "#1d1d24", "#34343f", "#101014"
    red, red_dark = "#e3262f", "#9c1219"
    gold, gold_dark, gold_light = "#f4c330", "#b5841a", "#ffe27a"
    steel, steel_light = "#3d3d48", "#5b5b69"
    wood, wood_dark, grip = "#7b4a2a", "#56321b", "#241915"
    glove, glove_line = "#f7f7f7", "#bdbdc6"
    xs, ys, zs = centres(m)
    dy, dz = np.abs(ys - cy), np.abs(zs - cz)

    def octagon(r, cut):
        return (dy <= r) & (dz <= r) & (dy + dz <= cut)

    # Legs: the handle splits in two, each ending in a gold cap.
    left = m.limb("Leg", pivot=(18, 12, 9), phase=0)
    right = m.limb("Leg", pivot=(24, 12, 9), phase=1)
    for part, x0 in ((left, 16), (right, 22)):
        m.box(x0, 2, 7, x0 + 3, 11, 10, wood, part=part)
        m.box(x0, 5, 7, x0 + 3, 5, 10, wood_dark, part=part)
        m.box(x0, 9, 7, x0 + 3, 9, 10, wood_dark, part=part)
        m.box(x0, 2, 7, x0 + 3, 3, 10, gold_dark, part=part)
    m.box(15, 0, 5, 19, 1, 10, gold, part=left)
    m.box(22, 0, 5, 26, 1, 10, gold, part=right)
    m.box(15, 1, 5, 19, 1, 5, gold_light, part=left)
    m.box(22, 1, 5, 26, 1, 5, gold_light, part=right)

    # The handle is the body: wood with a leather grip and gold collars.
    handle = m.cylinder_mask(cx, 12, cz, 3.3, 12)
    m.mask(handle, wood)
    m.paint(handle & rows_of(m, 14, 20), grip)
    m.paint(handle & rows_of(m, 14, 20) & ((((ys - 0.5).astype(int)) + ((xs - 0.5).astype(int))) % 3 == 0), red_dark)
    m.mask(m.cylinder_mask(cx, 12, cz, 3.9, 2), gold)
    m.mask(m.cylinder_mask(cx, 21, cz, 3.9, 3), gold)
    m.paint(m.cylinder_mask(cx, 13, cz, 3.9, 1) | m.cylinder_mask(cx, 23, cz, 3.9, 1), gold_dark)

    # Arms out of the handle, ending in white cartoon gloves.
    for phase, sign in ((0, -1), (1, 1)):
        part = m.limb("Arm", pivot=(cx + sign * 3, 19.5, 9), phase=phase)
        stub = (15, 17) if sign < 0 else (24, 26)
        arm = (12, 14) if sign < 0 else (27, 29)
        cuff = (11, 15) if sign < 0 else (26, 30)
        m.box(stub[0], 18, 7, stub[1], 20, 10, head_black, part=part)
        m.box(arm[0], 13, 7, arm[1], 20, 10, head_black, part=part)
        m.box(arm[0], 15, 7, arm[1], 15, 10, red, part=part)
        m.box(cuff[0], 12, 6, cuff[1], 12, 11, glove, part=part)
        m.box(cuff[0], 8, 6, cuff[1], 11, 11, glove, part=part)
        m.box(cuff[0], 9, 6, cuff[1], 9, 6, glove_line, part=part)
        m.box(cuff[0], 10, 6, cuff[1], 10, 6, glove, part=part)

    # The giant hammer head: a black octagonal block with red bands, gold rims
    # and steel striking faces that carry the ban sign.
    body = octagon(7, 11) & (xs > 6) & (xs < 36)
    m.mask(body, head_black)
    m.paint(body & (ys > cy + 5.5), head_light)
    m.paint(body & (ys < cy - 5.5), head_dark)
    for x0, x1 in ((8, 9), (32, 33)):
        m.paint(body & m.box_mask(x0, 0, 0, x1, m.height - 1, m.depth - 1), red)
    for x0 in (11, 30):
        m.paint(body & m.box_mask(x0, 0, 0, x0, m.height - 1, m.depth - 1), gold_dark)
    rims = octagon(8, 12.6) & (((xs > 4) & (xs < 6)) | ((xs > 36) & (xs < 38)))
    m.mask(rims, gold)
    m.paint(rims & (ys > cy + 6), gold_light)
    ends = octagon(6.5, 10) & (((xs > 2) & (xs < 4)) | ((xs > 38) & (xs < 40)))
    m.mask(ends, steel)
    m.paint(ends & (ys > cy + 4), steel_light)
    ring = np.hypot(zs - cz, ys - cy)
    for face_x, sign in ((2, 1), (39, -1)):
        plane = m.box_mask(face_x, 0, 0, face_x, m.height - 1, m.depth - 1) & ends
        m.paint(plane & (ring < 4.3), WHITE)
        m.paint(plane & (ring >= 4.3) & (ring < 5.9), red)
        m.paint(plane & (ring < 4.6) & (np.abs((zs - cz) - sign * (ys - cy)) < 1.0), red)

    # The angry face on the front of the head.
    face = [
        "rr..............rr",
        ".rrr..........rrr.",
        "..rrrr......rrrr..",
        "...wwrrr..rrrww...",
        "..wwwwwr..rwwwww..",
        "..wwwhkw..whkwww..",
        "..wwwkkw..wkkwww..",
        "...wwww....wwww...",
        "..................",
        "...mmmmmmmmmmmm...",
        "..mwwkwwkkwwkwwm..",
        "..mwwkwwkkwwkwwm..",
        "..mmmmmmmmmmmmmm..",
        ".mm............mm.",
    ]
    m.pixels(12, 24, face, {"r": red, "w": WHITE, "k": BLACK, "h": WHITE, "m": red_dark})
    # "BAN" across the back.
    m.pixels(13, 29, mirrored(text_rows("BAN")), {"#": WHITE}, face="back")


# -- 6. Sparklino Fedorino -------------------------------------------------------------------


@design("SparklinoFedorino", width=34, height=44, depth=24)
def sparklino_fedorino(m):
    cx, cy, cz = 17, 20, 12
    mozz, mozz_shade = "#fbfbf5", "#e6e3d6"
    tux, satin = "#18181f", "#2c2c38"
    purple, purple_dark, purple_light = "#7b2fd0", "#561c9e", "#a562f2"
    band, gold, gold_dark = "#f5f5f5", "#f0c02c", "#b8881a"
    tache, tache_dark, blush = "#5a3418", "#3b2210", "#ffb0c4"
    twinkle = ("#ffffff", "#fff06a", "#ff8ae6")
    xs, ys, zs = centres(m)

    # Legs: tuxedo trousers with a satin stripe and shiny shoes with spats.
    left = m.limb("Leg", pivot=(14, 11, 12), phase=0)
    right = m.limb("Leg", pivot=(20, 11, 12), phase=1)
    for part, x0, stripe in ((left, 12, 12), (right, 18, 21)):
        m.box(x0, 3, 10, x0 + 3, 10, 13, tux, part=part)
        m.box(stripe, 3, 10, stripe, 10, 13, satin, part=part)
        m.box(x0, 2, 10, x0 + 3, 2, 13, band, part=part)
        m.box(x0, 0, 7, x0 + 3, 1, 13, "#0c0c10", part=part)
        m.box(x0 + 1, 1, 7, x0 + 2, 1, 8, "#4c4c5c", part=part)

    # The mozzarella ball.
    ball = m.ellipsoid_mask(cx, cy, cz, 10.5, 10.5, 10.5)
    m.mask(ball, mozz)
    m.paint(ball & (ys < cy - 7), mozz_shade)
    m.paint(ball & m.ellipsoid_mask(cx - 4, cy + 5, cz - 5, 3.2, 2.6, 4) & exposed(m), WHITE)

    # The tuxedo: a black jacket shell over the lower half with satin lapels
    # and a V showing the white shirt.
    facing = (cz - zs) / np.maximum(np.hypot(xs - cx, zs - cz), 0.1)
    jacket_top = 14.5 + 9.0 * np.clip(1 - facing, 0, 1.25)
    v_open = (zs < cz) & (np.abs(xs - cx) <= (ys - 8.5) * 0.62)
    shell = m.ellipsoid_mask(cx, cy, cz, 11.3, 11.3, 11.3) & ~ball & (ys <= jacket_top) & ~v_open
    m.mask(shell, tux)
    m.paint(ball & exposed(m) & (ys <= jacket_top) & ~v_open, tux)
    lapel = shell & (zs < cz) & (np.abs(xs - cx) <= (ys - 8.5) * 0.62 + 2.4) & (ys > 10)
    m.paint(lapel, satin)
    m.paint(shell & (ys > jacket_top - 1.2) & (facing < 0.75), satin)
    stamp(m, "front", 16, 11, ["kk"], {"k": BLACK}, lift=0)
    stamp(m, "front", 21, 12, ["pp", "p."], {"p": purple}, lift=1)
    # Coat tails behind.
    m.box(13, 6, 19, 15, 14, 20, tux)
    m.box(18, 6, 19, 20, 14, 20, tux)
    m.paint(m.box_mask(13, 6, 19, 20, 6, 20), satin)
    # The bow tie, right under the chin.
    stamp(m, "front", 13, 14, ["bb....bb", "bbbkkbbb", "bb....bb"], {"b": BLACK, "k": satin}, lift=1)
    stamp(m, "front", 15, 14, ["b..b", "....", "b..b"], {"b": BLACK}, lift=1)

    # Face: eyes, a monocle with its chain, a curly moustache and rosy cheeks.
    eye = [".kk.", "khkk", "kkkk", ".kk."]
    m.pixels(12, 22, eye, {"k": BLACK, "h": WHITE})
    m.pixels(18, 22, eye, {"k": BLACK, "h": WHITE})
    m.pixels(12, 27, [".kk.", "k..k"], {"k": tache_dark})
    m.pixels(18, 27, ["kkkk"], {"k": tache_dark})
    stamp(m, "front", 17, 21, [".gggg.", "g....g", "g....g", "g....g", "g....g", ".gggg."],
          {"g": gold}, lift=1)
    m.pixels(22, 16, ["g", "g", "g", "g", "g"], {"g": gold_dark})
    m.pixels(10, 21, ["pp"], {"p": blush})
    m.pixels(22, 20, ["pp"], {"p": blush})
    stamp(m, "front", 12, 18, ["k........k", "kk.kkkk.kk", ".kkkkkkkk."],
          {"k": tache}, lift=1)
    m.pixels(16, 21, ["dd"], {"d": tache_dark})

    # The Sparkle Time Fedora: purple crown, white band, snap brim, sparkles.
    brim = ellipse_prism(m, cx, cz, 12.2, 10.8, 29, 29) & (zs > 4)
    m.mask(brim, purple_dark)
    m.mask(ellipse_prism(m, cx, cz, 12.2, 10.8, 28, 28) & (zs < 5.5), purple_dark)
    lip = ellipse_prism(m, cx, cz, 12.2, 10.8, 30, 30) & ~ellipse_prism(m, cx, cz, 11.0, 9.6, 30, 30) & (zs > 9)
    m.mask(lip, purple_dark)
    crown = np.zeros(m.grid.shape, dtype=bool)
    for y in range(30, 39):
        k = (y - 30) / 8
        crown |= ellipse_prism(m, cx, cz + 0.5, 7.6 - 1.0 * k, 6.8 - 1.0 * k, y, y)
    crown &= ~(rows_of(m, 38, 38) & (np.abs(xs - cx) <= 1.2))
    crown &= ~(rows_of(m, 36, 38) & (zs < cz - 2.5) & (np.abs(xs - cx) > 4.2))
    m.mask(crown, purple)
    m.paint(crown & (xs < cx - 4), purple_dark)
    m.paint(crown & rows_of(m, 36, 38) & (xs > cx) & (zs < cz), purple_light)
    m.paint(crown & rows_of(m, 30, 31) & exposed(m), band)
    rng = np.random.default_rng(11)
    roll = rng.random(m.grid.shape)
    speck = crown & exposed(m) & rows_of(m, 32, 38)
    m.paint(speck & (roll < 0.06), "#e2c2ff")
    m.paint(speck & (roll < 0.025), WHITE)
    sparkle(m, 25, 35, 11, twinkle, arm=2)
    sparkle(m, 5, 31, 10, twinkle, arm=1)
    sparkle(m, 13, 39, 7, twinkle, arm=1)
    sparkle(m, 20, 33, 5, twinkle, arm=1)
    sparkle(m, 11, 34, 17, twinkle, arm=1)

    # Arms in tux sleeves with white gloves; the right one leans on a cane.
    left_arm = m.limb("Arm", pivot=(4, 19, 12), phase=0)
    right_arm = m.limb("Arm", pivot=(30, 19, 12), phase=1)
    for part, x0 in ((left_arm, 2), (right_arm, 28)):
        m.box(x0, 13, 10, x0 + 3, 19, 13, tux, part=part)
        m.box(x0, 12, 10, x0 + 3, 12, 13, band, part=part)
        m.box(x0, 9, 10, x0 + 3, 11, 13, WHITE, part=part)
        m.box(x0, 9, 10, x0 + 3, 9, 13, "#e3e3ea", part=part)
    m.box(29, 1, 9, 30, 12, 9, BLACK, part=right_arm)
    m.box(29, 1, 9, 30, 2, 9, gold, part=right_arm)
    m.box(29, 13, 9, 30, 14, 9, gold, part=right_arm)
    m.box(31, 14, 9, 32, 14, 9, gold, part=right_arm)
    m.box(33, 12, 9, 33, 14, 9, gold, part=right_arm)
    m.voxel(29, 14, 9, "#ffe27a", part=right_arm)


# -- 7. Squalo Robuxiano --------------------------------------------------------------------


@design("SqualoRobuxiano", width=30, height=36, depth=46)
def squalo_robuxiano(m):
    cx, cy = 15, 20
    green, green_dark, green_light = "#34c060", "#1f8f47", "#6fe08f"
    belly, belly_shade = "#e6f7e1", "#c5e8bf"
    brow, gill = "#0f5a2a", "#18743a"
    mouth_dark, tooth = "#5a0f1e", "#ffffff"
    coin, coin_dark, coin_light = "#f7c531", "#c48d14", "#fff0a0"
    shoe, shoe_dark, sole = "#2f6fe8", "#1d4fb8", "#f2f2f2"
    xs, ys, zs = centres(m)

    # The body: a fat, blunt-nosed shark lying along z.
    body = np.zeros(m.grid.shape, dtype=bool)
    for z in range(1, 37):
        zc = z + 0.5
        if zc < 10:
            s = (1 - ((10 - zc) / 9.6) ** 2.2) ** (1 / 2.2)
            rx, ry = 9.5 * s, 8.5 * s
        elif zc < 19:
            rx, ry = 9.5, 8.5
        else:
            k = (zc - 19) / 18
            rx, ry = 9.5 - 6.3 * k, 8.5 - 5.0 * k
        yc = cy + max(0.0, (zc - 19) / 18) * 1.5
        layer = (np.abs(xs[:, :, z] - cx) / rx) ** 2.4 + (np.abs(ys[:, :, z] - yc) / ry) ** 2.4 <= 1
        body[:, :, z] = layer
    m.mask(body, green)
    m.paint(body & (ys < cy - 2.5 + 0.8 * np.sin(zs * 0.45)), belly)
    m.paint(body & (ys < cy - 6), belly_shade)
    m.paint(body & (ys > cy + 5.2), green_dark)
    m.paint(body & exposed(m) & (ys > cy + 2.5) & (ys < cy + 3.6) & (zs > 6), green_light)

    # Dorsal fin.
    for y in range(27, 36):
        k = (y - 27) / 8
        m.box(14, y, int(round(11 + 7 * k)), 15, y, int(round(22 - 3.5 * k)), green_dark)
    m.paint(m.box_mask(14, 33, 0, 15, 35, m.depth - 1), green)

    # Legs in blue sneakers, like Tralalero Tralala.
    left = m.limb("Leg", pivot=(11, 12, 16), phase=0)
    right = m.limb("Leg", pivot=(19, 12, 16), phase=1)
    for part, x0 in ((left, 9), (right, 17)):
        m.box(x0, 4, 14, x0 + 3, 12, 17, green, part=part)
        m.box(x0, 4, 14, x0 + 3, 5, 17, belly, part=part)
        m.box(x0 - 1, 0, 11, x0 + 4, 0, 18, sole, part=part)
        m.box(x0 - 1, 1, 11, x0 + 4, 2, 18, shoe, part=part)
        m.box(x0 - 1, 3, 13, x0 + 4, 3, 18, shoe, part=part)
        m.box(x0, 3, 13, x0 + 3, 3, 14, sole, part=part)
        m.box(x0 - 1, 1, 18, x0 + 4, 3, 18, shoe_dark, part=part)
        m.box(x0, 1, 11, x0 + 3, 1, 11, sole, part=part)
    swoosh = ["....w.", "w..w..", ".ww..."]
    m.pixels(12, 1, swoosh, {"w": sole}, face="right")
    m.pixels(12, 1, mirrored(swoosh), {"w": sole}, face="left")

    # The toothy grin stuffed with Robux, carved into the snout.
    grin = [
        "l............l",
        ".tttttttttttt.",
        ".t.t.t..t.t.t.",
        ".cGGGGccGGGGc.",
        ".cGYYGccGYYGc.",
        ".t.t.t..t.t.t.",
        "..tttttttttt..",
    ]
    filled = m.grid > 0
    for r, row in enumerate(grin):
        y = 19 - r + 1
        for c, char in enumerate(row):
            if char == ".":
                continue
            x = 8 + c
            hits = np.nonzero(filled[x, y, :])[0]
            if len(hits) == 0:
                continue
            s = hits[0]
            if char == "l":
                m.box(x, y, s, x, y, s, brow)
            elif char == "t":
                m.box(x, y, s, x, y, s, tooth)
                m.box(x, y, s + 1, x, y, s + 2, mouth_dark)
            elif char == "c":
                m.clear(m.box_mask(x, y, s, x, y, s + 1))
                m.box(x, y, s + 2, x, y, s + 2, mouth_dark)
            else:
                m.clear(m.box_mask(x, y, s, x, y, s))
                m.box(x, y, s + 1, x, y, s + 1, coin if char == "G" else coin_light)
                m.box(x, y, s + 2, x, y, s + 2, mouth_dark)
    for r, row in enumerate(grin):
        y = 20 - r
        for c, char in enumerate(row):
            if char == "." and 1 <= c <= 12 and 1 <= r <= 5:
                x = 8 + c
                hits = np.nonzero(filled[x, y, :])[0]
                if len(hits):
                    s = hits[0]
                    m.clear(m.box_mask(x, y, s, x, y, s + 1))
                    m.box(x, y, s + 2, x, y, s + 2, mouth_dark)

    # Eyes with a cheeky look and dark brows.
    m.pixels(6, 21, [".ww.", "wwkk", "wwhk", ".ww."], {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(20, 21, [".ww.", "kkww", "khww", ".ww."], {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(6, 25, ["kk..", "..kk"], {"k": brow})
    m.pixels(20, 25, ["..kk", "kk.."], {"k": brow})
    # Gills.
    gills = ["g.g.g", "g.g.g", "g.g.g", "g.g.g", "g.g.g"]
    m.pixels(10, 16, gills, {"g": gill}, face="right")
    m.pixels(10, 16, gills, {"g": gill}, face="left")

    # Robux coins stuck all over.
    coin_art = [".ggg.", "gdddg", "gdydg", "gdddg", ".ggg."]
    colours = {"g": coin, "d": coin_dark, "y": coin_light}
    stamp(m, "right", 20, 18, coin_art, colours, lift=1)
    stamp(m, "right", 27, 22, coin_art, colours, lift=1)
    stamp(m, "left", 22, 21, mirrored(coin_art), colours, lift=1)
    stamp(m, "left", 29, 17, mirrored(coin_art), colours, lift=1)
    top_art(m, 12, 24, coin_art, colours, within=body)
    stamp(m, "right", 16, 30, [".g.", "gyg", ".g."], {"g": coin, "y": coin_light}, lift=1)

    # Pectoral fins as arms: chunky swept plates.
    for phase, sign in ((0, -1), (1, 1)):
        part = m.limb("Arm", pivot=(cx + sign * 9.5, 15.5, 14), phase=phase)
        for i in range(6):
            x = 5 - i if sign < 0 else 24 + i
            top = 16 - int(round(i * 0.7))
            m.box(x, top - 1, int(round(11 + i * 0.9)), x, top, 18 - i // 3, green_dark, part=part)
        m.paint((m.part == part) & (ys < 14), green)
        m.paint((m.part == part) & m.box_mask(0, 0, 0, m.width - 1, m.height - 1, 12), green_light)

    # The tail fin: a forked crescent that wags.
    tail = m.limb("Tail", pivot=(cx, 21.5, 34))
    d = zs - 34
    top_edge, low_edge = 21.5 + 1.1 * d, 20.5 - 0.85 * d
    fin = (d > 0) & (ys <= top_edge) & (ys >= low_edge) & (d < 11.5)
    fin &= ~((ys < 21) & (d > 9.5))
    fin &= ~((d > 5.5) & (ys > 20.5 - (d - 5.5) * 0.9) & (ys < 21.5 + (d - 5.5) * 0.95))
    thick = m.box_mask(14, 0, 0, 15, m.height - 1, m.depth - 1) | (m.box_mask(13, 0, 0, 16, m.height - 1, m.depth - 1) & (d < 3))
    m.mask(fin & thick, green_dark, part=tail)
    m.assign(body & m.box_mask(0, 0, 35, m.width - 1, m.height - 1, m.depth - 1), tail)
    m.paint(fin & thick & ((ys > top_edge - 1.5) | (ys < low_edge + 1.2)), green)


# -- 8. Admino Supremo ------------------------------------------------------------------------


@design("AdminoSupremo", width=36, height=46, depth=22)
def admino_supremo(m):
    cx = 18
    robe, robe_dark, robe_light = "#241838", "#150e22", "#3a2a5e"
    gold, gold_dark, gold_light = "#f2c12e", "#b5861a", "#ffe587"
    red, red_dark, red_light = "#c8102e", "#86091c", "#ee3b55"
    fur, fur_shade, spot = "#f8f8f3", "#dcdcd4", "#16161a"
    skin, skin_dark = "#f0c9a4", "#d9a982"
    beard, beard_shade = "#f4f4f6", "#d6d6de"
    glow, eye = "#bff8ff", "#ffffff"
    gem_blue, gem_green = "#2f7bff", "#29c46a"
    halo, halo_light = "#ffd23f", "#fff6c4"
    xs, ys, zs = centres(m)
    rng = np.random.default_rng(5)

    # Legs: dark trousers, black boots with gold caps.
    left = m.limb("Leg", pivot=(15, 12, 11), phase=0)
    right = m.limb("Leg", pivot=(21, 12, 11), phase=1)
    for part, x0 in ((left, 13), (right, 19)):
        m.box(x0, 5, 9, x0 + 3, 11, 12, "#2a1d40", part=part)
        m.box(x0, 0, 9, x0 + 3, 4, 12, "#1a1522", part=part)
        m.box(x0, 0, 7, x0 + 3, 1, 12, "#1a1522", part=part)
        m.box(x0, 0, 7, x0 + 3, 1, 8, gold, part=part)
        m.box(x0, 4, 9, x0 + 3, 4, 12, gold, part=part)

    # The royal cape: red velvet flowing to the heels, trimmed with ermine.
    for y in range(3, 28):
        k = (27 - y) / 24
        hw = 7.0 + 5.5 * k
        zb = 14 + 3.2 * k
        for x in range(m.width):
            dx = x + 0.5 - cx
            if abs(dx) > hw:
                continue
            wave = math.sin(dx * 0.95 + 0.6)
            z0 = int(round(zb + 1.3 * k * wave))
            colour = red_light if wave > 0.6 else (red_dark if wave < -0.6 else red)
            if abs(dx) > hw - 1.4 or y <= 4:
                colour = spot if (x * 7 + y * 3) % 11 == 0 else fur
            m.box(x, y, z0, x, y, z0 + 1, colour)

    # The dark robe with gold trim, belt and crest.
    m.box(11, 12, 7, 24, 28, 13, robe)
    m.box(10, 12, 6, 25, 14, 14, robe)
    m.paint(exposed(m) & rows_of(m, 12, 12), gold)
    m.paint(m.box_mask(10, 12, 0, 25, 14, 6) & ((((xs - 0.5).astype(int)) % 3) == 0), robe_dark)
    m.paint(m.box_mask(17, 12, 0, 18, 26, 7), gold)
    m.paint(m.box_mask(11, 17, 0, 24, 18, 21) & exposed(m), gold_dark)
    m.paint(m.box_mask(11, 18, 0, 24, 18, 21) & exposed(m), gold)
    stamp(m, "front", 16, 17, ["gggg", "grrg"], {"g": gold_light, "r": red}, lift=1)
    m.paint(m.box_mask(11, 19, 0, 12, 27, 7) | m.box_mask(23, 19, 0, 24, 27, 7), robe_light)
    crest = [
        "gggggg",
        "gyyyyg",
        "gyrryg",
        "gyrryg",
        ".gyyg.",
        "..gg..",
    ]
    m.pixels(15, 20, crest, {"g": gold_dark, "y": gold_light, "r": red})

    # The ermine collar across the shoulders.
    collar = m.ellipsoid_mask(cx, 28, 10.5, 9.2, 2.4, 6.2) & rows_of(m, 26, 30)
    m.mask(collar, fur)
    m.paint(collar & (ys < 27.5), fur_shade)
    m.paint(collar & exposed(m) & (rng.random(m.grid.shape) < 0.09), spot)

    # Arms in wide sleeves with gold cuffs.
    left_arm = m.limb("Arm", pivot=(9, 27, 10.5), phase=0)
    right_arm = m.limb("Arm", pivot=(27, 27, 10.5), phase=1)
    for part, x0 in ((left_arm, 7), (right_arm, 25)):
        m.box(x0, 17, 8, x0 + 3, 26, 12, robe, part=part)
        m.box(x0, 16, 7, x0 + 3, 17, 13, gold, part=part)
        m.box(x0, 13, 8, x0 + 3, 15, 12, skin, part=part)
    m.box(7, 16, 7, 7, 17, 13, gold_dark, part=left_arm)
    m.box(28, 16, 7, 28, 17, 13, gold_dark, part=right_arm)
    # The golden sceptre, held out to the side, topped with a star.
    m.box(29, 3, 9, 30, 33, 10, gold, part=right_arm)
    for y in (7, 20, 26):
        m.box(29, y, 9, 30, y, 10, gold_dark, part=right_arm)
    m.box(28, 27, 8, 31, 29, 11, gold_dark, part=right_arm)
    m.box(29, 28, 8, 30, 28, 8, gold_light, part=right_arm)
    m.box(28, 13, 8, 29, 15, 12, skin, part=right_arm)
    star = [
        "....o....",
        "...oyo...",
        "...oyo...",
        "ooooyoooo",
        "oyyyWyyyo",
        ".oyyyyyo.",
        "..oyyyo..",
        ".oyyoyyo.",
        ".oyo.oyo.",
        "oo.....oo",
    ]
    colours = {"o": gold, "y": "#ffe94d", "W": WHITE}
    for r, row in enumerate(star):
        for c, char in enumerate(row):
            if char in colours:
                m.box(26 + c, 41 - r, 9, 26 + c, 41 - r, 10, colours[char], part=right_arm)

    # The head: glowing white eyes, stern brows, a regal white beard.
    head = m.limb("Head", pivot=(cx, 30, 10.5))
    m.mask(rounded_box_mask(m, 13, 30, 6, 22, 38, 14), skin, part=head)
    m.paint(m.box_mask(13, 30, 6, 22, 30, 14), skin_dark)
    hair = (m.part == head) & exposed(m) & (((zs > 11) & (ys > 30)) | ((zs > 8) & (ys > 33) & (np.abs(xs - cx) > 4)))
    m.paint(hair, beard)
    m.paint(hair & ((((ys - 0.5).astype(int)) + ((zs - 0.5).astype(int))) % 3 == 0), beard_shade)
    face = [
        ".kkk..kkk.",
        "cwww..wwwc",
        ".www..www.",
    ]
    m.pixels(13, 34, face, {"k": "#4a3a34", "c": glow, "w": eye})
    stamp(m, "front", 13, 30, [
        "..bbbbbb..",
        "bb.mmmm.bb",
        "bbbbbbbbbb",
        ".bbbbbbbb.",
    ], {"b": beard, "m": "#9a5a48"}, lift=1, part=head)
    m.paint((m.part == head) & rows_of(m, 30, 31) & m.box_mask(0, 0, 0, m.width - 1, m.height - 1, 6)
            & (((xs - 0.5).astype(int) + (ys - 0.5).astype(int)) % 2 == 0), beard_shade)
    # The crown: a gold band with points, gems and red velvet.
    band = m.box_mask(12, 37, 5, 23, 39, 15) & ~m.box_mask(13, 37, 6, 22, 39, 14)
    m.mask(band, gold, part=head)
    m.paint(band & rows_of(m, 37, 37), gold_dark)
    m.box(13, 39, 6, 22, 40, 14, red, part=head)
    m.box(14, 41, 7, 21, 41, 13, red_dark, part=head)
    for x in (12, 15, 20, 23):
        m.box(x, 40, 5, x, 41, 5, gold, part=head)
        m.box(x, 40, 15, x, 41, 15, gold, part=head)
        m.voxel(x, 42, 5, gold_light, part=head)
    for z in (8, 12):
        m.box(12, 40, z, 12, 41, z, gold, part=head)
        m.box(23, 40, z, 23, 41, z, gold, part=head)
    m.box(17, 40, 5, 18, 42, 5, gold, part=head)
    m.box(17, 43, 5, 18, 43, 5, red, part=head)
    m.box(17, 42, 9, 18, 43, 10, gold, part=head)
    stamp(m, "front", 17, 38, ["rr"], {"r": red_light}, lift=1, part=head)
    stamp(m, "front", 14, 38, ["b"], {"b": gem_blue}, lift=1, part=head)
    stamp(m, "front", 21, 38, ["g"], {"g": gem_green}, lift=1, part=head)

    # The halo, spinning above it all.
    ring = m.limb("Prop", pivot=(cx, 45, 10.5), axis="Y")
    r = np.hypot(xs - cx, zs - 10.5)
    m.mask(rows_of(m, 45, 45) & (r <= 6.2) & (r > 4.0), halo, part=ring)
    m.paint(rows_of(m, 45, 45) & (r <= 5.3) & (r > 4.0), halo_light)


# -- 9. Oofosauro Rex --------------------------------------------------------------------------


@design("OofosauroRex", width=28, height=41, depth=46)
def oofosauro_rex(m):
    cx = 14
    yellow, yellow_dark, yellow_light = "#f5cd30", "#d4a91c", "#ffe27a"
    blue, blue_dark, blue_light = "#1f6ed4", "#154f9e", "#4c8fe6"
    green, green_dark, green_light = "#a4bd47", "#7f9632", "#c2d86a"
    mouth, throat, tongue = "#9e1f30", "#4a0a14", "#ff7a93"
    claw = "#fdfbf2"
    xs, ys, zs = centres(m)

    # Torso and tail in noob blue, with green spikes down the back.
    torso = m.ellipsoid_mask(cx, 19, 25, 8, 8.5, 11)
    m.mask(torso, blue)
    m.paint(torso & (ys < 14), blue_dark)
    m.paint(torso & (ys > 24) & (xs < cx), blue_light)
    for z in range(19, 34, 3):
        drop = 1 if z > 29 else 0
        m.box(13, 27 - drop, z, 14, 28 - drop, z + 1, green)
        m.box(13, 29 - drop, z + 1, 14, 29 - drop, z + 1, green_light)

    tail = m.limb("Tail", pivot=(cx, 20, 34))
    tail_shape = np.zeros(m.grid.shape, dtype=bool)
    for i in range(14):
        k = i / 13
        tail_shape |= m.ellipsoid_mask(cx, 20 + 3.5 * k, 34 + 11 * k, 5.4 - 3.9 * k)
    m.mask(tail_shape & (zs > 33), blue, part=tail)
    tail_mask = m.part == tail
    m.paint(tail_mask & ((((zs - 0.5).astype(int)) % 4) == 0) & (ys > 20 + 3.5 * (zs - 34) / 11), blue_dark)
    for z in (37, 40, 43):
        k = (z + 0.5 - 34) / 11
        top = int(math.floor(20 + 3.5 * k + 5.4 - 3.9 * k - 0.5)) + 1
        m.box(13, top, z, 14, top + 1, z, green, part=tail)
    # "OOF" in big white letters along both flanks.
    oof = text_rows("oof")
    m.pixels(18, 18, oof, {"#": WHITE}, face="right")
    m.pixels(18, 18, mirrored(oof), {"#": WHITE}, face="left")

    # Big green legs with white claws.
    for phase, x0 in ((0, 2), (1, 21)):
        xc = x0 + 2.5
        part = m.limb("Leg", pivot=(xc, 16, 26), phase=phase)
        m.ellipsoid(xc, 13, 26, 2.9, 4.6, 4.6, green, part=part)
        m.box(x0 + 1, 3, 24, x0 + 3, 9, 28, green, part=part)
        m.box(x0, 0, 19, x0 + 4, 2, 29, green_dark, part=part)
        m.box(x0, 2, 19, x0 + 4, 2, 28, green, part=part)
        for x in (x0, x0 + 2, x0 + 4):
            m.box(x, 0, 18, x, 1, 18, claw, part=part)
        m.paint(m.box_mask(x0, 12, 0, x0 + 5, 17, m.depth - 1) & (m.part == part) & (ys > 15), green_light)

    # Tiny yellow arms reaching forward under the jaw.
    for phase, sign in ((0, -1), (1, 1)):
        root = (6, 7) if sign < 0 else (20, 21)
        fore = (6, 7) if sign < 0 else (20, 21)
        part = m.limb("Arm", pivot=((root[0] + root[1] + 1) / 2, 17, 18), phase=phase)
        m.box(root[0], 14, 17, root[1], 17, 19, yellow, part=part)
        m.box(fore[0], 13, 13, fore[1], 14, 16, yellow, part=part)
        m.box(fore[0], 13, 16, fore[1], 16, 16, yellow, part=part)
        m.voxel(fore[0], 13, 12, claw, part=part)
        m.voxel(fore[1], 14, 12, claw, part=part)

    # The noob-yellow T-rex head, jaws wide open yelling OOF.
    head = m.limb("Head", pivot=(cx, 24, 15))
    skull = rounded_box_mask(m, 6, 27, 5, 21, 37, 18)
    skull |= m.ellipsoid_mask(cx, 36, 12, 7.6, 4.2, 6.8) & rows_of(m, 37, 40)
    snout = rounded_box_mask(m, 7, 27, 0, 20, 32, 9)
    jaw = rounded_box_mask(m, 8, 15, 1, 19, 19, 15)
    cheeks = m.box_mask(7, 16, 10, 20, 27, 16)
    m.mask(skull | snout | jaw | cheeks, yellow, part=head)
    m.paint((m.part == head) & (ys > 37.5), yellow_light)
    m.paint((m.part == head) & (ys < 16), yellow_dark)
    # Inside the mouth: red gums, a dark throat and a big pink tongue.
    m.paint(m.box_mask(8, 19, 0, 19, 19, 9) & (m.part == head), mouth)
    m.paint(m.box_mask(8, 27, 0, 19, 27, 9) & (m.part == head), mouth)
    m.paint(m.box_mask(8, 20, 10, 19, 26, 10) & (m.part == head), throat)
    m.box(10, 20, 3, 17, 20, 9, tongue, part=head)
    m.box(13, 20, 4, 14, 20, 9, "#e2566f", part=head)
    # Teeth: a row hanging from the snout and one rising from the jaw.
    for x in range(8, 20):
        m.box(x, 26, 0, x, 26, 1, claw, part=head)
        if x % 2 == 0:
            m.box(x, 25, 0, x, 25, 1, claw, part=head)
        m.box(x, 20, 1, x, 20, 2, claw, part=head)
        if x % 2 == 1:
            m.box(x, 21, 1, x, 21, 2, claw, part=head)
    for z in range(3, 9):
        for x in (7, 20):
            m.box(x, 26, z, x, 26, z, claw, part=head)
            if z % 2 == 0:
                m.box(x, 25, z, x, 25, z, claw, part=head)
        for x in (8, 19):
            m.box(x, 20, z, x, 20, z, claw, part=head)
            if z % 2 == 1:
                m.box(x, 21, z, x, 21, z, claw, part=head)
    # Shocked eyes and worried brows above the snout; nostrils on top.
    eye = [".kk.", "khkk", "kkkk", ".kk."]
    m.pixels(8, 33, eye, {"k": BLACK, "h": WHITE})
    m.pixels(16, 33, eye, {"k": BLACK, "h": WHITE})
    m.pixels(7, 37, ["...kk", "kkk.."], {"k": BLACK})
    m.pixels(16, 37, ["kk...", "..kkk"], {"k": BLACK})
    top_art(m, 9, 1, ["kk....kk"], {"k": "#8a6a10"}, within=rows_of(m, 32, 32))
    m.pixels(7, 29, ["pp"], {"p": "#ff9f6b"})
    m.pixels(19, 29, ["pp"], {"p": "#ff9f6b"})


# -- 10. Galattico Guestone ---------------------------------------------------------------------


@design("GalatticoGuestone", width=34, height=46, depth=16)
def galattico_guestone(m):
    cx = 17
    deep, navy, purple, violet = "#0e0a2c", "#1b1552", "#34187a", "#5a24a8"
    magenta, pink, cyan = "#b53bb8", "#ff7cc8", "#46b8ff"
    stars = ("#ffffff", "#ffe45e", "#cfe8ff")
    cap, cap_brim = "#17171b", "#2a2a31"
    glow = "#6a52dc"
    xs, ys, zs = centres(m)

    # Classic blocky proportions: legs, torso, arms and a head, all galaxy.
    left = m.limb("Leg", pivot=(13, 15, 8), phase=0)
    right = m.limb("Leg", pivot=(21, 15, 8), phase=1)
    m.mask(rounded_box_mask(m, 9, 0, 4, 16, 14, 11), navy, part=left)
    m.mask(rounded_box_mask(m, 17, 0, 4, 24, 14, 11), navy, part=right)
    m.mask(rounded_box_mask(m, 9, 15, 4, 24, 30, 11), navy)
    left_arm = m.limb("Arm", pivot=(5, 29, 8), phase=0)
    right_arm = m.limb("Arm", pivot=(29, 29, 8), phase=1)
    m.mask(rounded_box_mask(m, 1, 15, 4, 8, 30, 11), navy, part=left_arm)
    m.mask(rounded_box_mask(m, 25, 15, 4, 32, 30, 11), navy, part=right_arm)
    head = m.limb("Head", pivot=(cx, 31, 8))
    m.mask(rounded_box_mask(m, 12, 31, 3, 21, 40, 12), navy, part=head)

    # Swirling galaxy colours through the whole body.
    body = m.grid > 0
    n = (np.sin(xs * 0.38 + 1.7 * np.sin(ys * 0.19)) + np.sin(ys * 0.29 + 1.4 * np.sin(zs * 0.33 + xs * 0.15))
         + 0.9 * np.sin((xs - ys) * 0.21 + zs * 0.5))
    for threshold, colour in ((-3.5, deep), (-1.0, navy), (0.1, purple), (1.0, violet), (1.7, magenta), (2.2, pink)):
        m.paint(body & (n > threshold), colour)
    swirl = np.sin(np.hypot(xs - 10, ys - 12) * 0.9 - np.arctan2(ys - 12, xs - 10) * 2)
    m.paint(body & (n > 0.6) & (swirl > 0.75), cyan)
    # A spiral galaxy on the chest.
    rr = np.hypot(xs - cx, ys - 23)
    theta = np.arctan2(ys - 23, xs - cx)
    arms = np.cos(2 * (theta - 1.6 * np.log(rr + 0.6)))
    chest = m.box_mask(9, 15, 0, 24, 30, 4) & body
    m.paint(chest & (rr < 7.2), deep)
    m.paint(chest & (rr < 7.2) & (arms > 0.35), magenta)
    m.paint(chest & (rr < 6.2) & (arms > 0.7), pink)
    m.paint(chest & (rr < 3.2) & (arms > 0.6), "#ffd0f0")
    m.paint(chest & (rr < 2.1), "#ffe45e")
    m.paint(chest & (rr < 1.0), WHITE)
    # A dark face so the glow stands out.
    face_zone = m.box_mask(12, 31, 0, 21, 39, 3) & body
    m.paint(face_zone, deep)

    # Stars sprinkled over every surface (but not the face or chest).
    rng = np.random.default_rng(42)
    roll = rng.random(m.grid.shape)
    pick = rng.random(m.grid.shape)
    shell = exposed(m) & ~face_zone & ~(chest & (rr < 7.2))
    for i, colour in enumerate(stars):
        m.paint(shell & (roll < 0.075) & (pick * 3 >= i) & (pick * 3 < i + 1), colour)
    plus = [".w.", "wWw", ".w."]
    for x0, y0, face in ((2, 20, "front"), (26, 24, "front"), (10, 5, "front"), (19, 9, "front"),
                         (12, 18, "back"), (21, 26, "back"), (3, 25, "back"), (27, 6, "back"),
                         (6, 20, "right"), (7, 8, "left")):
        m.pixels(x0, y0, plus, {"w": "#fff3a6", "W": WHITE}, face=face)

    # Glowing white eyes and the classic smile.
    smile = [
        "..ww..ww..",
        "..ww..ww..",
        "..ww..ww..",
        "..........",
        "w........w",
        ".w......w.",
        "..wwwwww..",
    ]
    halo = [["." for _ in range(10)] for _ in range(7)]
    for r, row in enumerate(smile):
        for c, char in enumerate(row):
            if char == "w":
                for dr, dc in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    rr2, cc2 = r + dr, c + dc
                    if 0 <= rr2 < 7 and 0 <= cc2 < 10 and smile[rr2][cc2] != "w":
                        halo[rr2][cc2] = "g"
    m.pixels(12, 32, ["".join(row) if r < 4 else "." * 10 for r, row in enumerate(halo)], {"g": glow})
    m.pixels(12, 32, smile, {"w": WHITE})

    # The black guest cap with a white "R".
    crown = m.box_mask(11, 40, 2, 22, 43, 13)
    ix, iy, iz = xs - 0.5, ys - 0.5, zs - 0.5
    crown &= ~(((ix == 11) | (ix == 22)) & ((iz == 2) | (iz == 13)))
    crown &= ~((iy == 43) & ((ix == 11) | (ix == 22) | (iz == 2) | (iz == 13)))
    m.mask(crown, cap, part=head)
    m.mask(rounded_box_mask(m, 12, 44, 3, 21, 44, 12) | m.box_mask(12, 44, 4, 21, 44, 11), cap, part=head)
    m.box(16, 45, 7, 17, 45, 8, cap_brim, part=head)
    m.box(12, 40, 0, 21, 40, 1, cap_brim, part=head)
    m.box(13, 40, 0, 20, 40, 0, "#34343c", part=head)
    m.paint((m.part == head) & rows_of(m, 41, 44) & m.box_mask(0, 0, 0, m.width - 1, m.height - 1, 2)
            & ((xs < 13) | (xs > 21)), "#222228")
    stamp(m, "front", 15, 41, ["www.", "w..w", "www.", "w..w"], {"w": WHITE}, lift=1, part=head,
          within=m.box_mask(0, 0, 2, m.width - 1, m.height - 1, m.depth - 1))
