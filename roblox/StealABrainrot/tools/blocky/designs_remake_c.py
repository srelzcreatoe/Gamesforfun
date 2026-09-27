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


@design("CocofantoElefanto", width=56, height=48, depth=56)
def cocofanto_elefanto(m):
    cx = 28
    grey, grey_dark, grey_light = "#8a9199", "#666d75", "#a8aeb5"
    ear_in, ear_in_dark = "#d9a4a4", "#bf8585"
    shell, shell_dark, shell_light = "#6b2d14", "#4a1c0b", "#9a4520"
    flesh = "#f6f1e4"
    nail, tusk, tusk_shade = "#ece5d3", "#f7f0dc", "#ddd2b6"
    eye_black = "#16161a"
    xs, ys, zs = m._centres

    # Four thick grey legs with pale toenails; diagonal pairs step together.
    for lx, lz, phase in ((19, 20, 0), (37, 20, 1), (19, 40, 1), (37, 40, 0)):
        leg = m.limb("Leg", pivot=(lx, 16, lz), phase=phase)
        m.cylinder(lx, 0, lz, 3.6, 17, grey, part=leg)
        m.cylinder(lx, 0, lz, 4.1, 3, grey, part=leg)
        m.paint(m.box_mask(0, 0, 0, 55, 0, 55), grey_dark)
        for dx in (-2.5, 0, 2.5):
            nx = int(math.floor(lx + dx))
            m.box(nx, 0, int(lz - 4.2), nx, 1, int(lz - 4.2), nail, part=leg)

    # The coconut body: a big round hairy shell.
    bcy, bcz = 26, 33
    body = m.ellipsoid_mask(cx, bcy, bcz, 16, 13.5, 17)
    m.mask(body, shell)
    # Fibres: clean vertical stripes round the shell.
    ang = np.arctan2(xs - cx, zs - bcz)
    stripes = (np.floor((ang + math.pi) / (2 * math.pi) * 28) % 2) == 0
    m.paint(body & stripes & (ys > bcy - 11), shell_light)
    m.paint(body & (ys < bcy - 9), shell_dark)
    # A shaggy fringe: tufts of darker fibres sticking out all over, in rows.
    for row, lat in enumerate(range(-50, 81, 22)):
        count = int(round(22 * math.cos(math.radians(lat)))) + 2
        for k in range(count):
            lon = 2 * math.pi * (k + 0.5 * (row % 2)) / count
            cl = math.cos(math.radians(lat))
            dx, dy, dz = math.sin(lon) * cl, math.sin(math.radians(lat)), math.cos(lon) * cl
            base = (cx + 15.6 * dx, bcy + 13.1 * dy, bcz + 16.6 * dz)
            tip = (cx + 18.2 * dx, bcy + 15.0 * dy - 1.2, bcz + 19.2 * dz)
            tuft, _ = polyline(m, [base, tip], 0.75)
            m.mask(tuft & (m.grid == 0), shell_dark if (k + row) % 2 else shell)
    # The coconut is cracked open along the top: a white zig-zag of coconut.
    zig = bcz - 2 + 2.0 * np.abs(((xs - cx) / 3.0) % 2 - 1)
    crack = body & (np.abs(zs - zig) <= 0.9) & m.surface("top", 2) & (ys > bcy + 8)
    m.paint(crack, flesh)

    # A little tail with a dark tuft that wags.
    tail = m.limb("Tail", pivot=(cx, 27, 49))
    t, _ = polyline(m, [(cx, 27, 49), (cx, 24, 52.5), (cx, 19.5, 53.5)], 1.0)
    m.mask(t & (m.grid == 0), grey, part=tail)
    m.mask(m.ellipsoid_mask(cx, 18.5, 53.6, 1.5, 2.2, 1.4) & (m.grid == 0), grey_dark, part=tail)

    # The elephant head at the front, poking out of the coconut.
    head = m.limb("Head", pivot=(cx, 24, 16))
    hcy, hcz = 29, 14
    head_mask = m.ellipsoid_mask(cx, hcy, hcz, 9.8, 9.6, 8.6)
    m.mask(head_mask, grey, part=head)
    m.paint(head_mask & m.surface("top", 1) & (ys > hcy + 6), grey_light)
    m.paint(head_mask & (ys < hcy - 7), grey_dark)

    # The trunk: long, ringed with wrinkles, curling forward at the tip.
    trunk, s = polyline(m, [(cx, 25, 8), (cx, 20, 5.5), (cx, 15, 4.6), (cx, 10.5, 4.4), (cx, 7, 3.4),
                             (cx, 5.2, 1.6), (cx, 6.2, 0.6), (cx, 8.2, 0.6)], 2.9, 1.3)
    trunk &= m.grid == 0
    m.mask(trunk, grey, part=head)
    m.paint(trunk & ((s % 2.6) < 0.75) & (s > 3), grey_dark)
    m.pixels(cx - 1, 8, ["kk"], {"k": "#3e4248"}, z=0, part=head)

    # Tusks curving down and forward either side of the trunk.
    for sign in (-1, 1):
        tk, s_t = polyline(m, [(cx + sign * 4.5, 22.5, 8), (cx + sign * 5.2, 18.5, 5.5),
                                (cx + sign * 5.0, 15.5, 3.2), (cx + sign * 4.2, 14.2, 1.6)], 1.3, 0.8)
        tk &= m.grid == 0
        m.mask(tk, tusk, part=head)
        m.paint(tk & (s_t < 2.0), tusk_shade)

    # Big cartoon eyes with a shine, and brows.
    eye = [
        ".wwww.",
        "wwkkkw",
        "wkkhkw",
        "wkkkkw",
        "wkkkkw",
        ".wwww.",
    ]
    m.pixels(cx - 8, 27, eye, {"w": WHITE, "k": eye_black, "h": WHITE})
    m.pixels(cx + 2, 27, [r[::-1] for r in eye], {"w": WHITE, "k": eye_black, "h": WHITE})
    m.pixels(cx - 8, 33, ["dddd..", ".....", ], {"d": grey_dark})
    m.pixels(cx + 2, 33, ["..dddd"], {"d": grey_dark})

    # Big floppy ears with pink insides, flopping out with every step.
    for sign, phase in ((-1, 0), (1, 1)):
        ex = cx + sign * 16.5
        ear = m.limb("Ear", pivot=(cx + sign * 11, 37, 14), phase=phase)
        outline = m.ellipsoid_mask(ex, 29, 14, 8.2, 9.5, 1.6) & ((xs - cx) * sign > 8)
        m.mask(outline & (m.grid == 0), grey, part=ear)
        inner = m.ellipsoid_mask(ex + sign * 0.6, 28.5, 14, 6.2, 7.4, 9) & outline
        m.paint(inner & m.surface("front", 1), ear_in)
        m.paint(m.ellipsoid_mask(ex + sign * 1.2, 27.5, 14, 3.6, 4.6, 9) & inner & m.surface("front", 1), ear_in_dark)
        m.paint(outline & m.surface("back", 1), grey_dark)


# -- La Vaca Saturno Saturnita --------------------------------------------------


@design("LaVacaSaturnoSaturnita", width=52, height=52, depth=50)
def la_vaca_saturno_saturnita(m):
    cx, cz = 26, 25
    cow_white, cow_white_shade, cow_black = "#f4f3ef", "#d9d8d2", "#1c1b1f"
    pink, pink_dark, pink_light = "#f08fa2", "#c9607a", "#f9b8c4"
    horn, horn_dark = "#e5cf9c", "#c2a66a"
    hoof, hoof_dark = "#8f959c", "#6c7178"
    bands = ["#d8541a", "#f08a22", "#f7c25a", "#fbe2a6"]
    gold, gold_dark, gold_light = "#f0c419", "#c79a0c", "#fbe26a"
    xs, ys, zs = m._centres

    # Two cow legs, black and white, with big grey hooves.
    for lx, phase in ((cx - 5, 0), (cx + 5, 1)):
        leg = m.limb("Leg", pivot=(lx, 12, cz), phase=phase)
        m.box(lx - 2, 4, cz - 2, lx + 1, 12, cz + 1, cow_black, part=leg)
        m.box(lx - 2, 7, cz - 2, lx + 1, 9, cz + 1, cow_white, part=leg)
        m.box(lx - 3, 0, cz - 3, lx + 2, 3, cz + 2, hoof, part=leg)
        m.box(lx - 3, 0, cz - 3, lx + 2, 0, cz + 2, hoof_dark, part=leg)
        m.box(lx - 1, 0, cz - 3, lx, 2, cz - 3, hoof_dark, part=leg)  # cloven toe

    # Saturn: a round planet with crisp orange and cream bands.
    pcy = 22
    planet = m.ellipsoid_mask(cx, pcy, cz, 12.5, 12.5, 12.5)
    m.mask(planet, bands[1])
    for y0, y1, colour in ((0, 12.5, bands[0]), (14, 16, bands[2]), (18.5, 20, bands[3]), (20, 22, bands[2]),
                           (24.5, 26.5, bands[0]), (28, 30, bands[3]), (30, 31.5, bands[2]), (33, 40, bands[1])):
        m.paint(planet & (ys >= y0) & (ys < y1), colour)

    # The tilted golden ring, slowly spinning round the planet.
    ring = m.limb("Prop", pivot=(cx, pcy, cz), axis="Y")
    a, b = math.radians(16), math.radians(10)
    n = np.array([-math.sin(a), math.cos(a), -math.sin(b)])
    n /= np.linalg.norm(n)
    dx, dy, dz = xs - cx, ys - pcy, zs - cz
    h = dx * n[0] + dy * n[1] + dz * n[2]
    rho = np.sqrt(np.maximum(dx * dx + dy * dy + dz * dz - h * h, 0))
    ring_mask = (np.abs(h) <= 0.85) & (rho >= 15.5) & (rho <= 22)
    m.mask(ring_mask, gold, part=ring)
    m.paint(ring_mask & (rho <= 17), gold_dark)
    m.paint(ring_mask & (rho >= 19.8) & (rho <= 20.8), gold_light)

    # The cow's head on top.
    head = m.limb("Head", pivot=(cx, 33, cz))
    hx0, hx1, hy0, hy1, hz0, hz1 = cx - 8, cx + 7, 32, 45, cz - 7, cz + 6
    head_mask = rounded_box_mask(m, hx0, hy0, hz0, hx1, hy1, hz1, 2.2)
    m.mask(head_mask, cow_white, part=head)
    # Black patches: over the top and the back of the head, round one eye.
    m.paint(head_mask & (ys > 42), cow_black)
    m.paint(head_mask & m.ellipsoid_mask(cx + 5, 39, cz - 7, 5, 4.5, 6), cow_black)
    m.paint(head_mask & m.ellipsoid_mask(cx - 7, 36, cz + 3, 4, 3.5, 5), cow_black)
    m.paint(head_mask & m.ellipsoid_mask(cx + 4, 35, cz + 7, 5, 4, 4), cow_black)
    m.paint(head_mask & (ys < 33.5), cow_white_shade)
    # The pink snout sticking out, with nostrils.
    snout = rounded_box_mask(m, cx - 5, 32, cz - 10, cx + 4, 36, cz - 6, 1.3)
    m.mask(snout, pink, part=head)
    m.paint(snout & (ys < 33), pink_dark)
    m.pixels(cx - 3, 34, ["nn..nn"], {"n": pink_dark}, z=cz - 10, part=head)
    m.pixels(cx - 5, 36, ["pppppppppp"], {"p": pink_light}, z=cz - 9, part=head)
    # Huge round eyes with a shine.
    eye = [
        ".wwww.",
        "wkkkkw",
        "wkhkkw",
        "wkkkkw",
        "wkkkkw",
        ".wwww.",
    ]
    m.pixels(cx - 8, 37, eye, {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(cx + 2, 37, [r[::-1] for r in eye], {"w": WHITE, "k": BLACK, "h": WHITE})
    # Ears out to the sides, pink inside.
    for sign, x0, x1 in ((-1, hx0 - 4, hx0 - 1), (1, hx1 + 1, hx1 + 4)):
        m.box(x0, 39, cz - 2, x1, 41, cz + 1, cow_black, part=head)
        m.pixels(x0, 39, ["pppp", "pppp"], {"p": pink}, part=head)
    # Little horns.
    for hx in (cx - 5, cx + 4):
        m.box(hx, 46, cz - 2, hx + 1, 47, cz - 1, horn, part=head)
        m.box(hx, 48, cz - 2, hx + 1, 48, cz - 2, horn_dark, part=head)
        m.box(hx, 45, cz - 2, hx + 1, 45, cz - 1, horn_dark, part=head)


# -- Sessanta Sette (67) -----------------------------------------------------------

SIX = [
    ".....XXXXXXXX...",
    "...XXXXXXXXXXXX.",
    "..XXXXXXXXXXXXXX",
    ".XXXXXXXXXXXXXXX",
    ".XXXXXXX....XXX.",
    "XXXXXXX.........",
    "XXXXXX..........",
    "XXXXXX..........",
    "XXXXXX..........",
    "XXXXXX..........",
    "XXXXXX.XXXXXX...",
    "XXXXXXXXXXXXXXX.",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXX..XXXXXXX",
    "XXXXXX....XXXXXX",
    "XXXXXX....XXXXXX",
    "XXXXXX....XXXXXX",
    "XXXXXXX..XXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    ".XXXXXXXXXXXXXX.",
    "...XXXXXXXXXX...",
]

SEVEN = [
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "..........XXXXXX",
    ".........XXXXXX.",
    ".........XXXXXX.",
    "........XXXXXX..",
    "........XXXXXX..",
    ".......XXXXXX...",
    ".......XXXXXX...",
    "......XXXXXX....",
    "......XXXXXX....",
    ".....XXXXXX.....",
    ".....XXXXXX.....",
    ".....XXXXXX.....",
    "....XXXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
]


@design("SessantaSette", width=46, height=44, depth=14)
def sessanta_sette(m):
    blue, blue_dark, blue_light = "#1f5fe0", "#1542a6", "#5690f7"
    stripe = "#0f2f7a"
    sleeve = "#35b4f0"
    glove, glove_shade = "#f7f7f7", "#cfd3da"
    shoe, shoe_blue, sole = "#f4f6fa", "#2a6de6", "#c3ccd8"
    dy0 = 18  # the digits' bottom row
    z0, z1 = 3, 9
    six_x, seven_x = 5, 25

    six = glyph_mask(m, six_x, dy0, SIX, z0, z1)
    seven = glyph_mask(m, seven_x, dy0, SEVEN, z0, z1)
    m.mask(six | seven, blue)
    digits = six | seven
    m.paint(digits & exposed(m, "up"), blue_light)
    m.paint(digits & (exposed(m, "down") | exposed(m, "back")), blue_dark)
    m.paint(digits & (exposed(m, "left") | exposed(m, "right")) & ~exposed(m, "front"), blue_dark)

    # One big cartoon eye each: sticking out a little from the front.
    eye = [
        ".wwwww.",
        "wwkkkkw",
        "wkkhkkw",
        "wkhhkkw",
        "wkkkkkw",
        "wkkkkkw",
        ".wwwww.",
    ]
    colours = {"w": WHITE, "k": BLACK, "h": WHITE}
    m.pixels(six_x, dy0 + 15, eye, colours, z=z0 - 1)
    m.pixels(seven_x + 9, dy0 + 17, eye, colours, z=z0 - 1)

    # Legs: blue with a dark band, in chunky white-and-blue sneakers.
    for lx, phase in ((six_x + 6, 0), (seven_x + 6, 1)):
        leg = m.limb("Leg", pivot=(lx + 1.5, dy0 + 1, 6.5), phase=phase)
        m.box(lx, 5, 5, lx + 2, dy0 + 1, 7, blue, part=leg)
        m.box(lx, 11, 5, lx + 2, 12, 7, stripe, part=leg)
        m.box(lx - 1, 0, 2, lx + 3, 0, 10, sole, part=leg)
        m.box(lx - 1, 1, 2, lx + 3, 3, 10, shoe, part=leg)
        m.box(lx - 1, 4, 4, lx + 3, 4, 10, shoe, part=leg)
        m.box(lx - 1, 1, 2, lx + 3, 1, 2, shoe_blue, part=leg)
        m.box(lx - 1, 2, 9, lx + 3, 4, 10, shoe_blue, part=leg)
        m.box(lx, 4, 4, lx + 2, 4, 4, shoe_blue, part=leg)

    # Arms: blue sleeves hanging from the outer sides, white cartoon gloves.
    for sign, sx, sy, phase in ((-1, six_x - 1, dy0 + 13, 0), (1, seven_x + 15, dy0 + 19, 1)):
        arm = m.limb("Arm", pivot=(sx + 0.5, sy + 0.5, 6), phase=phase)
        hx = sx + sign * 3
        hy = sy - 9
        m.line((sx + 0.5, sy + 0.5, 6), (hx + 0.5, hy + 2.5, 6), 1.5, blue, part=arm)
        m.line((sx + 0.5 + sign * 1.3, sy - 3.5, 6), (sx + 0.5 + sign * 1.9, sy - 5.5, 6), 1.6, sleeve, part=arm)
        m.mask(rounded_box_mask(m, hx - 2, hy - 3, 4, hx + 2, hy + 1, 8, 1.0), glove, part=arm)
        m.box(hx - 2, hy + 1, 4, hx + 2, hy + 1, 8, glove_shade, part=arm)
        m.box(hx - sign * 3, hy - 1, 5, hx - sign * 3, hy, 6, glove, part=arm)  # thumb
