"""Block-built remakes of four original brainrots that used to be
auto-voxelised: Tung Tung Tung Sahur, Lirili Larila, Tim Cheese and
Brr Brr Patapim. Same characters, rebuilt as clean, crisp voxel art."""

import math

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


def tube(m, points, radii):
    """A chain of tapered capsules through `points`. Returns (mask, s) where s
    is the distance along the chain of each voxel's closest point."""
    xs, ys, zs = m._centres
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


def column_mask(m, cx, cz, rx, rz, y0, y1, power=2.6):
    """An upright column (bounds included in y) with a rounded-square
    (superellipse) cross-section: power 2 is round, higher is squarer."""
    xs, ys, zs = m._centres
    ring = np.abs((xs - cx) / rx) ** power + np.abs((zs - cz) / rz) ** power <= 1
    return ring & (ys >= y0) & (ys <= y1 + 1)


def hash01(m, seed, x=None, y=None, z=None):
    """A fixed pseudo-random value 0..1 per voxel (or per column/segment when
    x, y or z are given as coarser index grids)."""
    ix, iy, iz = np.indices(m.grid.shape).astype(np.int64)
    ix = ix if x is None else x.astype(np.int64)
    iy = iy if y is None else y.astype(np.int64)
    iz = iz if z is None else z.astype(np.int64)
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def exposed(m, mask=None, sides=False):
    """Filled voxels with an empty neighbour (with sides=True, only an empty
    neighbour to the left, right, front or back)."""
    filled = m.grid > 0
    p = np.pad(filled, 1, constant_values=False)
    around = [p[2:, 1:-1, 1:-1], p[:-2, 1:-1, 1:-1], p[1:-1, 1:-1, 2:], p[1:-1, 1:-1, :-2]]
    if not sides:
        around += [p[1:-1, 2:, 1:-1], p[1:-1, :-2, 1:-1]]
    result = filled & ~np.logical_and.reduce(around)
    return result if mask is None else result & mask


def bark(m, mask, dark, light, seed, dark_share=0.3, light_share=0.12, run=5):
    """Vertical bark streaks: whole columns of the surface turn darker or
    lighter in runs of `run` blocks, like a Minecraft log."""
    iy = np.indices(m.grid.shape)[1]
    column = hash01(m, seed, y=np.zeros_like(iy))
    stretch = hash01(m, seed + 5, y=iy // run)
    side = exposed(m, mask, sides=True)
    m.paint(side & (column < dark_share) & (stretch < 0.7), dark)
    m.paint(side & (column > 1 - light_share) & (stretch < 0.6), light)


def sprout(m, mask, colour, density, seed, gap=2, avoid=None, length=1):
    """Single blocks sticking straight out of the surface of `mask` (cactus
    spines, leaves), each in the same piece as the block it grows from."""
    surf = exposed(m, mask)
    if avoid is not None:
        surf &= ~avoid
    chosen = np.argwhere(surf & (hash01(m, seed) < density))
    centre = np.argwhere(mask & (m.grid > 0)).mean(axis=0)
    index = m.colour(colour)
    placed = []
    for x, y, z in chosen:
        if any(abs(x - a) <= gap and abs(y - b) <= gap and abs(z - c) <= gap for a, b, c in placed):
            continue
        best, score = None, -1e9
        for d in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0)):
            tx, ty, tz = x + d[0], y + d[1], z + d[2]
            if not (0 <= tx < m.width and 0 <= ty < m.height and 0 <= tz < m.depth) or m.grid[tx, ty, tz]:
                continue
            s = d[0] * (x - centre[0]) + d[1] * (y - centre[1]) * 0.5 + d[2] * (z - centre[2])
            if s > score:
                best, score = d, s
        if best is None:
            continue
        for step in range(1, length + 1):
            tx, ty, tz = x + best[0] * step, y + best[1] * step, z + best[2] * step
            if not (0 <= tx < m.width and 0 <= ty < m.height and 0 <= tz < m.depth) or m.grid[tx, ty, tz]:
                break
            m.grid[tx, ty, tz] = index
            m.part[tx, ty, tz] = m.part[x, y, z]
        placed.append((x, y, z))


# -- Tung Tung Tung Sahur -------------------------------------------------------


@design("TungTungTungSahur", width=40, height=47, depth=24)
def tung_tung_tung_sahur(m):
    cx, cz = 20, 13
    wood, wood_dark, wood_light = "#a8662f", "#7b4520", "#c47f40"
    ring, ring_line, ring_core = "#e8c38a", "#c99a5c", "#9c6a36"
    brow, mouth = "#3a2112", "#3f2414"
    bat, bat_dark = "#c07e40", "#84501f"
    xs, ys, zs = m._centres

    # Short, sturdy legs with blocky feet.
    for x0, phase in ((14, 0), (22, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 11, cz), phase=phase)
        m.box(x0, 3, 11, x0 + 3, 10, 14, wood, part=leg)
        m.box(x0, 0, 8, x0 + 3, 2, 14, wood_dark, part=leg)
        m.box(x0, 2, 8, x0 + 3, 2, 10, wood, part=leg)

    # The log: a chunky upright column of bark.
    log = column_mask(m, cx, cz, 8.2, 8.2, 11, 46)
    m.mask(log, wood)
    bark(m, log & (ys < 46), wood_dark, wood_light, seed=3)
    # Cut end on top: pale wood with growth rings and a bark rim.
    r = (np.abs(xs - cx) ** 2.6 + np.abs(zs - cz) ** 2.6) ** (1 / 2.6)
    top = log & (ys > 46)
    m.paint(top, ring)
    m.paint(top & (r > 6.9), wood_dark)
    m.paint(top & (r > 4.4) & (r <= 5.4), ring_line)
    m.paint(top & (r > 2.0) & (r <= 3.0), ring_line)
    m.paint(top & (r <= 1.0), ring_core)

    # The big cartoon face: bushy brows, huge round eyes with small pupils,
    # a little nose and a smile.
    face_area = m.box_mask(12, 29, 0, 27, 45, cz)
    m.paint_face(face_area, wood, face="front")
    face = [
        "..bbbb....bbbb..",
        ".bbbbb....bbbbb.",
        "................",
        "..wwww....wwww..",
        ".wwwwww..wwwwww.",
        ".wwwwww..wwwwww.",
        ".wwwkkw..wkkwww.",
        ".wwwkkw..wkkwww.",
        ".wwwwww..wwwwww.",
        "..wwww....wwww..",
        "................",
        "................",
        "...m........m...",
        "....mmmmmmmm....",
    ]
    m.pixels(12, 31, face, {"b": brow, "w": WHITE, "k": BLACK, "m": mouth})
    m.box(19, 33, 3, 20, 34, 4, wood_light)
    m.box(19, 33, 3, 20, 33, 4, wood)

    # Thin arms; the right hand holds a wooden baseball bat up at the ready.
    for x0, phase in ((9, 0), (28, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 33, cz + 0.5), phase=phase)
        m.box(x0, 20, 12, x0 + 2, 33, 14, wood, part=arm)
        fist_x = x0 - 1 if x0 < cx else x0
        m.box(fist_x, 16, 11, fist_x + 3, 19, 14, wood_light, part=arm)
        if x0 < cx:
            club, s = tube(m, [(10, 14.5, 13.5), (9.8, 18, 12.6), (4.2, 37, 2.6)], [1.2, 1.0, 2.3])
            club &= ~m.box_mask(fist_x, 16, 11, fist_x + 3, 19, 14)
            m.mask(club, bat, part=arm)
            m.paint(club & (s < 1.6), bat_dark)
            m.paint(club & (s > 5) & (s < 6.2), bat_dark)


# -- Lirili Larila --------------------------------------------------------------


@design("LiriliLarila", width=40, height=48, depth=26)
def lirili_larila(m):
    cx = 20
    green, green_dark, green_light = "#4cae3b", "#2f7c29", "#71c957"
    spine = "#f6f6ee"
    sole, strap, bed = "#5e3419", "#8b5129", "#dcb57c"
    brow = "#1f4d1a"

    # Cactus legs in brown sandals: a thick sole, a tan footbed, a strap
    # over the foot and green toes peeking out in front.
    for x0, phase in ((13, 0), (22, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2.5, 13, 13.5), phase=phase)
        m.mask(rounded_box_mask(m, x0, 2, 11, x0 + 4, 13, 15, 0.9), green, part=leg)
        m.box(x0, 2, 9, x0 + 4, 3, 15, green, part=leg)
        for x in (x0, x0 + 2, x0 + 4):
            m.voxel(x, 2, 8, green, part=leg)
        m.box(x0 - 1, 0, 7, x0 + 5, 0, 16, sole, part=leg)
        m.box(x0 - 1, 1, 7, x0 + 5, 1, 16, bed, part=leg)
        m.box(x0 - 1, 1, 7, x0 + 5, 1, 7, sole, part=leg)
        m.box(x0 - 1, 2, 10, x0 + 5, 4, 11, strap, part=leg)
        m.box(x0 - 1, 2, 16, x0 + 5, 3, 16, strap, part=leg)

    # A chunky cactus body.
    m.mask(rounded_box_mask(m, 13, 13, 9, 26, 30, 17, 1.5), green)

    # Cactus arms.
    for x0, phase in ((9, 0), (27, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2, 30.5, 14), phase=phase)
        m.mask(rounded_box_mask(m, x0, 16, 12, x0 + 3, 30, 15, 1.2), green, part=arm)

    # Big round elephant ears that flap.
    for ear_x, pivot_x, phase in ((8.3, 13, 0), (31.7, 27, 1)):
        ear = m.limb("Ear", pivot=(pivot_x, 44, 15), phase=phase)
        disc = m.ellipsoid_mask(ear_x, 38.5, 15, 5.9, 6.7, 1.9)
        m.mask(disc, green, part=ear)
        m.paint(disc & ~m.ellipsoid_mask(ear_x, 38.5, 15, 4.7, 5.5, 9), green_dark)
        m.paint(disc & m.ellipsoid_mask(ear_x, 38.5, 13, 3.0, 3.8, 9) & m.surface("front"), green_light)

    # The head, its face and its long cactus trunk.
    head = m.limb("Head", pivot=(cx, 31, 13.5))
    skull = rounded_box_mask(m, 13, 31, 7, 26, 44, 19, 2.0)
    m.mask(skull, green, part=head)

    # Cactus texture: dark ribs and light ridges running up every piece.
    ix, _, iz = np.indices(m.grid.shape)
    body_green = (m.grid == m.colour(green)) & ~m.box_mask(0, 31, 0, 39, 47, 11)
    side = exposed(m, body_green, sides=True)
    m.paint(side & ((ix + iz) % 4 == 0), green_dark)
    m.paint(side & ((ix + iz) % 4 == 2), green_light)
    m.paint(exposed(m, skull) & ~m.box_mask(0, 0, 0, 39, 47, 11) & ((ix + iz) % 4 == 0), green_dark)

    face = [
        "..bbb....bbb..",
        "..www....www..",
        ".wkkkw..wkkkw.",
        ".wkhkw..wkhkw.",
        ".wkkkw..wkkkw.",
        ".wkkkw..wkkkw.",
        "..www....www..",
        "..............",
        "..............",
        "..m........m..",
        "...mm....mm...",
    ]
    m.pixels(13, 33, face, {"b": brow, "w": WHITE, "k": BLACK, "h": WHITE, "m": brow})

    trunk, s = tube(m, [(20, 35.5, 9), (20, 33.5, 5.8), (20, 29.5, 3.8), (20, 25, 3.0), (20, 21.5, 2.6), (20, 19.6, 1.5)],
                    [2.3, 2.1, 1.9, 1.7, 1.5, 1.3])
    trunk &= ~skull
    m.mask(trunk, green, part=head)
    m.paint(trunk & (np.floor(s) % 4 == 3), green_dark)
    m.paint(trunk & (s > s[trunk].max() - 0.9), green_dark)

    # White spines all over (never on the face or the sandals).
    face_zone = m.box_mask(13, 31, 0, 26, 44, 9) & ~trunk
    feet = m.box_mask(0, 0, 0, 39, 4, 25)
    ears = np.isin(m.part, [i + 1 for i, limb in enumerate(m.limbs) if limb.kind == "Ear"])
    sprout(m, ears & (m.grid == m.colour(green_dark)), spine, density=0.3, seed=12, gap=2)
    sprout(m, (m.grid > 0) & ~feet & ~ears, spine, density=0.09, seed=11, gap=3, avoid=face_zone)


# -- Tim Cheese -----------------------------------------------------------------


@design("TimCheese", width=34, height=46, depth=22)
def tim_cheese(m):
    cx, cz = 17, 11
    cheese, cheese_top = "#ffcc22", "#ffe27a"
    hole, hole_dark = "#dc8d14", "#b8690c"
    shoe, shoe_dark, lace = "#6d3b1c", "#40220f", "#b37649"
    tongue = "#f06a7e"
    ys = m._centres[1]

    # Short legs in chunky brown shoes with laces.
    for x0, phase in ((11, 0), (19, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 12, cz), phase=phase)
        m.box(x0, 5, 9, x0 + 3, 11, 12, cheese, part=leg)
        m.mask(rounded_box_mask(m, x0 - 1, 0, 5, x0 + 4, 3, 13, 1.0), shoe, part=leg)
        m.box(x0 - 1, 0, 5, x0 + 4, 0, 13, shoe_dark, part=leg)
        m.box(x0 - 1, 4, 9, x0 + 4, 5, 13, shoe, part=leg)
        m.box(x0, 3, 6, x0 + 3, 3, 6, lace, part=leg)
        m.box(x0, 3, 8, x0 + 3, 3, 8, lace, part=leg)
        m.box(x0, 5, 9, x0 + 3, 5, 9, shoe_dark, part=leg)

    # The cheese body: a big rounded gumdrop, wide at the bottom, with a flat top.
    body = np.zeros(m.grid.shape, dtype=bool)
    for y in range(12, 46):
        t = (y + 0.5 - 12) / 34
        k = max(0.0, (t - 0.3) / 0.7)
        a = 10.6 * math.sqrt(1 - 0.72 * k * k)
        b = 7.6 * math.sqrt(1 - 0.5 * k * k)
        if y == 12:
            a, b = a - 0.9, b - 0.9
        body |= column_mask(m, cx, cz, a, b, y, y, 2.6)
    m.mask(body, cheese)

    # Small arms with little block hands.
    for x0, phase in ((2, 0), (29, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 30, 11), phase=phase)
        m.box(x0, 19, 10, x0 + 2, 30, 12, cheese, part=arm)
        m.box(min(x0, 27), 29, 10, max(x0 + 2, 6), 30, 12, cheese, part=arm)
        m.box(x0, 16, 9, x0 + 2, 18, 12, cheese, part=arm)

    # The flat top catches the light.
    m.paint(body & (ys > 45), cheese_top)

    # Holes: round darker spots scattered all over (not on the face).
    face_zone = m.box_mask(7, 21, 0, 26, 41, 7)
    surf = exposed(m, (m.grid > 0) & ~m.box_mask(0, 0, 0, 33, 5, 21)) & ~face_zone
    spots = np.argwhere(surf & (hash01(m, 21) < 0.06))
    placed = []
    for x, y, z in spots:
        if any(abs(x - a) + abs(y - b) + abs(z - c) < 7 for a, b, c in placed):
            continue
        placed.append((x, y, z))
        size = hash01(m, 22)[x, y, z]
        if size < 0.2:
            m.paint(m.box_mask(x, y, z, x, y, z), hole)
        elif size < 0.65:
            # A 2x2 hole round the block's corner.
            m.paint(m.ellipsoid_mask(x + 1, y + 1, z + 1, 0.9) & surf, hole)
        else:
            m.paint(m.ellipsoid_mask(x + 0.5, y + 0.5, z + 0.5, 1.5) & surf, hole)
            m.paint(m.box_mask(x, y, z, x, y, z), hole_dark)

    # Big sparkly eyes, little brows and an open smile with a tongue.
    eye = [
        "..wwww..",
        ".wkkkkw.",
        "wkkkhhkw",
        "wkkkhhkw",
        "wkkkkkkw",
        "wkhkkkkw",
        ".wkkkkw.",
        "..wwww..",
    ]
    face = ["..kkkk......kkkk..", ".................."]
    face += [row + ".." + row for row in eye]
    face += [
        "..................",
        "..................",
        "....kkkkkkkkkk....",
        "....kkkkkkkkkk....",
        ".....kkppppkk.....",
        "......kppppk......",
        ".......kkkk.......",
    ]
    m.pixels(8, 23, face, {"k": BLACK, "w": WHITE, "h": WHITE, "p": tongue})


# -- Brr Brr Patapim ------------------------------------------------------------


def around_box(xs, zs, x0, z0, x1, z1):
    """How far round the outline of the box x0..x1, z0..z1 (bounds included)
    each column is, going along the front, the right side, the back and the
    left side: wrap a stripe round a limb with it."""
    w, d = x1 - x0 + 1, z1 - z0 + 1
    dx = (xs - (x0 + x1 + 1) / 2) / (w / 2)
    dz = (zs - (z0 + z1 + 1) / 2) / (d / 2)
    front = dz <= -np.abs(dx)
    right = ~front & (dx >= np.abs(dz))
    back = ~front & ~right & (dz >= np.abs(dx))
    left = ~(front | right | back)
    u = np.where(front, xs - x0, 0.0)
    u = np.where(right, w + (zs - z0), u)
    u = np.where(back, w + d + (x1 + 1 - xs), u)
    return np.where(left, 2 * w + d + (z1 + 1 - zs), u)


def grow(mask, steps):
    """Dilates (steps > 0) or erodes (steps < 0) a mask by 6-neighbour steps."""
    result = mask.copy()
    for _ in range(abs(steps)):
        p = np.pad(result, 1, constant_values=steps < 0)
        near = [p[2:, 1:-1, 1:-1], p[:-2, 1:-1, 1:-1], p[1:-1, 2:, 1:-1], p[1:-1, :-2, 1:-1], p[1:-1, 1:-1, 2:], p[1:-1, 1:-1, :-2]]
        result = (result | np.logical_or.reduce(near)) if steps > 0 else (result & np.logical_and.reduce(near))
    return result


@design("BrrBrrPatapim", width=34, height=49, depth=26)
def brr_brr_patapim(m):
    cx, cz = 17, 12.5
    wood, wood_dark, wood_light = "#7f4829", "#5a311a", "#9b6038"
    skin, skin_dark, skin_light = "#eda66b", "#c98049", "#f8c38f"
    leaf, leaf_dark, leaf_light = "#43a532", "#2b7b24", "#7ed244"
    vine, vine_leaf = "#3f9e2d", "#8ae04a"
    brow, lips = "#3a1f10", "#b8433f"
    xs, ys, zs = m._centres

    # Long bark legs on big peach feet with long toes.
    legs = []
    for x0, foot_x, phase in ((10, 9, 0), (19, 18, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2.5, 18, cz), phase=phase)
        legs.append(leg)
        m.box(x0, 3, 10, x0 + 4, 18, 14, wood, part=leg)
        m.mask(rounded_box_mask(m, foot_x, 0, 8, foot_x + 6, 2, 16, 0.9), skin, part=leg)
        m.box(foot_x + 1, 3, 11, foot_x + 5, 3, 15, skin, part=leg)
        for x in range(foot_x, foot_x + 7, 2):
            m.box(x, 0, 5, x, 1, 7, skin, part=leg)
            m.voxel(x, 1, 5, skin_light, part=leg)
        m.box(foot_x, 0, 5, foot_x + 6, 0, 16, skin_dark, part=leg)

    # The trunk-like body.
    torso = rounded_box_mask(m, 10, 18, 8, 23, 30, 16, 1.5)
    m.mask(torso, wood)

    # Long arms hanging down to the knees, with peach hands.
    arms = []
    for x0, phase in ((6, 0), (24, 1)):
        arm = m.limb("Arm", pivot=(x0 + 2, 30, cz), phase=phase)
        arms.append(arm)
        m.mask(rounded_box_mask(m, x0, 13, 11, x0 + 3, 31, 14, 1.0), wood, part=arm)
        m.mask(rounded_box_mask(m, x0, 7, 10, x0 + 3, 13, 15, 1.0), skin, part=arm)
        m.box(x0, 7, 10, x0 + 3, 7, 15, skin_dark, part=arm)

    bark(m, (m.grid == m.colour(wood)), wood_dark, wood_light, seed=5, dark_share=0.28, light_share=0.1, run=4)

    # Vines winding round the legs, arms and body, with little leaves.
    for mask, box, pitch, twist, offset in (
        ((m.part == legs[0]), (10, 10, 14, 14), 10, 1, 0),
        ((m.part == legs[1]), (19, 10, 23, 14), 10, -1, 0),
        ((m.part == arms[0]), (6, 11, 9, 14), 8, -1, 3),
        ((m.part == arms[1]), (24, 11, 27, 14), 8, 1, 3),
        (torso & (m.part == 0), (10, 8, 23, 16), 23, 1, 6),
    ):
        u = around_box(xs, zs, *box)
        band = ((ys + twist * u + offset) % pitch) < 2
        m.paint(exposed(m, mask & (m.grid > 0), sides=True) & band & (ys > 3.5) & ~(m.grid == m.colour(skin)), vine)
    sprout(m, m.grid == m.colour(vine), vine_leaf, density=0.35, seed=31, gap=2)

    # The head: bark with a peach face, grumpy eyes and a long droopy nose.
    head = m.limb("Head", pivot=(cx, 30, cz))
    m.mask(rounded_box_mask(m, 10, 30, 6, 23, 41, 18, 1.5), wood, part=head)
    m.paint_face(m.box_mask(11, 31, 0, 22, 39, 9), skin, face="front")
    face = [
        "bb........bb",
        ".bbb....bbb.",
        "wwww....wwww",
        "wkkw....wkkw",
        "wkkw....wkkw",
        "wwww....wwww",
        "............",
        "............",
        "..rrrrrrrr..",
    ]
    m.pixels(11, 31, face, {"b": brow, "w": WHITE, "k": BLACK, "r": lips})
    for x0 in (8, 24):
        m.box(x0, 33, 10, x0 + 1, 36, 12, skin, part=head)
        outer = x0 if x0 < cx else x0 + 1
        m.box(outer, 34, 11, outer, 35, 11, skin_dark, part=head)

    # Leafy green hair: a bushy canopy of leaf blocks over the top and back.
    canopy = m.ellipsoid_mask(cx, 42.5, 12.5, 11.2, 5.8, 10.2) & (ys > 36)
    canopy |= rounded_box_mask(m, 9, 31, 14, 24, 42, 21, 2.0)
    m.mask(canopy, leaf, part=head)
    shell = grow(canopy, 1) & ~grow(canopy, -2)
    for gx in range(3, 32, 3):
        for gy in range(31, 48, 3):
            for gz in range(0, 25, 3):
                h = hash01(m, 41)[gx, gy, gz]
                px, py, pz = gx + int(h * 3) - 1, gy + int(h * 7) % 3 - 1, gz + int(h * 11) % 3 - 1
                if not (0 <= px < m.width and 0 <= py < m.height and 0 <= pz < m.depth) or not shell[px, py, pz]:
                    continue
                size = 3 if h > 0.35 else 2
                colour = leaf_light if (h * 13) % 1 < 0.3 + 0.03 * (py - 38) else leaf_dark if (h * 17) % 1 < 0.3 else leaf
                m.box(px, py, pz, px + size - 1, py + size - 1, pz + size - 1, colour, part=head)
    # Keep the face and ears clear of leaves.
    m.clear(m.box_mask(9, 30, 0, 24, 39, 7))
    m.clear(m.box_mask(0, 30, 0, 9, 36, 13) | m.box_mask(24, 30, 0, 33, 36, 13))
    m.clear(m.box_mask(0, 0, 0, 33, 29, 25) & (m.part == head))
    m.paint_face(m.box_mask(11, 31, 0, 22, 39, 9), skin, face="front")
    m.pixels(11, 31, face, {"b": brow, "w": WHITE, "k": BLACK, "r": lips})
    for x0 in (8, 24):
        m.box(x0, 33, 10, x0 + 1, 36, 12, skin, part=head)
        outer = x0 if x0 < cx else x0 + 1
        m.box(outer, 34, 11, outer, 35, 11, skin_dark, part=head)

    # The long droopy nose: out from the face, then down past the chin.
    m.box(15, 33, 2, 18, 35, 6, skin, part=head)
    m.box(15, 26, 1, 18, 34, 3, skin, part=head)
    m.clear(m.box_mask(15, 26, 1, 15, 26, 3) | m.box_mask(18, 26, 1, 18, 26, 3))
    m.paint(m.box_mask(15, 26, 0, 18, 26, 5) | m.box_mask(15, 33, 4, 18, 33, 6), skin_dark)
    m.paint(m.box_mask(15, 35, 2, 18, 35, 6), skin_light)
