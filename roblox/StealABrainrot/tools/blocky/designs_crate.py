"""Block-built brainrots, batch crate: the Dominusso Cappuccinoso Crate's
famous-outfit brainrots (a golden antlered Dominus, a purple Dominus Rex, a
neon hacker and a galaxy ninja) and the Brainrot God Lucky Block's specials
(a Robux coin mascot and a gold and a diamond Tung Tung Tung Sahur).

The outfit ones are classic blocky avatars (like Galattico Guestone): two
legs, a torso, two arms and a head, all 8 voxels thick."""

import math

import numpy as np

from blocky import design, shade

BLACK = "#0b0a10"
WHITE = "#ffffff"


# -- helpers -------------------------------------------------------------------


def centres(m):
    return m._centres


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


def bevel_box(m, x0, y0, z0, x1, y1, z1):
    """A box (bounds included) with its twelve edges bevelled off by one voxel."""
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


def tapered(m, points, r0, r1):
    """A bent tube through `points`, its radius going from r0 to r1."""
    mask = np.zeros(m.grid.shape, dtype=bool)
    lengths = [math.dist(a, b) for a, b in zip(points, points[1:])]
    total = sum(lengths) or 1
    done = 0.0
    for (a, b), length in zip(zip(points, points[1:]), lengths):
        steps = max(2, int(length * 2))
        for s in range(steps):
            t = s / (steps - 1)
            p = [a[i] + (b[i] - a[i]) * t for i in range(3)]
            r = r0 + (r1 - r0) * (done + length * t) / total
            mask |= m.ellipsoid_mask(p[0], p[1], p[2], r)
        done += length
    return mask


def ellipse_prism(m, cx, cz, rx, rz, y0, y1):
    xs, _, zs = centres(m)
    return (((xs - cx) / rx) ** 2 + ((zs - cz) / rz) ** 2 <= 1) & rows_of(m, y0, y1)


def noise(m, seed):
    """Smooth-ish 0..1 noise, the same every build."""
    xs, ys, zs = centres(m)
    n = (np.sin(xs * 0.9 + seed) * np.sin(ys * 0.7 + seed * 1.7) + np.sin((xs + zs) * 0.53 + ys * 0.31 + seed * 2.3)) / 2
    return (n + 1) / 2


def speckle(m, mask, colour, seed, density):
    xs, ys, zs = centres(m)
    hash_ = ((xs * 73.13 + ys * 19.7 + zs * 41.9 + seed * 11.3) ** 2 * 0.0137) % 1.0
    m.paint(mask & (hash_ < density), colour)


def twinkle(m, x, y, z, colour, core=WHITE, arm=1, part=0):
    """A little 3D sparkle stuck on the model."""
    for d in range(1, arm + 1):
        m.box(x - d, y, z, x + d, y, z, colour, part=part)
        m.box(x, y - d, z, x, y + d, z, colour, part=part)
    m.voxel(x, y, z, core, part=part)


def r6(m, cx, z0, legs, torso, arms, leg_height=15, torso_height=16):
    """A classic blocky avatar body centred on x = cx, front at z = z0: two
    8-wide legs, a 16-wide torso and two 8-wide arms, all 8 deep. Returns the
    pieces (left leg, right leg, left arm, right arm) and the torso's top row."""
    z1 = z0 + 7
    top = leg_height + torso_height - 1
    left_leg = m.limb("Leg", pivot=(cx - 4, leg_height, z0 + 4), phase=0)
    right_leg = m.limb("Leg", pivot=(cx + 4, leg_height, z0 + 4), phase=1)
    m.mask(bevel_box(m, cx - 8, 0, z0, cx - 1, leg_height - 1, z1), legs, part=left_leg)
    m.mask(bevel_box(m, cx, 0, z0, cx + 7, leg_height - 1, z1), legs, part=right_leg)
    m.mask(bevel_box(m, cx - 8, leg_height, z0, cx + 7, top, z1), torso)
    left_arm = m.limb("Arm", pivot=(cx - 12, top - 1, z0 + 4), phase=0)
    right_arm = m.limb("Arm", pivot=(cx + 12, top - 1, z0 + 4), phase=1)
    m.mask(bevel_box(m, cx - 16, leg_height, z0, cx - 9, top, z1), arms, part=left_arm)
    m.mask(bevel_box(m, cx + 8, leg_height, z0, cx + 15, top, z1), arms, part=right_arm)
    return left_leg, right_leg, left_arm, right_arm, top


def hood(m, cx, base, zc, colour, height=16, sweep=4.0, width=6.6, depth=6.2, point=True, part=0):
    """A Dominus-style hood over the head: round at the face, rising to a
    point (or a round top) swept back by `sweep`. Returns its mask."""
    mask = np.zeros(m.grid.shape, dtype=bool)
    for i in range(height):
        t = i / (height - 1)
        # Full width round the head, then tapering to the tip.
        if t < 0.55:
            shrink = 1 - 0.06 * (t / 0.55)
        else:
            u = (t - 0.55) / 0.45
            shrink = 0.94 * (1 - u**1.6) if point else 0.94 * math.sqrt(max(0.0, 1 - u * u))
        rx, rz = max(0.7, width * shrink), max(0.7, depth * shrink)
        z = zc + sweep * max(0.0, t - 0.35) / 0.65
        mask |= ellipse_prism(m, cx, z, rx, rz, base + i, base + i)
    m.mask(mask, colour, part=part)
    return mask


def face_opening(m, cx, rows, hood_mask, void, cut_z):
    """Opens the hood's face: `rows` maps y to the half-width of the opening.
    The face is set back to `cut_z` and painted `void`. Returns the opening."""
    xs, ys, zs = centres(m)
    opening = np.zeros(m.grid.shape, dtype=bool)
    for y, w in rows.items():
        opening |= rows_of(m, y, y) & (np.abs(xs - cx) <= w)
    m.clear(opening & (zs < cut_z) & hood_mask)
    m.paint(opening & hood_mask & m.surface("front"), void)
    return opening


def trim_opening(m, cx, rows, colour, hood_mask, width=1.3, colour_inner=None):
    """Paints the hood's front round its face opening."""
    xs, ys, zs = centres(m)
    front = m.surface("front") & hood_mask
    for y in range(min(rows) - 1, max(rows) + 2):
        inner = rows.get(y, -1)
        outer = max(rows.get(y - 1, -1), inner, rows.get(y + 1, -1)) + width
        band = rows_of(m, y, y) & (np.abs(xs - cx) > inner) & (np.abs(xs - cx) <= outer)
        m.paint(front & band, colour)
        if colour_inner is not None:
            edge = rows_of(m, y, y) & (np.abs(xs - cx) > inner) & (np.abs(xs - cx) <= inner + 0.9)
            m.paint(front & edge, colour_inner)


def gold_ring(m, x, y, z, radius, colours, part=0):
    """A Dominus shoulder ring: a gold disc facing forwards with a dark hole."""
    gold, dark, light, hole = colours
    disc = m.cylinder_mask(x, y, z, radius, 2, axis="Z")
    m.mask(disc, gold, part=part)
    xs, ys, zs = centres(m)
    r = np.hypot(xs - x, ys - y)
    m.paint(disc & (r > radius - 0.9), dark)
    m.paint(disc & (r < radius * 0.55), dark)
    m.paint(disc & (r < radius * 0.38), hole)
    m.paint(disc & (r > radius * 0.55) & (r < radius - 0.9) & (ys > y + 0.3) & (xs < x), light)


def feathers(m, x, y, z, side, colours, count=5, length=7.0, part=0):
    """A fan of white feathers rising from a shoulder (side -1 = left)."""
    white, shade_, tip = colours
    for i in range(count):
        angle = math.radians(35 + i * (95 / max(1, count - 1)))
        dx, dy = side * math.cos(angle), math.sin(angle)
        end = (x + dx * length, y + dy * length * 0.95, z + 0.5 * i / count)
        feather = line_mask(m, (x, y, z), end, 0.95)
        m.mask(feather, white, part=part)
        near_tip = line_mask(m, (x + dx * length * 0.7, y + dy * length * 0.66, z), end, 1.0) & feather
        m.paint(near_tip, tip)
        m.paint(feather & line_mask(m, (x, y, z + 0.8), end, 0.5), shade_)


# -- 1. Dominusso Aureo (the golden antlered Dominus) -------------------------------


@design("DominussoAureo", width=44, height=62, depth=18)
def dominusso_aureo(m):
    cx, z0 = 22, 5
    gold, gold_mid, gold_dark, gold_deep = "#ffd23a", "#f2b418", "#c98a0a", "#8f5e05"
    gold_light, gold_white = "#ffe98a", "#fff8d6"
    amber, amber_core = "#ff9a1a", "#fff1b0"
    xs, ys, zs = centres(m)

    left_leg, right_leg, left_arm, right_arm, top = r6(m, cx, z0, gold_mid, gold, gold)
    body = m.grid > 0
    # Soft golden shading: darker low down and at the back, bright edges.
    m.paint(body & (zs > z0 + 5), gold_mid)
    m.paint(body & rows_of(m, 0, 2), gold_dark)
    m.paint(exposed(m) & body & (np.abs(xs - cx) > 7.5) & (zs < z0 + 1.5), gold_light)
    # Gold boots and a belt with a jewel.
    m.paint(body & rows_of(m, 0, 3), gold_dark)
    m.paint(body & rows_of(m, 4, 4), gold_deep)
    m.paint(body & rows_of(m, 15, 16) & (np.abs(xs - cx) <= 8), gold_deep)
    m.pixels(cx - 1, 15, ["aa", "ww"], {"a": amber, "w": amber_core})
    # A breastplate: a raised V of light gold with a sun at its heart.
    for y in range(18, 30):
        half = 2 + (y - 18) * 0.5
        m.paint_face(rows_of(m, y, y) & (np.abs(xs - cx) <= half) & (np.abs(xs - cx) > half - 1.2), gold_light)
    sun = ["..w..", ".wAw.", "wAaAw", ".wAw.", "..w.."]
    m.pixels(cx - 3, 21, sun, {"w": gold_white, "A": amber, "a": amber_core})
    # Arm bands.
    for part_mask in (m.part == left_arm, m.part == right_arm):
        m.paint(part_mask & rows_of(m, 22, 23), gold_deep)
        m.paint(part_mask & rows_of(m, 15, 16), gold_dark)

    # The hood: gold, swept back to a point, with a black face and amber eyes.
    head = m.limb("Head", pivot=(cx, top + 1, z0 + 4))
    hood_mask = hood(m, cx, top + 1, z0 + 4, gold, height=19, sweep=4.5, width=6.8, depth=6.3, part=head)
    m.paint(hood_mask & exposed(m) & (zs > z0 + 7), gold_mid)
    m.paint(hood_mask & rows_of(m, top + 1, top + 1), gold_deep)
    rows = {top + 2 + i: w for i, w in enumerate((2.6, 3.8, 4.4, 4.6, 4.6, 4.6, 4.4, 4.0, 3.4, 2.6, 1.6))}
    face_opening(m, cx, rows, hood_mask, BLACK, z0 + 2)
    trim_opening(m, cx, rows, gold_white, hood_mask, width=1.4, colour_inner=gold_deep)
    m.pixels(cx - 3, top + 6, ["aA"], {"a": amber, "A": amber_core})
    m.pixels(cx + 1, top + 6, ["Aa"], {"a": amber, "A": amber_core})
    # A jewel on the brow and a ridge down the back of the hood.
    m.pixels(cx - 1, top + 14, ["ww", "aa"], {"w": gold_white, "a": amber})
    m.paint(hood_mask & m.surface("back") & (np.abs(xs - cx) < 1.2), gold_light)

    # Golden antlers out of the hood, branching as they rise.
    for side in (-1, 1):
        base = (cx + side * 4.5, top + 12, z0 + 6)
        knee = (cx + side * 9, top + 19, z0 + 7)
        tip = (cx + side * 13, top + 29, z0 + 8)
        beam = tapered(m, [base, knee, tip], 1.35, 0.7)
        for start, end in (
            ((cx + side * 7.2, top + 16.5, z0 + 6.8), (cx + side * 5.5, top + 23, z0 + 5.5)),
            ((cx + side * 10, top + 21.5, z0 + 7.3), (cx + side * 8.5, top + 28, z0 + 6.5)),
            ((cx + side * 11.3, top + 24.8, z0 + 7.6), (cx + side * 16.5, top + 27.5, z0 + 7.5)),
            ((cx + side * 8.2, top + 18.2, z0 + 7), (cx + side * 13.5, top + 19.5, z0 + 6.5)),
        ):
            beam |= tapered(m, [start, end], 0.9, 0.55)
        m.mask(beam, gold, part=head)
        m.paint(beam & (zs > z0 + 7.2), gold_dark)
        m.paint(beam & (ys > top + 26), gold_light)
    # Shoulder guards: wings of gold plates with gold rings in front.
    for side in (-1, 1):
        feathers(m, cx + side * 9.5, top - 0.5, z0 + 3.5, side, (gold, gold_dark, gold_white), count=4, length=6.5)
        gold_ring(m, cx + side * 11.5, top + 1.5, z0 - 1.2, 3.2, (gold, gold_deep, gold_white, amber))
    # Glints on the chest and arms.
    for x, y, part in ((cx - 5, 27, 0), (cx + 5, 18, 0), (cx - 12, 25, left_arm), (cx + 12, 20, right_arm)):
        twinkle(m, x, y, z0 - 1, gold_white, part=part)


# -- 2. Dominusso Rexino (the purple Dominus Rex) ------------------------------------


@design("DominussoRexino", width=44, height=60, depth=20)
def dominusso_rexino(m):
    cx, z0 = 22, 5
    purple, purple_mid, purple_dark, purple_deep = "#8a2be2", "#6d1fc0", "#4a1291", "#2a0a55"
    purple_light, lilac = "#b56cff", "#e2c2ff"
    gold, gold_dark, gold_light = "#f7c235", "#b88414", "#fff0a0"
    black, black_light = "#16121e", "#2a2336"
    eye, eye_core = "#c14dff", "#ffe8ff"
    xs, ys, zs = centres(m)

    left_leg, right_leg, left_arm, right_arm, top = r6(m, cx, z0, purple_deep, purple, purple)
    body = m.grid > 0
    # Swirly purple robes: dark and light purple waves.
    n = noise(m, 3.1)
    m.paint(body & (n > 0.62), purple_mid)
    m.paint(body & (n < 0.3), purple_light)
    m.paint(body & (zs > z0 + 6), purple_dark)
    # Black trousers with purple plaid.
    for leg in (left_leg, right_leg):
        legs = m.part == leg
        m.paint(legs, black)
        m.paint(legs & ((np.floor(ys) % 4 == 1) | (np.floor(xs) % 4 == 1)), purple_deep)
        m.paint(legs & rows_of(m, 0, 1), black_light)
    # A purple scarf over the shoulders with a gold hem across the chest.
    for y in range(20, top + 1):
        drop = abs((y - 20) - 5.5)
        band = rows_of(m, y, y) & (np.abs(xs - cx) <= 9 - drop * 0.4) & (np.abs(xs - cx) >= 5.5 - drop * 0.9)
        m.paint_face(band, lilac if y == 20 else purple_light)
    m.paint_face(rows_of(m, 19, 20) & (np.abs(xs - cx) <= 7), gold)
    m.paint_face(rows_of(m, 18, 18) & (np.abs(xs - cx) <= 7) & (np.floor(xs) % 3 == 0), gold_dark)
    # A gold chain across the chest.
    for x in range(cx - 7, cx + 7):
        y = top - 3 - round(2.2 * math.sin(math.pi * (x - (cx - 7)) / 14))
        m.box(x, y, z0 - 1, x, y, z0 - 1, gold_light if x % 2 == 0 else gold)
    # Sleeves with gold cuffs.
    for arm in (left_arm, right_arm):
        arm_mask = m.part == arm
        m.paint(arm_mask & rows_of(m, 15, 16), gold)
        m.paint(arm_mask & rows_of(m, 17, 17), gold_dark)

    # The hood, purple with a black face and purple slit eyes.
    head = m.limb("Head", pivot=(cx, top + 1, z0 + 4))
    hood_mask = hood(m, cx, top + 1, z0 + 4, purple, height=18, sweep=4.0, width=6.8, depth=6.4, part=head)
    m.paint(hood_mask & (zs > z0 + 6), purple_mid)
    m.paint(hood_mask & exposed(m) & (ys > top + 12), purple_light)
    m.paint(hood_mask & rows_of(m, top + 1, top + 2), purple_dark)
    rows = {top + 2 + i: w for i, w in enumerate((2.4, 3.6, 4.3, 4.6, 4.6, 4.5, 4.3, 3.8, 3.2, 2.4, 1.4))}
    face_opening(m, cx, rows, hood_mask, BLACK, z0 + 2)
    trim_opening(m, cx, rows, purple_light, hood_mask, width=1.2, colour_inner=purple_deep)
    # Angry glowing eyes.
    m.pixels(cx - 4, top + 6, ["ee..", ".eE."], {"e": eye, "E": eye_core})
    m.pixels(cx, top + 6, ["..ee", ".Ee."], {"e": eye, "E": eye_core})

    # Purple horns with gold spikes, curling up out of the hood.
    for side in (-1, 1):
        points = [
            (cx + side * 4.5, top + 11, z0 + 5),
            (cx + side * 8.5, top + 15, z0 + 5.5),
            (cx + side * 10.5, top + 20, z0 + 6),
            (cx + side * 10, top + 25, z0 + 6),
            (cx + side * 7.5, top + 28.5, z0 + 5.5),
        ]
        horn = tapered(m, points, 1.9, 0.55)
        m.mask(horn, purple_mid, part=head)
        m.paint(horn & (np.abs(xs - cx) > 9.2), purple_light)
        m.paint(horn & (ys > top + 26), lilac)
        for (px, py, pz), (qx, qy, _) in zip(points[1:-1], points[2:]):
            # A gold spike pointing outwards from each bend.
            spike_end = (px + side * 2.6, py + 0.8, pz)
            m.mask(line_mask(m, (px + side * 0.8, py, pz), spike_end, 0.55), gold, part=head)
            m.voxel(int(spike_end[0]), int(spike_end[1]), int(spike_end[2]), gold_light, part=head)
        m.mask(line_mask(m, (cx + side * 6.5, top + 12.5, z0 + 4.5), (cx + side * 6.5, top + 14.5, z0 + 3), 0.6), gold, part=head)

    # White feathered shoulders and the big gold Dominus rings.
    for side in (-1, 1):
        feathers(m, cx + side * 9.5, top - 1, z0 + 4.5, side, ("#f4f2fb", "#c9c3da", purple_light), count=5, length=7.5)
        gold_ring(m, cx + side * 11, top + 1, z0 - 1.5, 3.6, (gold, gold_dark, gold_light, black))
    # Sparkles on the robes.
    for x, y, part in ((cx - 5, 24, 0), (cx + 5, 17, 0), (cx - 12, 21, left_arm), (cx + 12, 25, right_arm)):
        twinkle(m, x, y, z0 - 1, lilac, part=part)


# -- 3. Hackerino Verdino (the neon green hacker) -------------------------------


@design("HackerinoVerdino", width=40, height=50, depth=18)
def hackerino_verdino(m):
    cx, z0 = 20, 5
    armour, armour_mid, armour_light = "#15171b", "#1f2328", "#2e343b"
    neon, neon_dark, neon_core = "#3dff62", "#1fb83e", "#d8ffe0"
    hood_c, hood_dark, hood_light = "#0f4a22", "#0a3317", "#17692f"
    red, red_core = "#ff2438", "#ffc2c8"
    spike, spike_dark = "#3a2b30", "#5a1f28"
    xs, ys, zs = centres(m)

    left_leg, right_leg, left_arm, right_arm, top = r6(m, cx, z0, armour, armour, armour)
    body = m.grid > 0
    # Armour panels: a slightly lighter grid of plates.
    m.paint(body & ((np.floor(ys) % 5 == 0) | (np.floor(xs) % 8 == 3)), armour_mid)
    m.paint(exposed(m) & body & (zs < z0 + 1) & (np.floor(ys) % 5 == 1), armour_light)
    # Glowing green circuit lines on the chest and down the legs.
    circuit = [
        "..n......n..",
        "..n..nn..n..",
        "..nnnn.nnn..",
        "......n.....",
        ".nn..nNn..nn",
        "..n.nNNNn.n.",
        "..nnnNNNnnn.",
        "....nnNnn...",
        ".....n.n....",
        "...nnn.nnn..",
        "...n.....n..",
    ]
    m.pixels(cx - 6, 18, circuit, {"n": neon, "N": neon_core})
    for leg, x0 in ((left_leg, cx - 6), (right_leg, cx + 2)):
        m.pixels(x0, 2, ["n...", "n...", "nn..", ".n..", ".nnn", "...n", "...n", "..nn", "..n.", "nnn.", "n..."], {"n": neon})
        m.paint((m.part == leg) & rows_of(m, 7, 8) & m.surface("front"), armour_light)
    # Neon stripes round the arms and a glowing wrist band.
    for arm in (left_arm, right_arm):
        arm_mask = m.part == arm
        m.paint(arm_mask & exposed(m) & ((np.floor(ys) == 26) | (np.floor(ys) == 21)), neon)
        m.paint(arm_mask & exposed(m) & rows_of(m, 16, 16), neon_dark)
    # A belt with a green buckle.
    m.paint(body & rows_of(m, 15, 16) & (np.abs(xs - cx) <= 8), armour_light)
    m.pixels(cx - 1, 15, ["NN", "nn"], {"n": neon, "N": neon_core})

    # The hood: dark green, round, with a black face and angry red eyes.
    head = m.limb("Head", pivot=(cx, top + 1, z0 + 4))
    hood_mask = hood(m, cx, top + 1, z0 + 4, hood_c, height=15, sweep=2.5, width=6.6, depth=6.3, point=False, part=head)
    m.paint(hood_mask & (zs > z0 + 6), hood_dark)
    m.paint(hood_mask & exposed(m) & (ys > top + 11) & (zs < z0 + 5), hood_light)
    rows = {top + 2 + i: w for i, w in enumerate((2.6, 3.8, 4.4, 4.6, 4.6, 4.6, 4.4, 4.0, 3.2, 2.2))}
    face_opening(m, cx, rows, hood_mask, BLACK, z0 + 2)
    trim_opening(m, cx, rows, neon_dark, hood_mask, width=0.9)
    m.pixels(cx - 4, top + 6, ["rr..", ".rR."], {"r": red, "R": red_core})
    m.pixels(cx, top + 6, ["..rr", ".Rr."], {"r": red, "R": red_core})
    # A glowing seam over the top of the hood.
    m.paint(hood_mask & m.surface("top") & (np.abs(xs - cx) < 0.6), neon)

    # Spiky shoulder pads.
    for side in (-1, 1):
        pad = bevel_box(m, min(cx + side * 8, cx + side * 17), top - 3, z0 - 1, max(cx + side * 8, cx + side * 17), top + 1, z0 + 8)
        m.mask(pad, armour_mid)
        m.paint(pad & rows_of(m, top - 3, top - 3), neon_dark)
        for i, (dx, dz) in enumerate(((10, 1), (12.5, 3.5), (15, 6), (11.5, 7), (14, 1.5))):
            start = (cx + side * dx, top + 1, z0 + dz)
            end = (cx + side * (dx + 2.2), top + 5.5 - (i % 2), z0 + dz + 0.8)
            spike_mask = tapered(m, [start, end], 1.1, 0.45)
            m.mask(spike_mask, spike)
            m.paint(spike_mask & (ys > top + 3.5), spike_dark)


# -- 4. Ninjaccio Violino (the galaxy ninja) ------------------------------------


@design("NinjaccioViolino", width=42, height=54, depth=24)
def ninjaccio_violino(m):
    cx, z0 = 21, 6
    violet, violet_mid, violet_dark, violet_deep = "#5d2fa8", "#46208a", "#301563", "#1c0b3d"
    violet_light, star = "#8f5ce0", "#f3e6ff"
    hood_c, hood_light, hood_dark = "#6f5a82", "#8c77a0", "#4c3c5c"
    scarf, scarf_dark = "#5b3943", "#3e252d"
    visor, visor_core = "#c34dff", "#ffe0ff"
    crystal, crystal_light, crystal_dark, crystal_core = "#8a5cff", "#c9a8ff", "#3a1f8a", "#ffffff"
    fur, fur_dark = "#7d4fc0", "#5a3396"
    xs, ys, zs = centres(m)

    left_leg, right_leg, left_arm, right_arm, top = r6(m, cx, z0, violet_dark, violet, violet)
    body = m.grid > 0
    # Armour plates with galaxy speckles.
    m.paint(body & (noise(m, 1.3) > 0.6), violet_mid)
    m.paint(body & (zs > z0 + 6), violet_dark)
    speckle(m, exposed(m) & body, star, 4, 0.05)
    speckle(m, exposed(m) & body, violet_light, 9, 0.08)
    # A belt with pouches, straps across the chest.
    m.paint(body & rows_of(m, 15, 16) & (np.abs(xs - cx) <= 8), violet_deep)
    for y in range(17, top + 1):
        x = cx - 7 + (y - 17)
        m.paint_face(m.box_mask(x, y, 0, x + 1, y, m.depth - 1), scarf_dark)
    # White stars on the knees and gauntlets.
    knee = [".s.", "sSs", ".s."]
    m.pixels(cx - 6, 6, knee, {"s": violet_light, "S": star})
    m.pixels(cx + 3, 6, knee, {"s": violet_light, "S": star})
    for arm in (left_arm, right_arm):
        arm_mask = m.part == arm
        m.paint(arm_mask & rows_of(m, 15, 19), violet_deep)
        m.paint(arm_mask & rows_of(m, 17, 17) & exposed(m), visor)

    # Fluffy purple fur round the neck.
    collar = np.zeros(m.grid.shape, dtype=bool)
    for i in range(14):
        a = i / 14 * 2 * math.pi
        start = (cx + 7.5 * math.cos(a), top, z0 + 4 + 5 * math.sin(a))
        end = (cx + 10.5 * math.cos(a), top + 3 + (i % 3), z0 + 4 + 7 * math.sin(a))
        collar |= tapered(m, [start, end], 1.3, 0.5)
    m.mask(collar, fur)
    m.paint(collar & (ys > top + 2.5), fur_dark)

    # The hood (grey-violet), a black face with a glowing visor slit and a scarf.
    head = m.limb("Head", pivot=(cx, top + 1, z0 + 4))
    hood_mask = hood(m, cx, top + 1, z0 + 4, hood_c, height=16, sweep=3.0, width=6.8, depth=6.4, part=head)
    m.paint(hood_mask & exposed(m) & (xs < cx - 2), hood_light)
    m.paint(hood_mask & (zs > z0 + 7), hood_dark)
    rows = {top + 2 + i: w for i, w in enumerate((3.6, 4.4, 4.6, 4.6, 4.6, 4.4, 4.0, 3.2, 2.2))}
    face_opening(m, cx, rows, hood_mask, BLACK, z0 + 2)
    m.pixels(cx - 4, top + 7, ["vvVVVVvv"], {"v": visor, "V": visor_core})
    m.pixels(cx - 3, top + 6, ["vvvvvv"], {"v": "#6b1f99"})
    # The scarf wraps the lower face and neck.
    wrap = ellipse_prism(m, cx, z0 + 4, 6.9, 6.6, top + 1, top + 4) & ~ellipse_prism(m, cx, z0 + 4, 5.0, 4.5, top + 1, top + 4)
    wrap |= ellipse_prism(m, cx, z0 + 4, 6.9, 6.6, top + 1, top + 4) & (zs < z0 + 1)
    m.mask(wrap, scarf, part=head)
    m.paint(wrap & rows_of(m, top + 2, top + 2), scarf_dark)
    tail = tapered(m, [(cx + 5, top + 2, z0 + 1), (cx + 8, top - 3, z0), (cx + 9, top - 8, z0 + 1)], 1.2, 0.8)
    m.mask(tail, scarf)
    m.paint(tail & rows_of(m, 0, top - 5), scarf_dark)
    # Two claw marks on the hood's crown.
    m.paint(hood_mask & m.surface("front") & rows_of(m, top + 13, top + 14) & (np.abs(np.abs(xs - cx) - 1.5) < 0.6), hood_dark)

    # Two big galaxy crystal blades on the back, crossed.
    blades = np.zeros(m.grid.shape, dtype=bool)
    for start, end, r0 in (
        ((cx - 9, 13, z0 + 10), (cx + 14, top + 22, z0 + 14), 2.4),
        ((cx + 6, 10, z0 + 11.5), (cx + 19, top + 14, z0 + 15.5), 1.8),
    ):
        blade = tapered(m, [start, end], r0, 0.5)
        blades |= blade
        m.mask(blade, crystal)
        edge = line_mask(m, start, end, r0 * 0.35)
        m.paint(blade & edge, crystal_light)
    m.paint(blades & exposed(m) & (noise(m, 7.7) > 0.72), crystal_dark)
    speckle(m, blades & exposed(m), crystal_core, 12, 0.07)
    # The hilts and a strap over the back.
    for x, y, z in ((cx - 9, 13, z0 + 10), (cx + 6, 10, z0 + 11.5)):
        m.mask(m.ellipsoid_mask(x, y, z, 1.7), violet_deep)
        m.voxel(x, y - 2, z, visor)


# -- 5. Robuxone Dorato (the golden Robux coin mascot) --------------------------------


def hexagon_mask(m, cx, cy, radius, z0, z1, flat_top=False):
    xs, ys, zs = centres(m)
    dx, dy = np.abs(xs - cx), np.abs(ys - cy)
    if flat_top:
        dx, dy = dy, dx
    # A hexagon with pointy top: |y| + |x| tan30 ... as three slabs.
    inside = (dx <= radius * math.sqrt(3) / 2) & (dy + dx / math.sqrt(3) <= radius)
    return inside & (zs >= z0) & (zs <= z1 + 1)


@design("RobuxoneDorato", width=40, height=50, depth=18)
def robuxone_dorato(m):
    cx, z0 = 20, 5
    gold, gold_mid, gold_dark, gold_deep = "#ffcf3a", "#f0b21c", "#c98b0c", "#8a5c06"
    gold_light, gold_white = "#ffe690", "#fff9dc"
    cape, cape_dark, coin = "#ffdf6e", "#e8b83a", "#fff3b0"
    xs, ys, zs = centres(m)

    left_leg, right_leg, left_arm, right_arm, top = r6(m, cx, z0, gold_mid, gold, gold)
    body = m.grid > 0
    m.paint(body & (zs > z0 + 5), gold_mid)
    m.paint(exposed(m) & body & (zs < z0 + 1) & (np.abs(xs - cx) > 7), gold_light)
    m.paint(body & rows_of(m, 0, 2), gold_dark)
    m.paint(body & rows_of(m, 15, 16) & (np.abs(xs - cx) <= 8), gold_dark)
    # The Robux hexagon on the chest: a raised outline round a dark hole.
    chest = hexagon_mask(m, cx, 23.5, 5.6, z0 - 1, z0 - 1)
    hole = hexagon_mask(m, cx, 23.5, 3.2, z0 - 1, z0 - 1)
    m.mask(chest & ~hole, gold_light)
    m.paint(m.surface("front") & hexagon_mask(m, cx, 23.5, 3.2, 0, m.depth - 1), gold_deep)
    m.paint(chest & ~hole & (ys > 25) & (xs < cx), gold_white)
    # Round shoulder pads with rims.
    for side in (-1, 1):
        pad = m.ellipsoid_mask(cx + side * 12, top - 0.5, z0 + 4, 5.2, 3.2, 5.0) & (ys > top - 3)
        m.mask(pad, gold)
        m.paint(pad & (ys < top - 1.5), gold_deep)
        m.paint(pad & m.surface("top"), gold_light)
    # Knee and elbow guards.
    for leg in (left_leg, right_leg):
        m.paint((m.part == leg) & rows_of(m, 6, 8) & m.surface("front"), gold_light)
    for arm in (left_arm, right_arm):
        m.paint((m.part == arm) & rows_of(m, 16, 18), gold_dark)

    # A golden cape covered in coins.
    cape_mask = np.zeros(m.grid.shape, dtype=bool)
    for y in range(2, top + 1):
        t = (top - y) / (top - 2)
        half = 8 + 5 * t
        wave = 0.8 * math.sin(y * 0.6)
        cape_mask |= rows_of(m, y, y) & (np.abs(xs - cx) <= half) & (zs >= z0 + 8) & (zs < z0 + 9 + 1.2 * t + max(0.0, wave))
    m.mask(cape_mask, cape)
    m.paint(cape_mask & (noise(m, 2.2) > 0.65), cape_dark)
    for x, y in ((cx - 6, 8), (cx + 4, 12), (cx - 2, 18), (cx + 8, 22), (cx - 9, 25), (cx + 1, 27), (cx - 4, 4), (cx + 9, 5), (cx - 11, 14)):
        coin_mask = m.cylinder_mask(x, y, m.depth - 1, 1.6, -m.depth, axis="Z") & cape_mask & m.surface("back")
        m.paint(coin_mask, coin)
        m.paint(coin_mask & (np.abs(xs - x) < 0.6) & (np.abs(ys - y) < 0.6), gold_dark)

    # The head: a big Robux coin (a hexagon) with a happy face.
    head = m.limb("Head", pivot=(cx, top + 1, z0 + 4))
    cy = top + 9
    coin_head = hexagon_mask(m, cx, cy, 8.2, z0 + 1, z0 + 6)
    m.mask(coin_head, gold, part=head)
    # A raised rim (a voxel proud of the face), bright on top, dark below.
    rim = hexagon_mask(m, cx, cy, 8.2, z0, z0) & ~hexagon_mask(m, cx, cy, 6.4, 0, m.depth - 1)
    m.mask(rim, gold_mid, part=head)
    m.paint(rim & (ys > cy + 1), gold_light)
    m.paint(rim & (ys < cy - 3), gold_dark)
    m.paint(coin_head & ~hexagon_mask(m, cx, cy, 7.4, 0, m.depth - 1) & (zs > z0 + 2), gold_dark)
    face_zone = hexagon_mask(m, cx, cy, 6.4, z0 + 1, z0 + 1)
    m.paint(face_zone & (ys > cy + 3) & (xs < cx - 1), gold_white)
    m.paint(face_zone & hexagon_mask(m, cx, cy, 6.4, 0, m.depth - 1) & ~hexagon_mask(m, cx, cy, 5.6, 0, m.depth - 1), gold_light)
    # The face: two eyes and the classic smile.
    face = [
        "..b...b..",
        "..b...b..",
        ".........",
        "b.......b",
        ".b.....b.",
        "..bbbbb..",
    ]
    m.pixels(cx - 4, cy - 3, face, {"b": "#2a1a05"})
    # Its neck.
    m.box(cx - 2, top + 1, z0 + 2, cx + 1, top + 1, z0 + 5, gold_dark, part=head)


# -- 6 and 7. Tung Tung Tung Oro and Tung Tung Tung Diamante ------------------------


def tung(m, palette, seed, half=7, club=2.1):
    """Tung Tung Tung Sahur: a tall log of a body (2 * half wide) with a face,
    thin arms and legs, and his bat (`club` thick at the end), made of gold
    or diamond."""
    base, light, dark, deep, glint = palette["base"], palette["light"], palette["dark"], palette["deep"], palette["glint"]
    xs, ys, zs = centres(m)
    cx = m.width / 2
    z0 = 3

    # Thin legs.
    left = m.limb("Leg", pivot=(cx - 3, 13, z0 + 4), phase=0)
    right = m.limb("Leg", pivot=(cx + 3, 13, z0 + 4), phase=1)
    for part, x0 in ((left, cx - 5), (right, cx + 1)):
        m.box(x0, 1, z0 + 3, x0 + 3, 13, z0 + 5, base, part=part)
        m.box(x0 - 1, 0, z0 + 1, x0 + 3, 1, z0 + 6, dark, part=part)
    # The log: a tall rounded block.
    log = bevel_box(m, cx - half, 13, z0, cx + half - 1, 43, z0 + 9)
    m.mask(log, base)
    shell = exposed(m) & log
    # Grain: long vertical streaks of light and dark.
    grain = np.sin(xs * 2.1 + np.sin(ys * 0.35 + seed) * 1.5 + zs * 1.3 + seed)
    m.paint(shell & (grain > 0.72), light)
    m.paint(shell & (grain < -0.8), dark)
    m.paint(log & rows_of(m, 13, 14), dark)
    m.paint(log & m.surface("top"), light)
    # Facets that catch the light (diamond) or polish (gold).
    facets = ((np.floor(xs) + np.floor(ys)) % 7 == 0) & shell
    m.paint(facets, palette.get("facet", light))
    # Big eyes, thick brows and a little mouth.
    eye = ["wwww", "wwww", "wPPw", "wPPw", "wwww"]
    m.pixels(int(cx) - 6, 32, eye, {"w": palette["eye"], "P": palette["pupil"]})
    m.pixels(int(cx) + 2, 32, eye, {"w": palette["eye"], "P": palette["pupil"]})
    m.pixels(int(cx) - 7, 38, ["dddddd..", ".ddddd.."], {"d": deep})
    m.pixels(int(cx) + 1, 38, ["..dddddd", "..ddddd."], {"d": deep})
    m.pixels(int(cx) - 3, 26, ["dddddd", ".dddd."], {"d": deep})
    # Thin arms, the right one holding his bat up over the shoulder.
    shoulder = half + 1.5
    left_arm = m.limb("Arm", pivot=(cx - shoulder, 30, z0 + 5), phase=0)
    right_arm = m.limb("Arm", pivot=(cx + shoulder, 30, z0 + 5), phase=1)
    m.mask(line_mask(m, (cx - shoulder, 30, z0 + 5), (cx - shoulder - 2.5, 17, z0 + 4), 1.3), base, part=left_arm)
    m.mask(m.ellipsoid_mask(cx - shoulder - 2.7, 16.5, z0 + 4, 1.8), dark, part=left_arm)
    m.mask(line_mask(m, (cx + shoulder, 30, z0 + 5), (cx + shoulder + 2.5, 18, z0 + 3), 1.3), base, part=right_arm)
    m.mask(m.ellipsoid_mask(cx + shoulder + 2.7, 17.5, z0 + 3, 1.8), dark, part=right_arm)
    hand = cx + shoulder + 3
    bat = tapered(m, [(hand, 15, z0 + 3), (hand + 3, 30, z0 + 5), (hand + 4.5, 39, z0 + 6)], 0.8, club)
    m.mask(bat, palette["bat"], part=right_arm)
    m.paint(bat & (ys > 33), palette["bat_light"])
    m.paint(bat & (ys < 18), deep)
    # Glints.
    for x, y, z in palette["glints"]:
        twinkle(m, x, y, z, glint, core=WHITE)


GOLD_TUNG = {
    "base": "#f6c416", "light": "#ffe46a", "dark": "#c58c02", "deep": "#6e4a00", "glint": "#fff6c8",
    "facet": "#ffd84a", "eye": "#fff8e0", "pupil": "#3a2600", "bat": "#e9a50c", "bat_light": "#ffd24a",
    "glints": ((11, 41, 2), (17, 21, 2), (19, 29, 2)),
}
DIAMOND_TUNG = {
    "base": "#7fdfff", "light": "#d4f7ff", "dark": "#3aa9e0", "deep": "#123f8c", "glint": "#ffffff",
    "facet": "#b3eeff", "eye": "#f2fdff", "pupil": "#1a2fa0", "bat": "#56c4f5", "bat_light": "#c8f3ff",
    "glints": ((11, 41, 2), (17, 21, 2), (19, 29, 2)),
}


@design("TungTungTungOro", width=30, height=46, depth=14)
def tung_tung_tung_oro(m):
    tung(m, GOLD_TUNG, 0.7)


@design("TungTungTungDiamante", width=34, height=46, depth=14)
def tung_tung_tung_diamante(m):
    # A chunkier crystal log with a bigger crystal club.
    tung(m, DIAMOND_TUNG, 2.9, half=9, club=2.8)
    # A diamond's cut: bright bevels on every corner of the log.
    xs, ys, zs = centres(m)
    log = m.box_mask(8, 13, 3, 25, 43, 12) & exposed(m)
    corners = ((np.abs(xs - 17) > 7.5) & ((zs < 4.5) | (zs > 11.5)))
    m.paint(log & corners, "#eafcff")
