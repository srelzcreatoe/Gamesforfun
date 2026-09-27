"""Block-built brainrots from the original Steal a Brainrot, batch A:
Talpa Di Fero, Pipi Kiwi, Racooni Jandelini, Svinina Bombardino,
Cacto Hipopotamo, Ta Ta Ta Ta Sahur, Tipi Topi Taco and Zibra Zubra Zibralini."""

import math

import numpy as np

from blocky import design, shade

BLACK = "#16161a"
WHITE = "#ffffff"


# -- helpers ---------------------------------------------------------------


def _centres(m):
    return np.meshgrid(
        np.arange(m.width) + 0.5, np.arange(m.height) + 0.5, np.arange(m.depth) + 0.5, indexing="ij"
    )


def tube(m, points, radii):
    """A chain of tapered capsules through `points`. Returns (mask, s) where s
    is the distance along the chain of each voxel's closest point."""
    xs, ys, zs = _centres(m)
    p = np.stack([xs, ys, zs], axis=-1)
    best = np.full(xs.shape, np.inf)
    along = np.zeros(xs.shape)
    total = 0.0
    for i in range(len(points) - 1):
        a, b = np.array(points[i], float), np.array(points[i + 1], float)
        ra, rb = radii[i], radii[i + 1]
        ab = b - a
        length = float(np.linalg.norm(ab))
        t = np.clip(((p - a) @ ab) / max(1e-9, length * length), 0, 1)
        d = np.linalg.norm(p - (a + t[..., None] * ab), axis=-1)
        score = d - (ra + (rb - ra) * t)
        better = score < best
        best = np.where(better, score, best)
        along = np.where(better, total + t * length, along)
        total += length
    return best <= 0, along


def spiral(m, base, tip, pitch=3.0):
    """A boolean field of spiral bands around the axis base -> tip (for drills)."""
    xs, ys, zs = _centres(m)
    p = np.stack([xs, ys, zs], axis=-1) - np.array(base, float)
    axis = np.array(tip, float) - np.array(base, float)
    axis /= np.linalg.norm(axis)
    helper = np.array([1.0, 0, 0]) if abs(axis[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    s = p @ axis
    angle = np.arctan2(p @ v, p @ u)
    return (np.floor(s / (pitch / 2) + angle / math.pi) % 2) == 0


def speckle(m, colour, into, density, seed, region=None):
    """Recolours a random sprinkle of the voxels that are `colour`."""
    rng = np.random.default_rng(seed)
    mask = (m.grid == m.colour(colour)) & (rng.random(m.grid.shape) < density)
    if region is not None:
        mask &= region
    m.paint(mask, into)


def top_pixels(m, x0, z0, rows, colours):
    """Pixel art seen from above: rows[0] is the frontmost row (at z0)."""
    for r, row in enumerate(rows):
        for c, char in enumerate(row):
            if char in colours:
                m.paint_face(m.box_mask(x0 + c, 0, z0 + r, x0 + c, m.height - 1, z0 + r), colours[char], face="top")


def filled(m, part):
    return (m.grid > 0) & (m.part == part)


def colour_mask(m, colour):
    return m.grid == m.colour(colour)


def blob_mask(m, cx, cy, cz, rx, ry, rz, power=3.0):
    """A rounded box (superellipsoid): power 2 is an ellipsoid, higher is boxier."""
    xs, ys, zs = _centres(m)
    return (np.abs((xs - cx) / rx) ** power + np.abs((ys - cy) / ry) ** power + np.abs((zs - cz) / rz) ** power) <= 1


# -- Talpa Di Fero -----------------------------------------------------------


@design("TalpaDiFero", width=32, height=35, depth=22)
def talpa_di_fero(m):
    cx = 16
    fur, fur_dark, fur_light = "#7c6a5a", "#56473a", "#9e8b79"
    fur_spot = shade(fur, -0.16)
    belly = "#b8a28b"
    pink, pink_dark, pink_light = "#ff8db0", "#e0628a", "#ffc6d8"
    iron, iron_dark, iron_light = "#8f979e", "#5b636a", "#c8cfd4"
    lamp, lamp_core, housing = "#ffd84a", "#fffbe0", "#3a3f45"
    drill, drill_dark = "#b3bcc4", "#6d767e"

    # Short stubby legs with pink mole feet.
    left = m.limb("Leg", pivot=(11, 7, 12), phase=0)
    right = m.limb("Leg", pivot=(21, 7, 12), phase=1)
    for part, x0 in ((left, 9), (right, 19)):
        m.box(x0, 2, 10, x0 + 3, 7, 14, fur_dark, part=part)
        m.box(x0, 0, 8, x0 + 3, 1, 14, pink, part=part)
        m.box(x0, 0, 7, x0 + 3, 0, 7, pink_light, part=part)
        m.box(x0 + 1, 0, 7, x0 + 1, 1, 8, pink_dark, part=part)

    # Chunky round body with a lighter belly and a little pink tail.
    m.ellipsoid(cx, 13.5, 13, 10.5, 8.5, 7.5, fur)
    m.paint_face(m.ellipsoid_mask(cx, 12, 0, 6.5, 6, 99), belly, face="front")
    m.line((cx, 9, 19), (cx, 8, 22), 1.1, pink)

    # The head sits on the body; the big pink nose pokes forwards.
    head = m.limb("Head", pivot=(cx, 20, 12))
    m.ellipsoid(cx, 24, 10, 8.5, 7, 7.5, fur, part=head)
    m.ellipsoid(cx, 22.5, 4, 4, 3.2, 3, fur_light, part=head)
    m.ellipsoid(cx, 22.5, 2, 3.3, 2.6, 2, pink, part=head)
    m.pixels(14, 21, ["hh..", "h...", ".dd.", ".dd."], {"h": pink_light, "d": pink_dark}, part=head)
    # Tiny eyes, rosy cheeks and a toothy grin.
    for x in (11, 19):
        m.pixels(x, 25, ["wk", "kk"], {"w": WHITE, "k": BLACK})
    m.pixels(9, 23, ["pp"], {"p": pink_light})
    m.pixels(21, 23, ["pp"], {"p": pink_light})
    m.pixels(13, 18, ["k....k", ".kwwk."], {"k": BLACK, "w": WHITE})

    # Iron miner's helmet: a round dome, a brim with rivets and a glowing lamp.
    dome = m.ellipsoid_mask(cx, 26.5, 10, 9, 8.5, 8.3) & m.box_mask(0, 28, 0, 31, 36, 21)
    m.mask(dome, iron, part=head)
    brim = m.ellipsoid_mask(cx, 26.5, 10, 10.3, 8.5, 9.4) & m.box_mask(0, 27, 0, 31, 27, 21)
    m.mask(brim, iron_dark, part=head)
    m.paint(dome & m.box_mask(15, 0, 0, 16, 36, 21) & m.surface("top", 2), iron_light)
    m.paint(dome & m.box_mask(0, 28, 0, 31, 28, 21), iron_dark)
    for x in (8, 11, 20, 23):
        m.paint_face(m.box_mask(x, 27, 0, x, 27, 21), iron_light, face="front")
    m.cylinder(cx, 31, 0.5, 3.0, 4.5, housing, axis="Z", part=head)
    m.pixels(14, 29, [".yy.", "ccyy", "ycyy", ".yy."], {"y": lamp, "c": lamp_core}, part=head)

    # Drill hands: furry arms, an iron cuff and a spiral cone drill.
    left_arm = m.limb("Arm", pivot=(5, 18, 13), phase=0)
    right_arm = m.limb("Arm", pivot=(27, 18, 13), phase=1)
    for part, x0 in ((left_arm, 3), (right_arm, 25)):
        m.box(x0, 12, 11, x0 + 3, 18, 14, fur_dark, part=part)
        m.box(x0 - 1, 10, 10, x0 + 4, 11, 15, iron_dark, part=part)
        m.box(x0 - 1, 11, 10, x0 + 4, 11, 10, iron_light, part=part)
        base, tip = (x0 + 2, 10, 12.5), (x0 + 2, 1.6, 8)
        cone, _ = tube(m, [base, tip], [3.2, 0.4])
        m.mask(cone, drill, part=part)
        m.paint(cone & spiral(m, base, tip), drill_dark)

    speckle(m, fur, fur_spot, 0.12, 1)
    speckle(m, fur, fur_light, 0.05, 2)


# -- Pipi Kiwi ---------------------------------------------------------------


@design("PipiKiwi", width=28, height=40, depth=24)
def pipi_kiwi(m):
    cx, cy = 14, 19
    skin, skin_dark, skin_light = "#8b5a2b", "#6c4420", "#a3703d"
    flesh, flesh_light, flesh_dark = "#76c135", "#a9e05c", "#4d9a22"
    core, core_light = "#f0eac0", "#fffbe8"
    beak, beak_dark = "#e8d19d", "#c2a36b"
    leg, leg_dark = "#ff9f2e", "#d9731a"

    # Thin orange bird legs with three-toed feet.
    left = m.limb("Leg", pivot=(10, 10, 17), phase=0)
    right = m.limb("Leg", pivot=(18, 10, 17), phase=1)
    for part, x0 in ((left, 9), (right, 17)):
        m.box(x0, 1, 16, x0 + 1, 10, 17, leg, part=part)
        m.box(x0 - 1, 0, 13, x0 + 2, 1, 18, leg, part=part)
        m.box(x0 - 2, 0, 12, x0 - 2, 0, 14, leg_dark, part=part)
        m.box(x0 + 3, 0, 12, x0 + 3, 0, 14, leg_dark, part=part)
        m.box(x0, 0, 11, x0 + 1, 0, 12, leg_dark, part=part)

    # The body is a kiwi fruit sliced in half: fuzzy skin behind, cut face in front.
    fruit = m.ellipsoid_mask(cx, cy, 13, 11, 10.5, 11) & m.box_mask(0, 0, 10, 27, 39, 27)
    m.mask(fruit, skin)
    speckle(m, skin, skin_dark, 0.2, 3)
    speckle(m, skin, skin_light, 0.1, 4)
    xs, ys, _ = _centres(m)
    r = np.sqrt((xs - cx) ** 2 + ((ys - cy) / 0.95) ** 2)
    angle = np.arctan2(ys - cy, xs - cx)
    face = m.surface("front") & (m.grid > 0) & m.box_mask(0, 0, 10, 27, 39, 10)
    m.paint(face & (r <= 9.6), flesh)
    m.paint(face & (r <= 9.6) & (r > 8.4), flesh_dark)
    streak = (np.floor((angle + math.pi) / (2 * math.pi) * 18) % 2 == 0) & (r > 5.8) & (r < 8.2)
    m.paint(face & streak, flesh_light)
    m.paint(face & (r <= 5.8), flesh_light)
    m.paint(face & (((xs - cx) / 3.2) ** 2 + ((ys - cy) / 4.2) ** 2 <= 1), core)
    m.paint(face & (((xs - cx + 0.8) / 1.4) ** 2 + ((ys - cy - 1.2) / 2.0) ** 2 <= 1), core_light)
    for k in range(14):
        a = k / 14 * 2 * math.pi + 0.2
        sx, sy = cx + 4.9 * math.cos(a), cy + 5.4 * math.sin(a)
        m.paint(face & m.box_mask(sx, sy, 0, sx, sy, 27), BLACK)

    # A fuzzy kiwi-bird head on top, with big eyes and a long thin beak.
    head = m.limb("Head", pivot=(cx, 27, 17))
    m.sphere(cx, 31, 16, 7, skin, part=head)
    speckle(m, skin, skin_dark, 0.2, 5, m.part == head)
    m.box(13, 38, 15, 14, 39, 16, skin_dark, part=head)
    m.box(12, 38, 16, 12, 38, 16, skin_dark, part=head)
    m.pixels(8, 31, [".www.", "wwwww", "wwhkw", "wwkkw", ".www."], {"w": WHITE, "k": BLACK, "h": WHITE}, part=head)
    m.pixels(15, 31, [".www.", "wwwww", "whkww", "wkkww", ".www."], {"w": WHITE, "k": BLACK, "h": WHITE}, part=head)
    bill, _ = tube(m, [(cx, 30, 10.5), (cx, 27.5, 5), (cx, 25, 0.6)], [1.35, 1.05, 0.8])
    m.mask(bill, beak, part=head)
    m.paint(bill & m.surface("bottom"), beak_dark)


# -- Racooni Jandelini --------------------------------------------------------


@design("RacooniJandelini", width=32, height=41, depth=31)
def racooni_jandelini(m):
    cx = 16
    grey, grey_dark, grey_light = "#8e9098", "#5e6068", "#b6b8bf"
    grey_spot = shade(grey, -0.12)
    cream, black = "#f3f1ea", "#1c1c21"
    wax, wax_shadow = "#f6eedb", "#dccaa2"
    flame, flame_core, flame_tip = "#ffa000", "#fff176", "#ff5a1f"
    brass = "#e0b040"

    # Legs: dark grey with black paws.
    left = m.limb("Leg", pivot=(12, 11, 14), phase=0)
    right = m.limb("Leg", pivot=(20, 11, 14), phase=1)
    for part, x0 in ((left, 10), (right, 18)):
        m.box(x0, 2, 12, x0 + 3, 11, 15, grey_dark, part=part)
        m.box(x0, 0, 10, x0 + 3, 1, 15, black, part=part)

    # Round body with shoulders and a pale belly.
    m.ellipsoid(cx, 18.5, 14, 8.5, 9, 7, grey)
    m.ellipsoid(cx, 23.5, 14, 9.5, 3.5, 5.5, grey)
    m.paint_face(m.ellipsoid_mask(cx, 17, 0, 5, 6.5, 99), grey_light, face="front")

    # A big fluffy ringed tail curling up behind.
    tail = m.limb("Tail", pivot=(cx, 13, 20))
    ring, s = tube(m, [(cx, 13, 19), (cx, 12, 24), (cx, 15, 28.5), (cx, 21, 29), (cx, 26, 26.5)], [2.6, 3.4, 3.6, 3.3, 2.2])
    m.mask(ring, grey, part=tail)
    m.paint(ring & (np.floor(s / 3.0) % 2 == 1), black)
    m.paint(ring & (s > s[ring].max() - 2.5), black)

    # Head: grey with a black bandit mask, white brows and muzzle, round ears.
    head = m.limb("Head", pivot=(cx, 26, 14))
    m.ellipsoid(cx, 32, 13, 9, 7, 7, grey, part=head)
    m.ellipsoid(cx, 29.5, 13, 10, 3.5, 5, grey, part=head)  # cheek fluff
    for x in (9, 23):
        m.ellipsoid(x, 38, 13, 3, 3, 1.6, grey, part=head)
    m.pixels(7, 37, [".www.", "wkkkw", "wkkkw", "wkkk."], {"w": cream, "k": black}, part=head)
    m.pixels(20, 37, [".www.", "wkkkw", "wkkkw", ".kkkw"], {"w": cream, "k": black}, part=head)
    m.pixels(8, 30, [
        "..wwww..wwww..",
        ".kkkkkkkkkkkk.",
        "kkwwkkkkkkwwkk",
        "kkwkkk..kkwkkk",
        "kkkkk....kkkkk",
        ".kkk......kkk.",
    ], {"w": cream, "k": black}, part=head)
    m.ellipsoid(cx, 29, 6.5, 3.5, 2.6, 2.2, cream, part=head)
    m.pixels(15, 29, ["kk", "kk"], {"k": black}, z=4, part=head)
    m.pixels(14, 27, ["k..k", ".kk."], {"k": black}, part=head)
    m.paint(m.box_mask(15, 32, 0, 16, 35, 30) & m.surface("front") & (m.part == head), grey_dark)

    # Arms: the left one swings free, the right one holds out a lit candle.
    left_arm = m.limb("Arm", pivot=(6.5, 25, 13.5), phase=0)
    right_arm = m.limb("Arm", pivot=(25.5, 25, 13.5), phase=1)
    m.box(5, 16, 12, 7, 25, 15, grey, part=left_arm)
    m.box(5, 14, 12, 7, 15, 15, black, part=left_arm)
    m.box(24, 17, 12, 26, 25, 15, grey, part=right_arm)
    m.box(24, 16, 7, 26, 18, 14, grey, part=right_arm)
    m.box(24, 16, 5, 26, 18, 6, black, part=right_arm)
    m.cylinder(25.5, 19, 5.5, 2.6, 1, brass, part=right_arm)
    m.cylinder(25.5, 20, 5.5, 1.5, 6, wax, part=right_arm)
    m.box(24, 23, 4, 24, 25, 4, wax_shadow, part=right_arm)
    m.box(25, 26, 5, 25, 26, 5, BLACK, part=right_arm)
    m.box(24, 27, 4, 26, 28, 6, flame, part=right_arm)
    m.box(25, 27, 4, 25, 28, 4, flame_core, part=right_arm)
    m.box(25, 29, 4, 25, 29, 6, flame, part=right_arm)
    m.box(25, 29, 4, 25, 29, 4, flame_core, part=right_arm)
    m.box(25, 30, 5, 25, 31, 5, flame_tip, part=right_arm)

    speckle(m, grey, grey_spot, 0.08, 6)


# -- Svinina Bombardino -------------------------------------------------------


@design("SvininaBombardino", width=52, height=26, depth=49)
def svinina_bombardino(m):
    cx = 26
    pink, pink_dark, pink_light = "#f59ab8", "#d96b92", "#ffc9da"
    hoof = "#7a3b52"
    metal, metal_dark, metal_light = "#8c969e", "#5a636b", "#b9c2c9"
    glass, glass_light = "#8fd3ff", "#e6f7ff"
    leather, leather_dark = "#7a4a2a", "#553219"
    bomb, bomb_dark = "#5b6b36", "#3e4a24"
    wood, tip = "#6b4a2b", "#ffd12e"
    green, red = "#2e9e46", "#d7322f"

    # The fuselage is the pig's body, tapering towards the tail.
    for z in range(6, 46):
        r = 7.0 if z < 30 else 7.0 - (z - 30) * 0.27
        cy = 12.5 + max(0, z - 30) * 0.2
        m.cylinder(cx, cy, z, r, 1, pink, axis="Z")
    m.paint(m.surface("bottom", 2), pink_light)
    for z in (21, 33):
        m.paint(m.box_mask(0, 0, z, 51, 26, z), pink_dark)

    # Four little trotters tucked under like landing gear.
    for x0, z0, y0 in ((21, 12, 3), (29, 12, 3), (22, 34, 4), (28, 34, 4)):
        m.box(x0, y0, z0, x0 + 1, 9, z0 + 1, pink)
        m.box(x0, y0, z0, x0 + 1, y0, z0 + 1, hoof)

    # The pig's head is the nose of the plane, in a leather flying cap.
    m.sphere(cx, 13, 11, 8, pink)
    m.paint(m.ellipsoid_mask(cx, 13, 11, 8.5) & m.box_mask(0, 18, 0, 51, 26, 20), leather)
    m.paint(m.ellipsoid_mask(cx, 13, 11, 8.5) & m.box_mask(0, 18, 0, 51, 18, 20), leather_dark)
    m.cylinder(cx, 11, 2, 3.6, 3, pink_dark, axis="Z")
    m.pixels(23, 8, [".pppppp.", "pkkppkkp", "pkkppkkp", "pppppppp", ".pppppp."], {"p": pink_dark, "k": "#8a2f52"})
    for x in (19, 29):
        m.pixels(x, 14, [".ww.", "whkw", "wkkw", ".ww."], {"w": WHITE, "k": BLACK, "h": WHITE})
    for x in (20, 28):
        m.pixels(x, 18, [".mm.", "mbgm", ".mm."], {"m": metal_light, "b": glass, "g": glass_light})
    m.pixels(23, 5, ["k....k", ".kkkk."], {"k": "#8a2f52"})
    for sign in (-1, 1):
        ear, _ = tube(m, [(cx + sign * 5, 18, 11), (cx + sign * 6.5, 23, 9), (cx + sign * 6.5, 24.5, 6.5)], [2.4, 1.8, 1.0])
        m.mask(ear, pink)
        m.paint(ear & m.surface("front") & m.box_mask(0, 21, 0, 51, 26, 49), pink_dark)

    # Glass cockpit on the pig's back.
    canopy = m.ellipsoid_mask(cx, 19.5, 19, 3.6, 3.2, 5) & m.box_mask(0, 19, 0, 51, 26, 49)
    m.mask(canopy, glass)
    m.paint(canopy & m.box_mask(0, 0, 18, 51, 26, 18), metal_dark)
    m.paint(canopy & m.box_mask(24, 21, 15, 24, 21, 17), glass_light)

    # Metal wings with engines and Italian roundels.
    for x in range(1, 51):
        d = abs(x + 0.5 - cx)
        lead, trail = 17 + d * 0.1, 27 - d * 0.12
        if d > 22:
            lead += (d - 22) * 0.9
            trail -= (d - 22) * 0.9
        m.box(x, 11, lead, x, 12, trail, metal)
    m.paint(m.surface("bottom") & m.box_mask(0, 11, 0, 51, 11, 49), metal_dark)
    for x in (8, 17, 34, 43):
        m.paint(m.box_mask(x, 12, 0, x, 12, 49) & m.surface("top"), metal_light)
    for x0 in (4, 43):
        top_pixels(m, x0, 19, [".ggg.", "gwwwg", "gwrwg", "gwwwg", ".ggg."], {"g": green, "w": WHITE, "r": red})
    for ex in (12, 40):
        m.cylinder(ex, 12, 14, 2.7, 13, metal_dark, axis="Z")
        m.cylinder(ex, 12, 14, 2.7, 1, metal_light, axis="Z")

    # Tail: stabiliser, twin fins in green, white and red, and a curly pig tail.
    m.box(15, 14, 39, 36, 15, 45, metal)
    for x in (15, 35):
        m.box(x, 13, 39, x + 1, 21, 45, metal)
        m.box(x, 22, 41, x + 1, 22, 45, metal)
        m.box(x, 16, 40, x + 1, 21, 40, green)
        m.box(x, 16, 41, x + 1, 21, 42, WHITE)
        m.box(x, 16, 43, x + 1, 21, 44, red)
    curl = m.limb("Tail", pivot=(cx, 16, 45.5))
    pig_tail, _ = tube(m, [(cx, 16, 45), (cx, 17.5, 47.5), (cx + 1.5, 19.5, 47.5), (cx + 1.5, 20, 45.5), (cx - 0.5, 19, 45.5)], [1.0, 1.0, 1.0, 0.9, 0.8])
    m.mask(pig_tail, pink, part=curl)

    # A bomb under the belly.
    m.box(25, 4, 20, 26, 6, 24, metal_dark)
    shell = m.ellipsoid(cx, 2.5, 22, 2.6, 2.6, 6, bomb)
    m.paint(shell & m.box_mask(0, 0, 16, 51, 26, 17), tip)
    m.paint(shell & m.box_mask(0, 0, 0, 51, 1, 49), bomb_dark)
    m.box(23, 2, 28, 28, 3, 29, metal_dark)
    m.box(25, 0, 28, 26, 5, 29, metal_dark)

    # Propellers: one on the snout, one on each engine; yellow blade tips.
    nose = m.limb("Prop", pivot=(cx, 11, 1), axis="Z")
    m.box(25, 10, 0, 26, 11, 1, metal_dark, part=nose)
    m.box(25, 3, 1, 26, 18, 1, wood, part=nose)
    m.box(25, 3, 1, 26, 4, 1, tip, part=nose)
    m.box(25, 17, 1, 26, 18, 1, tip, part=nose)
    for ex in (12, 40):
        prop = m.limb("Prop", pivot=(ex, 12, 12), axis="Z")
        m.box(ex - 1, 11, 12, ex, 12, 13, metal_dark, part=prop)
        m.box(ex - 1, 7, 12, ex, 16, 12, wood, part=prop)
        m.box(ex - 1, 7, 12, ex, 7, 12, tip, part=prop)
        m.box(ex - 1, 16, 12, ex, 16, 12, tip, part=prop)


# -- Cacto Hipopotamo ----------------------------------------------------------


@design("CactoHipopotamo", width=30, height=28, depth=39)
def cacto_hipopotamo(m):
    cx = 15
    green, green_dark = "#4caf3c", "#2f7d27"
    rib = shade(green, -0.22)
    spine = "#fff3b8"
    mouth, tongue, tooth = "#7a1d2c", "#ff7a98", "#fffdf2"
    petal, petal_dark, petal_light, pollen = "#ff5fa8", "#e0357f", "#ffa6d1", "#ffd33d"
    xs, ys, zs = _centres(m)
    ribs_x = np.floor(np.abs(xs - cx))

    # Four stubby legs with pale toenails.
    legs = []
    for x0, z0, phase in ((6, 12, 0), (19, 12, 1), (6, 28, 1), (19, 28, 0)):
        leg = m.limb("Leg", pivot=(x0 + 2.5, 7, z0 + 2.5), phase=phase)
        m.box(x0, 0, z0, x0 + 4, 7, z0 + 4, green, part=leg)
        legs.append((leg, x0, z0))

    # Barrel body and a stubby tail with a bud.
    m.ellipsoid(cx, 14, 22, 11, 8.5, 13, green)
    tail = m.limb("Tail", pivot=(cx, 15, 34))
    stub, _ = tube(m, [(cx, 15, 33.5), (cx, 13, 37)], [1.3, 1.0])
    m.mask(stub, green, part=tail)
    m.box(14, 12, 37, 15, 13, 38, petal, part=tail)

    # Big boxy hippo head: a huge square muzzle with nostril bumps, little
    # eyes and ears on top.
    head = m.limb("Head", pivot=(cx, 15, 15))
    m.mask(blob_mask(m, cx, 20.5, 12.5, 7.5, 5, 6.5), green, part=head)
    m.mask(blob_mask(m, cx, 14.5, 6.5, 10, 6.5, 6.5), green, part=head)
    m.sphere(10.5, 24.5, 9.5, 2.3, green, part=head, mirror=True)
    m.ellipsoid(9, 25.5, 15, 1.6, 2.2, 1.3, green, part=head, mirror=True)
    m.ellipsoid(11.5, 20.5, 3, 2.1, 1.6, 1.9, green, part=head, mirror=True)

    # Cactus ribs and spines everywhere (before the face goes on).
    body = filled(m, 0)
    m.paint(body & (np.floor(zs) % 4 == 0), rib)
    m.paint(body & (np.floor(zs) % 4 == 2) & (np.floor(ys) % 3 == 1), spine)
    for leg, x0, z0 in legs:
        mine = filled(m, leg)
        m.paint(mine & (ribs_x % 2 == 0), rib)
        m.paint(mine & m.box_mask(x0, 0, z0, x0 + 4, 1, z0) & (ribs_x % 2 == 1), spine)
    headm = filled(m, head)
    m.paint(headm & (ribs_x % 4 == 2), rib)
    m.paint(headm & (ribs_x % 4 == 0) & (np.floor(ys) % 3 == 0) & (ys > 17), spine)
    m.paint(headm & m.surface("top") & (np.floor(zs) % 4 == 0), rib)

    # The open smile: a crescent carved into the muzzle, two teeth and a tongue.
    dx = xs - cx
    top_edge = 17.0 + 0.02 * dx**2
    bottom_edge = 10.6 + 0.06 * dx**2
    opening = (ys > bottom_edge) & (ys < top_edge) & (np.abs(dx) < 7.6)
    front = m.box_mask(0, 0, 0, 29, 31, 3)
    m.clear(opening & front)
    m.paint(opening & m.box_mask(0, 0, 4, 29, 31, 5), mouth)
    m.paint(front & (ys < bottom_edge) & (ys > bottom_edge - 1.2) & (np.abs(dx) < 6.5) & (m.part == head), tongue)
    m.paint_face(m.box_mask(0, 17, 0, 29, 31, 3) & (ys < top_edge + 1.0) & (np.abs(dx) < 8), green_dark, face="front")
    m.box(9, 11, 1, 10, 14, 2, tooth, part=head, mirror=True)
    m.box(9, 14, 1, 9, 14, 2, shade(tooth, -0.12), part=head, mirror=True)
    # Nostrils on the snout bumps and little eyes.
    m.pixels(11, 21, ["kk....kk", "dd....dd"], {"k": BLACK, "d": green_dark}, part=head)
    m.paint(m.box_mask(11, 22, 0, 12, 22, 5) & m.surface("top"), BLACK, mirror=True)
    m.pixels(9, 23, ["www", "whk", "wkk"], {"w": WHITE, "k": BLACK, "h": WHITE}, part=head)
    m.pixels(18, 23, ["www", "khw", "kkw"], {"w": WHITE, "k": BLACK, "h": WHITE}, part=head)
    m.pixels(9, 26, ["ddd"], {"d": green_dark}, part=head)
    m.pixels(18, 26, ["ddd"], {"d": green_dark}, part=head)

    # A pink cactus flower on top of the head.
    m.box(12, 25, 10, 17, 25, 13, petal_dark, part=head)
    m.box(13, 25, 9, 16, 25, 14, petal_dark, part=head)
    m.box(11, 26, 10, 18, 26, 13, petal, part=head)
    m.box(12, 26, 9, 17, 26, 14, petal, part=head)
    m.box(13, 26, 8, 16, 26, 15, petal, part=head)
    m.box(13, 26, 10, 16, 26, 13, petal_light, part=head)
    m.box(14, 26, 11, 15, 27, 12, pollen, part=head)
    for x, z in ((11, 11), (11, 12), (18, 11), (18, 12), (14, 8), (15, 8), (14, 15), (15, 15)):
        m.voxel(x, 27, z, petal_light, part=head)
    # Pink insides for the little ears.
    m.paint(m.box_mask(9, 25, 14, 9, 26, 14) & filled(m, head), petal_light, mirror=True)


# -- Ta Ta Ta Ta Sahur ---------------------------------------------------------


@design("TaTaTaTaSahur", width=34, height=39, depth=26)
def ta_ta_ta_ta_sahur(m):
    cx = 17
    copper, copper_dark, copper_light, shine = "#c8733a", "#8c4a1e", "#e59a5e", "#ffd6ad"
    knob, handle = "#2d2a28", "#3a2c24"
    limb, shoe = "#6b4428", "#2a2320"
    bat, bat_dark, bat_light = "#c9975a", "#9c6b35", "#e6bd84"

    # Skinny legs in little shoes.
    left = m.limb("Leg", pivot=(13, 13, 12), phase=0)
    right = m.limb("Leg", pivot=(21, 13, 12), phase=1)
    for part, x0 in ((left, 12), (right, 20)):
        m.box(x0, 2, 11, x0 + 1, 13, 12, limb, part=part)
        m.box(x0 - 1, 0, 9, x0 + 2, 1, 13, shoe, part=part)

    # The round copper kettle body on a darker base ring.
    kettle = m.ellipsoid_mask(cx, 22, 12, 11, 9.5, 8.5) & m.box_mask(0, 13, 0, 33, 43, 26)
    m.mask(kettle, copper)
    m.cylinder(cx, 12, 12, 7.5, 2, copper_dark, axis="Y")
    m.paint(kettle & m.box_mask(0, 13, 0, 33, 13, 26), copper_dark)
    m.paint(m.ellipsoid_mask(7.5, 21, 0, 1.2, 3.2, 99) & m.surface("front"), shine)
    m.paint(m.ellipsoid_mask(26.5, 17, 0, 1.2, 2.2, 99) & m.surface("front"), copper_light)

    # The lid is its hat, with a knob on top.
    m.cylinder(cx, 30, 12, 7.8, 1, copper_dark, axis="Y")
    lid = m.ellipsoid_mask(cx, 31, 12, 6.5, 3.5, 6.5) & m.box_mask(0, 31, 0, 33, 43, 26)
    m.mask(lid, copper)
    m.paint(lid & m.box_mask(0, 32, 0, 33, 32, 26) & m.surface("front"), copper_light)
    m.box(16, 33, 11, 17, 35, 12, knob)
    m.sphere(cx, 37, 12, 1.8, knob)

    # Big eyes, stern brows and a toothy grin under the spout nose.
    m.pixels(9, 22, [".wwww.", "wwwwww", "wwkkww", "wkkhkw", "wkkkkw", ".wwww."], {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(19, 22, [".wwww.", "wwwwww", "wwkkww", "wkhkkw", "wkkkkw", ".wwww."], {"w": WHITE, "k": BLACK, "h": WHITE})
    m.pixels(8, 28, ["kkk....", "..kkkkk"], {"k": BLACK})
    m.pixels(19, 28, ["....kkk", "kkkkk.."], {"k": BLACK})
    m.pixels(12, 15, ["kkkkkkkkkk", "kwwwwwwwwk", ".kkkkkkkk."], {"k": BLACK, "w": WHITE})
    spout, s = tube(m, [(cx, 19.5, 7), (cx, 21, 3), (cx, 24, 0.6)], [2.2, 1.8, 1.6])
    m.mask(spout, copper)
    m.paint(spout & (s > s[spout].max() - 1.2), copper_dark)
    m.paint(spout & m.box_mask(0, 0, 0, 33, 43, 0), knob)
    m.paint(spout & m.surface("left"), copper_light)

    # A handle loop on the back.
    grip, _ = tube(m, [(cx, 27, 19), (cx, 27, 23.5), (cx, 23, 25.2), (cx, 17.5, 23.5), (cx, 16.5, 19)], [1.2] * 5)
    m.mask(grip, handle)

    # Skinny arms; the right hand grips a wooden bat.
    left_arm = m.limb("Arm", pivot=(5, 24, 12), phase=0)
    right_arm = m.limb("Arm", pivot=(29, 24, 12), phase=1)
    m.box(4, 14, 11, 5, 24, 12, limb, part=left_arm)
    m.box(3, 11, 10, 5, 13, 13, limb, part=left_arm)
    m.box(28, 14, 11, 29, 24, 12, limb, part=right_arm)
    m.box(28, 11, 10, 30, 13, 13, limb, part=right_arm)
    club, s = tube(m, [(29.5, 8.5, 11.5), (30.2, 20, 9), (31, 32, 6.5)], [0.9, 1.3, 2.2])
    club &= ~filled(m, right_arm)
    m.mask(club, bat, part=right_arm)
    m.paint(club & (np.floor(s) % 5 == 0), bat_dark)
    m.paint(club & (s < 1.2), bat_dark)
    m.paint(club & m.surface("left"), bat_light)


# -- Tipi Topi Taco ------------------------------------------------------------


@design("TipiTopiTaco", width=32, height=40, depth=32)
def tipi_topi_taco(m):
    cx = 16
    grey, grey_dark, grey_light, belly = "#9d9ca6", "#6f6e79", "#c3c2cb", "#e3e2ea"
    pink, nose = "#f99bb5", "#ff5f8f"
    shell, shell_dark, shell_light, toast = "#f4c24e", "#dca035", "#ffe18a", "#b8761f"
    lettuce, lettuce_light = "#5cbf2c", "#9be651"
    tomato, tomato_light, beef = "#e3342f", "#ff7a6b", "#8d4f2a"
    cheese, cheese_light = "#ff9f1a", "#ffd24d"
    xs, ys, zs = _centres(m)

    # The giant taco shell curls around the mouse's back like a cape: a U seen
    # from above (pinched together at both ends of the fold), a half moon seen
    # from the side.
    dist = np.sqrt((xs - cx) ** 2 + np.maximum(0, zs - 13) ** 2)
    inner = 6.6 + 3.0 * np.sqrt(np.clip(1 - ((ys - 21) / 13.5) ** 2, 0, 1))

    def profile(grow):
        return (((ys - 21) / (13 + grow)) ** 2 + ((zs - 25.5) / (17.5 + grow)) ** 2 <= 1) & (zs <= 25.5)

    shell_side = shade(shell, -0.08)
    taco = profile(0) & (dist >= inner) & (dist <= inner + 2.1)
    m.mask(taco, shell)
    m.paint(taco & (np.abs(xs - cx) > inner * 0.75), shell_side)
    for base in (shell, shell_side):
        speckle(m, base, shell_dark, 0.16, 7)
        speckle(m, base, toast, 0.05, 8)
    m.paint(taco & ~profile(-1.1), shell_light)
    # Fillings packed inside the shell behind the mouse, spilling over the rim.
    rng = np.random.default_rng(9)
    pick = rng.integers(0, 10, size=(m.width // 2 + 1, m.height // 2 + 1, m.depth // 2 + 1))
    chunk = pick[(xs // 2).astype(int), (ys // 2).astype(int), (zs // 2).astype(int)]
    bed = profile(0) & (dist < inner) & (zs >= 16.5) & ((ys < 21) | (zs >= 19))
    frill = profile(1.0) & ~profile(0) & (dist >= inner - 1.4) & (dist <= inner + 2.1)
    frill &= (chunk >= 6) | (np.floor(ys * 0.9 + zs * 0.6) % 6 < 4)
    for region in (bed, frill):
        m.mask(region & (chunk < 5), lettuce)
        m.mask(region & (chunk == 5), beef)
        m.mask(region & (chunk >= 6) & (chunk < 8), tomato)
        m.mask(region & (chunk >= 8), cheese)
    m.paint(frill & (chunk < 5) & (np.floor(xs + ys) % 3 == 0), lettuce_light)
    m.paint(frill & (chunk >= 8) & (np.floor(ys) % 2 == 0), cheese_light)
    m.paint(frill & (chunk >= 6) & (chunk < 8) & (np.floor(ys + zs) % 3 == 0), tomato_light)

    # Two short legs with pink feet.
    left = m.limb("Leg", pivot=(12.5, 8, 13), phase=0)
    right = m.limb("Leg", pivot=(19.5, 8, 13), phase=1)
    for part, x0 in ((left, 11), (right, 18)):
        m.box(x0, 2, 11, x0 + 2, 8, 14, grey_dark, part=part)
        m.box(x0, 0, 9, x0 + 2, 1, 14, pink, part=part)

    # Little body with a pale belly.
    m.ellipsoid(cx, 15, 13, 6.5, 7.5, 5.5, grey)
    m.paint_face(m.ellipsoid_mask(cx, 14, 0, 4, 5, 99), belly, face="front")

    # Mouse head with a pointy snout, whiskers and big round pink ears.
    head = m.limb("Head", pivot=(cx, 21, 13))
    m.ellipsoid(cx, 27, 12, 7, 6.5, 6, grey, part=head)
    m.ellipsoid(cx, 25, 6, 3.5, 3, 3.2, grey_light, part=head)
    m.sphere(cx, 26, 2.6, 1.6, nose, part=head)
    for sign in (-1, 1):
        ex = cx + sign * 6.5
        m.cylinder(ex, 35, 10, 4.6, 2, grey, axis="Z", part=head)
        m.cylinder(ex, 35, 10, 3.3, 1, pink, axis="Z", part=head)
    m.pixels(11, 28, ["kkk", "khk", "kkk"], {"k": BLACK, "h": WHITE}, part=head)
    m.pixels(18, 28, ["kkk", "khk", "kkk"], {"k": BLACK, "h": WHITE}, part=head)
    for sign in (-1, 1):
        m.line((cx + sign * 2.5, 25, 5.5), (cx + sign * 7, 26, 5.5), 0.5, grey_dark, part=head)
        m.line((cx + sign * 2.5, 24, 5.5), (cx + sign * 7, 23, 5.5), 0.5, grey_dark, part=head)
    m.pixels(15, 22, ["k..k", ".kk."], {"k": BLACK}, part=head)
    m.pixels(10, 25, ["p"], {"p": pink}, part=head)
    m.pixels(21, 25, ["p"], {"p": pink}, part=head)

    # Little arms.
    left_arm = m.limb("Arm", pivot=(9, 20, 13), phase=0)
    right_arm = m.limb("Arm", pivot=(23, 20, 13), phase=1)
    m.box(8, 14, 12, 9, 20, 14, grey, part=left_arm)
    m.box(8, 13, 12, 9, 13, 14, pink, part=left_arm)
    m.box(22, 14, 12, 23, 20, 14, grey, part=right_arm)
    m.box(22, 13, 12, 23, 13, 14, pink, part=right_arm)

    # A long pink tail sweeping out behind, under the shell.
    tail = m.limb("Tail", pivot=(cx, 10, 17))
    worm, _ = tube(m, [(cx, 10, 17), (cx, 6.5, 22), (cx, 6, 28), (cx + 2, 8, 31.5), (cx + 3, 12, 31.5)], [1.1, 0.9, 0.8, 0.7, 0.6])
    m.mask(worm, pink, part=tail)


# -- Zibra Zubra Zibralini -----------------------------------------------------


@design("ZibraZubraZibralini", width=30, height=49, depth=24)
def zibra_zubra_zibralini(m):
    cx = 15
    white, black = "#f7f7f7", "#18181c"
    muzzle, nostril, mane_grey, ear_inner = "#3d3d45", "#0c0c0f", "#3a3a42", "#b9a7ad"
    sneaker, sneaker_dark, sole = "#e53935", "#b71c1c", "#ffffff"
    xs, ys, zs = _centres(m)

    # Striped legs in red sneakers.
    left = m.limb("Leg", pivot=(12, 14, 12), phase=0)
    right = m.limb("Leg", pivot=(18, 14, 12), phase=1)
    for part, x0 in ((left, 10), (right, 16)):
        m.box(x0, 4, 10, x0 + 3, 14, 13, white, part=part)
        m.paint(filled(m, part) & (np.floor(ys) % 4 < 2), black)
        m.box(x0 - 1, 0, 7, x0 + 4, 3, 14, sneaker, part=part)
        m.box(x0 - 1, 0, 7, x0 + 4, 0, 14, sole, part=part)
        m.box(x0 - 1, 1, 7, x0 + 4, 1, 7, sole, part=part)
        m.box(x0, 3, 8, x0 + 3, 3, 9, sneaker_dark, part=part)
        m.pixels(x0, 2, ["w..w"], {"w": sole}, part=part)

    # Body with chevron stripes.
    m.ellipsoid(cx, 20.5, 12, 7.5, 8, 6, white)
    m.paint(filled(m, 0) & (np.floor(ys + 0.6 * np.abs(xs - cx)) % 4 < 2), black)
    m.paint_face(m.ellipsoid_mask(cx, 18, 0, 3.2, 4.5, 99), white, face="front")

    # Tail with a black tuft.
    tail = m.limb("Tail", pivot=(cx, 16, 17))
    whip, s = tube(m, [(cx, 16, 16.5), (cx, 12.5, 20.5), (cx, 10, 22)], [1.1, 1.0, 1.0])
    m.mask(whip, white, part=tail)
    m.paint(whip & (np.floor(s) % 3 == 0), black)
    m.ellipsoid(cx, 8.5, 22.5, 1.5, 2.2, 1.5, black, part=tail)

    # Head: a long cartoon face angled down to a dark muzzle, slanted stripes,
    # big nostrils, tall ears and a spiky black mohawk.
    head = m.limb("Head", pivot=(cx, 27, 12.5))
    neck, _ = tube(m, [(cx, 25, 12.5), (cx, 34, 14.5)], [3.3, 3.3])
    m.mask(neck, white, part=head)
    top, nose_end = np.array((cx, 39.5, 14.0)), np.array((cx, 31.5, 6.5))
    face, _ = tube(m, [tuple(top), tuple(nose_end)], [6.3, 5.0])
    m.mask(face, white, part=head)
    for sign in (-1, 1):
        ear, _ = tube(m, [(cx + sign * 3.5, 43.5, 15), (cx + sign * 5, 48.5, 15.5)], [1.9, 0.8])
        m.mask(ear, white, part=head)
        m.paint(ear & (ys > 47), black)
        m.paint(ear & m.surface("front") & (ys > 45) & (ys < 47) & (np.abs(xs - cx - sign * 4.3) < 0.9), ear_inner)
    axis = (nose_end - top) / np.linalg.norm(nose_end - top)
    length = float(np.linalg.norm(nose_end - top))
    along = (xs - top[0]) * axis[0] + (ys - top[1]) * axis[1] + (zs - top[2]) * axis[2]
    headm = filled(m, head)
    m.paint(headm & (np.floor(along / 1.8) % 2 == 1) & (along < length - 1.5) & (ys < 45), black)
    m.paint(face & (along >= length - 1.5), muzzle)
    m.pixels(11, 31, ["kk....kk", "kk....kk"], {"k": nostril}, part=head)
    m.pixels(12, 28, ["k....k", ".kkkk."], {"k": nostril}, part=head)
    # Big eyes bulging out of a black stripe across the face.
    m.paint_face(m.ellipsoid_mask(cx, 38.5, 0, 8, 4.3, 99) & filled(m, head), black, face="front")
    m.ellipsoid(12, 38.5, 7.9, 2.3, 2.6, 2.0, WHITE, part=head, mirror=True)
    m.pixels(10, 36, [".ww.", "wwww", "wwkh", "wwkk", ".ww."], {"w": WHITE, "k": BLACK, "h": WHITE}, part=head)
    m.pixels(16, 36, [".ww.", "wwww", "khww", "kkww", ".ww."], {"w": WHITE, "k": BLACK, "h": WHITE}, part=head)
    # Mohawk: a fin of backswept spikes from the forehead down the neck.
    fin = m.box_mask(13, 0, 0, 16, m.height - 1, m.depth - 1)
    roots, spikes = [], []
    for degrees, height in ((-40, 3.0), (-15, 3.8), (10, 4.2), (35, 4.2), (60, 3.8), (85, 3.4), (110, 3.0)):
        a = math.radians(degrees)
        normal = np.array((0, math.cos(a), math.sin(a)))
        root = top + 5.8 * normal
        direction = normal + np.array((0, 0, 0.45))
        roots.append(tuple(root))
        spikes.append((tuple(root), tuple(root + height * direction / np.linalg.norm(direction))))
    for y, z in ((31.5, 16.8), (28, 16.2)):
        roots.append((cx, y, z))
        spikes.append(((cx, y, z), (cx, y + 0.8, z + 2.6)))
    base, _ = tube(m, roots, [1.6] * len(roots))
    m.mask(base & fin, black, part=head)
    for root, tip in spikes:
        spike, _ = tube(m, [root, tip], [1.9, 0.5])
        m.mask(spike & fin, black, part=head)
    m.paint(filled(m, head) & fin & m.surface("top") & colour_mask(m, black) & (ys > 40), mane_grey)

    # Striped arms with black hooves.
    left_arm = m.limb("Arm", pivot=(6.5, 26, 12), phase=0)
    right_arm = m.limb("Arm", pivot=(23.5, 26, 12), phase=1)
    for part, x0 in ((left_arm, 5), (right_arm, 22)):
        m.box(x0, 18, 11, x0 + 2, 26, 13, white, part=part)
        m.paint(filled(m, part) & (np.floor(ys) % 4 < 2), black)
        m.box(x0, 16, 11, x0 + 2, 17, 13, black, part=part)
