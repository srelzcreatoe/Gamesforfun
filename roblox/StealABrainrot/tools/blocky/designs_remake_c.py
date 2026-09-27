"""Block-built remakes of three high-rarity brainrots that used to be
auto-voxelised: Cocofanto Elefanto (a coconut elephant), La Vaca Saturno
Saturnita (a cow on the planet Saturn) and Sessanta Sette (the "6 7" meme)."""

import math

import numpy as np

from blocky import design, shade

WHITE = "#ffffff"
BLACK = "#141417"


# -- helpers -------------------------------------------------------------------


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1, radius):
    """A box (bounds included) with its edges rounded off by `radius`."""
    xs, ys, zs = m._centres
    cx = xs.clip(x0 + radius, x1 + 1 - radius)
    cy = ys.clip(y0 + radius, y1 + 1 - radius)
    cz = zs.clip(z0 + radius, z1 + 1 - radius)
    inside = (xs >= x0) & (xs <= x1 + 1) & (ys >= y0) & (ys <= y1 + 1) & (zs >= z0) & (zs <= z1 + 1)
    return inside & ((xs - cx) ** 2 + (ys - cy) ** 2 + (zs - cz) ** 2 <= radius**2)


def polyline(m, points, radius, radius_end=None):
    """A tube along a polyline, tapering from `radius` to `radius_end`.
    Returns (mask, s): s is the arc length along the line, for stripes."""
    xs, ys, zs = m._centres
    p = np.stack([xs, ys, zs], axis=-1)
    best = np.full(xs.shape, np.inf)
    best_s = np.zeros(xs.shape)
    best_r = np.zeros(xs.shape)
    total = sum(np.linalg.norm(np.subtract(b, a)) for a, b in zip(points, points[1:]))
    radius_end = radius if radius_end is None else radius_end
    s0 = 0.0
    for a, b in zip(points, points[1:]):
        a, b = np.array(a, float), np.array(b, float)
        ab = b - a
        length = float(np.linalg.norm(ab))
        t = np.clip(((p - a) @ ab) / max(1e-9, ab @ ab), 0, 1)
        d = np.linalg.norm(p - (a + t[..., None] * ab), axis=-1)
        s = s0 + t * length
        r = radius + (radius_end - radius) * (s / total)
        closer = d - r < best - best_r
        best = np.where(closer, d, best)
        best_s = np.where(closer, s, best_s)
        best_r = np.where(closer, r, best_r)
        s0 += length
    return best <= best_r, best_s


def exposed(m, direction):
    """Filled voxels with nothing next to them on one side (up/down/left/right/front/back)."""
    f = m.grid > 0
    p = np.pad(f, 1)
    return f & ~{
        "left": p[:-2, 1:-1, 1:-1],
        "right": p[2:, 1:-1, 1:-1],
        "down": p[1:-1, :-2, 1:-1],
        "up": p[1:-1, 2:, 1:-1],
        "front": p[1:-1, 1:-1, :-2],
        "back": p[1:-1, 1:-1, 2:],
    }[direction]


def glyph_mask(m, x0, y0, rows, z0, z1, char="X"):
    """A pixel-art shape (rows[0] on top, drawn down to y0) extruded from z0 to z1."""
    mask = np.zeros(m.grid.shape, dtype=bool)
    height = len(rows)
    for r, row in enumerate(rows):
        y = y0 + height - 1 - r
        for c, ch in enumerate(row):
            if ch == char:
                mask[x0 + c, y, z0 : z1 + 1] = True
    return mask


# -- Cocofanto Elefanto ------------------------------------------------------------


@design("CocofantoElefanto", width=48, height=41, depth=56)
def cocofanto_elefanto(m):
    cx = 24
    grey, grey_dark, grey_light = "#8a9199", "#666d75", "#a8aeb5"
    ear_in, ear_in_dark = "#e0a9a9", "#c48888"
    shell_dark, shell, shell_light = "#441709", "#6c2911", "#8f3c17"
    nail, tusk, tusk_shade = "#ece5d3", "#f7f0dc", "#ddd2b6"
    eye_black = "#16161a"
    xs, ys, zs = m._centres

    # Four thick grey legs with pale toenails; diagonal pairs step together.
    for lx, lz, phase in ((cx - 8.5, 22, 0), (cx + 8.5, 22, 1), (cx - 8.5, 42, 1), (cx + 8.5, 42, 0)):
        leg = m.limb("Leg", pivot=(lx, 14, lz), phase=phase)
        m.cylinder(lx, 0, lz, 4.2, 15, grey, part=leg)
        m.cylinder(lx, 0, lz, 4.6, 2, grey, part=leg)
        m.paint(m.cylinder_mask(lx, 0, lz, 5, 1), grey_dark)
        rim = m.cylinder_mask(lx, 0, lz, 4.6, 2) & ~m.cylinder_mask(lx, 0, lz, 3.4, 2)
        for dx in (-2.6, 0, 2.6):
            nz = lz - math.sqrt(4.1**2 - dx**2)
            m.paint(rim & ((xs - lx - dx) ** 2 + (zs - nz) ** 2 <= 1.3), nail)

    # The coconut body: a big round shell covered in layers of shaggy
    # fibres that hang down in clean zig-zag fringes.
    bcy, bcz = 26, 34
    rx, ry, rz = 16.5, 14, 17.5
    core = m.ellipsoid_mask(cx, bcy, bcz, rx, ry, rz)
    m.mask(core, shell_dark)
    outer = m.ellipsoid_mask(cx, bcy, bcz, rx + 1.3, ry + 1.3, rz + 1.3) & ~core & (m.grid == 0)
    v = (ys - bcy) / (ry + 1.3)
    theta = np.arctan2(xs - cx, zs - bcz)
    flare = m.ellipsoid_mask(cx, bcy, bcz, rx + 2.5, ry + 2.5, rz + 2.5) & ~core & ~outer & (m.grid == 0)
    fringe = v > 0.8
    tufts = np.zeros(m.grid.shape, dtype=bool)
    for tier, top in enumerate((0.8, 0.5, 0.2, -0.1, -0.4)):
        k = np.floor((theta + math.pi) / (2 * math.pi) * 36 + 0.5 * tier)
        long = k % 2 == 0
        length = np.where(long, 0.26, 0.12)
        fringe |= (v <= top) & (v >= top - 0.1 - length)
        # The long strands flare out a little at the ends.
        tufts |= long & (v <= top - 0.14) & (v >= top - 0.36)
    m.mask(outer & fringe, shell)
    m.mask(flare & tufts & (v < 0.75), shell)
    # The flared ends catch the light.
    m.paint(flare & tufts & (v < 0.75) & (m.grid > 0), shell_light)

    # A little tail with a dark tuft that wags.
    tail = m.limb("Tail", pivot=(cx, 26, 51))
    t, _ = polyline(m, [(cx, 26, 50.5), (cx, 23, 53.5), (cx, 18.5, 54.5)], 1.0)
    m.mask(t & (m.grid == 0), grey, part=tail)
    m.mask(m.ellipsoid_mask(cx, 17.5, 54.6, 1.5, 2.2, 1.4) & (m.grid == 0), grey_dark, part=tail)

    # The elephant head at the front of the coconut.
    head = m.limb("Head", pivot=(cx, 24, 16))
    hcy, hcz = 28.5, 14
    head_mask = m.ellipsoid_mask(cx, hcy, hcz, 9.8, 9.6, 8.6)
    m.mask(head_mask, grey, part=head)
    m.paint(head_mask & m.surface("top", 1) & (ys > hcy + 6), grey_light)
    m.paint(head_mask & (ys < hcy - 7), grey_dark)

    # The trunk: long, ringed with wrinkles, curling forward at the tip.
    trunk, s = polyline(m, [(cx, 24.5, 8), (cx, 19.5, 5.5), (cx, 14.5, 4.6), (cx, 10.5, 4.4), (cx, 7, 3.4),
                             (cx, 5.2, 1.6), (cx, 6.2, 0.6), (cx, 8.2, 0.6)], 3.0, 1.4)
    trunk &= m.grid == 0
    m.mask(trunk, grey, part=head)
    m.paint(trunk & ((s % 2.6) < 0.75) & (s > 3), grey_dark)
    m.pixels(cx - 1, 8, ["kk"], {"k": "#3e4248"}, z=0, part=head)

    # Tusks curving down and forward either side of the trunk.
    for sign in (-1, 1):
        tk, s_t = polyline(m, [(cx + sign * 4.6, 22.5, 8), (cx + sign * 5.4, 18.5, 5.5),
                                (cx + sign * 5.2, 15.5, 3.2), (cx + sign * 4.4, 14.2, 1.6)], 1.4, 0.9)
        tk &= m.grid == 0
        m.mask(tk, tusk, part=head)
        m.paint(tk & (s_t < 2.0), tusk_shade)

    # Big cartoon eyes with a shine, and brows.
    eye = [
        ".wwww.",
        "wkkkkw",
        "wkkhkw",
        "wkkkkw",
        "wkkkkw",
        ".wwww.",
    ]
    m.pixels(cx - 8, 26, eye, {"w": WHITE, "k": eye_black, "h": WHITE})
    m.pixels(cx + 2, 26, [r[::-1] for r in eye], {"w": WHITE, "k": eye_black, "h": WHITE})
    m.pixels(cx - 8, 32, ["dddd.."], {"d": grey_dark})
    m.pixels(cx + 2, 32, ["..dddd"], {"d": grey_dark})

    # Big floppy ears with pink insides, flopping out with every step.
    for sign, phase in ((-1, 0), (1, 1)):
        ex = cx + sign * 16.5
        ear = m.limb("Ear", pivot=(cx + sign * 11, 37, 14), phase=phase)
        outline = m.ellipsoid_mask(ex, 28.5, 14, 8.2, 9.5, 1.6) & ((xs - cx) * sign > 8)
        m.mask(outline & (m.grid == 0), grey, part=ear)
        inner = m.ellipsoid_mask(ex + sign * 0.6, 28, 14, 6.2, 7.4, 9) & outline
        m.paint(inner & m.surface("front", 1), ear_in)
        m.paint(m.ellipsoid_mask(ex + sign * 1.2, 27, 14, 3.6, 4.6, 9) & inner & m.surface("front", 1), ear_in_dark)
        m.paint(outline & m.surface("back", 1), grey_dark)


# -- La Vaca Saturno Saturnita --------------------------------------------------


@design("LaVacaSaturnoSaturnita", width=46, height=51, depth=46)
def la_vaca_saturno_saturnita(m):
    cx, cz = 23, 23
    cow_white, cow_white_shade, cow_black = "#f4f3ef", "#d6d5cf", "#1c1b1f"
    pink, pink_dark, pink_light = "#f28fa3", "#c9607a", "#f9b8c4"
    horn, horn_dark = "#e8d3a0", "#b89a5e"
    hoof, hoof_dark = "#8f959c", "#6c7178"
    deep, orange, yellow, cream = "#d9541c", "#f28a22", "#f8bf4a", "#fbe3ac"
    gold, gold_dark, gold_light = "#f2c21a", "#c8940a", "#fde277"
    xs, ys, zs = m._centres

    # Two cow legs, black and white, with big grey hooves.
    for lx, phase in ((cx - 5, 0), (cx + 5, 1)):
        leg = m.limb("Leg", pivot=(lx, 12, cz), phase=phase)
        m.box(lx - 2, 4, cz - 2, lx + 1, 12, cz + 1, cow_black, part=leg)
        m.box(lx - 2, 7, cz - 2, lx + 1, 9, cz + 1, cow_white, part=leg)
        m.box(lx - 3, 0, cz - 3, lx + 2, 3, cz + 2, hoof, part=leg)
        m.box(lx - 3, 0, cz - 3, lx + 2, 0, cz + 2, hoof_dark, part=leg)
        m.box(lx - 1, 0, cz - 3, lx, 2, cz - 3, hoof_dark, part=leg)  # cloven toe

    # Saturn: a round planet with bold orange, yellow and cream bands.
    pcy = 21
    planet = m.ellipsoid_mask(cx, pcy, cz, 12.5, 12.5, 12.5)
    m.mask(planet, orange)
    for y0, y1, colour in ((0, 12.5, deep), (15, 18, yellow), (18, 19.5, cream), (23, 25, deep),
                           (27.5, 29, cream), (29, 31, yellow)):
        m.paint(planet & (ys >= y0) & (ys < y1), colour)

    # The tilted golden ring, slowly spinning round the planet. Each column
    # of the ring is exactly two blocks thick, so it stays crisp.
    ring = m.limb("Prop", pivot=(cx, pcy, cz), axis="Y")
    dx, dz = xs - cx, zs - cz
    rho = np.hypot(dx, dz)
    yc = pcy + 0.27 * dx + 0.13 * dz
    band = (rho >= 15.5) & (rho <= 22.3)
    ring_mask = band & (ys >= np.floor(yc) - 1) & (ys < np.floor(yc) + 1)
    m.mask(ring_mask, gold, part=ring)
    m.paint(ring_mask & (rho <= 16.8), gold_dark)
    m.paint(ring_mask & (rho >= 19.2) & (rho <= 20.3), gold_light)

    # The cow's head on top: big and boxy.
    head = m.limb("Head", pivot=(cx, 32, cz))
    hx0, hx1, hy0, hy1, hz0, hz1 = cx - 11, cx + 10, 30, 47, cz - 7, cz + 6
    head_mask = rounded_box_mask(m, hx0, hy0, hz0, hx1, hy1, hz1, 2.2)
    m.mask(head_mask, cow_white, part=head)
    # Black patches: a cap over the top with a little tuft, one on each
    # side, and the back of the head down to a wavy edge.
    m.paint(head_mask & (ys > 46), cow_black)
    m.paint(head_mask & (ys > 45) & (np.abs(xs - cx) < 2.5), cow_black)
    wave = 39 + 1.2 * np.sin((xs - cx) * 0.7)
    m.paint(head_mask & (zs > cz + 1) & (ys > wave), cow_black)
    m.paint(head_mask & m.ellipsoid_mask(cx - 4, 42, cz + 7, 3, 2.2, 3), cow_white)
    m.paint(head_mask & (xs > cx + 10) & (zs > hz0 + 1) & m.ellipsoid_mask(cx + 10, 37, cz - 1, 9, 5, 5), cow_black)
    m.paint(head_mask & (xs < cx - 10) & (zs > hz0 + 1) & m.ellipsoid_mask(cx - 11, 35, cz + 2.5, 9, 3.5, 3.5), cow_black)
    m.paint(head_mask & (ys < 31) & (m.grid == m.colour(cow_white)), cow_white_shade)
    # The pink snout sticking out, with nostrils.
    snout = rounded_box_mask(m, cx - 6, 30, cz - 10, cx + 5, 35, cz - 6, 1.4)
    m.mask(snout, pink, part=head)
    m.paint(snout & (ys < 31), pink_dark)
    m.paint(snout & m.surface("top", 1), pink_light)
    m.pixels(cx - 4, 32, ["nn....nn", "nn....nn"], {"n": pink_dark}, z=cz - 10, part=head)
    # Huge googly eyes: a black rim, white, and a big pupil with a shine.
    eye = [
        "..kkkkk..",
        ".kwwwwwk.",
        "kwwwwwwwk",
        "kwkkkkkwk",
        "kwkhkkkwk",
        "kwkkkkkwk",
        "kwkkkkkwk",
        ".kwkkkwk.",
        "..kkkkk..",
    ]
    m.pixels(cx - 10, 36, eye, {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(cx + 1, 36, eye, {"w": WHITE, "k": BLACK, "h": WHITE})
    # Ears out to the sides, pink inside.
    for x0, x1 in ((hx0 - 4, hx0 - 1), (hx1 + 1, hx1 + 4)):
        m.box(x0, 40, cz - 2, x1, 42, cz + 1, cow_black, part=head)
        m.pixels(x0, 40, ["pppp", "pppp"], {"p": pink}, part=head)
    # Little horns, curving out.
    for sign, hx in ((-1, cx - 8), (1, cx + 6)):
        m.box(hx, 47, cz - 2, hx + 1, 48, cz, horn, part=head)
        m.box(hx + sign, 49, cz - 2, hx + 1 + sign, 49, cz - 1, horn, part=head)
        tip = hx if sign < 0 else hx + 1
        m.box(tip + sign, 50, cz - 2, tip + sign, 50, cz - 1, horn_dark, part=head)


# -- Sessanta Sette (67) -----------------------------------------------------------

SIX = [
    "........XXXXXXXXX...",
    "......XXXXXXXXXXXXX.",
    "....XXXXXXXXXXXXXXXX",
    "...XXXXXXXXXXXXXXXXX",
    "..XXXXXXXXXXXXXXXXX.",
    ".XXXXXXXXX.....XXX..",
    ".XXXXXXXX...........",
    "XXXXXXXX............",
    "XXXXXXXX............",
    "XXXXXXXX............",
    "XXXXXXXX............",
    "XXXXXXXX.XXXXXX.....",
    "XXXXXXXXXXXXXXXXXX..",
    "XXXXXXXXXXXXXXXXXXX.",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXX....XXXXXXXX",
    "XXXXXXX......XXXXXXX",
    "XXXXXXX......XXXXXXX",
    "XXXXXXX......XXXXXXX",
    "XXXXXXX......XXXXXXX",
    "XXXXXXXX....XXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    ".XXXXXXXXXXXXXXXXXX.",
    "..XXXXXXXXXXXXXXXX..",
    "....XXXXXXXXXXXX....",
]

SEVEN = [
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
    "...........XXXXXXXX.",
    "...........XXXXXXXX.",
    "..........XXXXXXXX..",
    "..........XXXXXXXX..",
    ".........XXXXXXXX...",
    ".........XXXXXXXX...",
    "........XXXXXXXX....",
    "........XXXXXXXX....",
    ".......XXXXXXXX.....",
    ".......XXXXXXXX.....",
    "......XXXXXXXX......",
    "......XXXXXXXX......",
    "......XXXXXXXX......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
    ".....XXXXXXXX.......",
]


@design("SessantaSette", width=56, height=48, depth=13)
def sessanta_sette(m):
    blue, blue_dark, blue_light = "#1f5fe0", "#1542a6", "#5a93f7"
    navy, sleeve = "#0f2d78", "#3cb6f2"
    glove, glove_shade = "#ffffff", "#cdd2da"
    shoe, shoe_blue, sole = "#f5f7fb", "#2a6de6", "#aeb9c7"
    dy0 = 18  # the digits' bottom row
    z0, z1 = 3, 10
    six_x, seven_x = 6, 30
    top = dy0 + len(SIX) - 1

    six = glyph_mask(m, six_x, dy0, SIX, z0, z1)
    seven = glyph_mask(m, seven_x, dy0, SEVEN, z0, z1)
    digits = six | seven
    m.mask(digits, blue)
    m.paint(digits & exposed(m, "up"), blue_light)
    m.paint(digits & exposed(m, "down"), blue_dark)
    m.paint(digits & (exposed(m, "left") | exposed(m, "right")) & ~exposed(m, "front"), blue_dark)

    # One big cartoon eye each, sticking out a little from the front.
    eye = [
        ".wwww.",
        "wkkkkw",
        "wkhkkw",
        "wkkkkw",
        "wkkkkw",
        ".wwww.",
    ]
    colours = {"w": WHITE, "k": BLACK, "h": WHITE}
    m.pixels(six_x + 1, top - 10, eye, colours, z=z0 - 1)
    m.pixels(seven_x + 12, top - 8, eye, colours, z=z0 - 1)

    # Legs: blue with a dark band at the knee, in chunky white-and-blue sneakers.
    for lx, phase in ((six_x + 8, 0), (seven_x + 7, 1)):
        leg = m.limb("Leg", pivot=(lx + 2, dy0 + 1, 6.5), phase=phase)
        m.box(lx, 5, 5, lx + 3, dy0 + 1, 8, blue, part=leg)
        m.box(lx, 11, 5, lx + 3, 12, 8, navy, part=leg)
        m.box(lx - 1, 0, 1, lx + 4, 0, 11, sole, part=leg)
        m.mask(rounded_box_mask(m, lx - 1, 1, 1, lx + 4, 4, 11, 1.0), shoe, part=leg)
        m.box(lx - 1, 1, 1, lx + 4, 2, 1, shoe_blue, part=leg)       # toe cap
        m.box(lx - 1, 1, 10, lx + 4, 4, 11, shoe_blue, part=leg)     # heel
        m.box(lx, 4, 4, lx + 3, 4, 4, shoe_blue, part=leg)           # laces
        m.box(lx, 4, 6, lx + 3, 4, 6, shoe_blue, part=leg)
        m.box(lx - 1, 2, 4, lx - 1, 3, 8, shoe_blue, part=leg)       # side stripes
        m.box(lx + 4, 2, 4, lx + 4, 3, 8, shoe_blue, part=leg)

    # Arms: blue sleeves hanging from the outer sides, white cartoon gloves.
    for sign, sx, sy, phase in ((-1, six_x - 1, top - 16, 0), (1, seven_x + 20, top - 7, 1)):
        arm = m.limb("Arm", pivot=(sx + 0.5, sy + 0.5, 6.5), phase=phase)
        hx, hy = sx + sign * 3.5, sy - 12
        m.line((sx + 0.5, sy + 0.5, 6.5), (hx, hy + 3, 6.5), 1.7, blue, part=arm)
        m.paint(m.box_mask(0, sy - 6, 0, 55, sy - 5, 13) & (m.part == arm), sleeve)
        m.paint(m.box_mask(0, sy - 1, 0, 55, sy + 1, 13) & (m.part == arm), navy)
        # The glove: a rolled cuff, a round mitten with a thumb and finger lines.
        m.cylinder(hx, hy + 1.5, 6.5, 2.9, 1.6, glove_shade, part=arm)
        m.ellipsoid(hx, hy - 1.2, 6.5, 3.0, 3.2, 2.8, glove, part=arm)
        m.ellipsoid(hx - sign * 2.6, hy - 0.2, 5.2, 1.3, 1.6, 1.3, glove, part=arm)  # thumb
        for fx in (hx - 1.5, hx + 0.5):
            m.paint(m.box_mask(fx, hy - 4.5, 3, fx, hy - 1.6, 5) & (m.part == arm), glove_shade)
